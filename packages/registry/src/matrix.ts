import { existsSync } from 'node:fs';
import { scope, scopeKey, type ScopeKey } from '@vp/core-ids';
import type { BudgetKlasse, ErrorCode } from '@vp/errors';
import { lies, schreib } from './speicher.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Scope-Matrix — PLAN.md §3.2 (horizontal).
//
// Eine Zeile je Markt; sie haelt keine Rechenwege. Zwei Dinge schuetzt dieses
// Modul:
//   C37  `btcusdt` und `BTCUSDT` sind ein Markt. Der Eintrag normalisiert ueber
//        core-ids und MELDET die Kollision, statt zwei Zeilen anzulegen.
//   D41  Zwei Prozesse duerfen nicht denselben Scope fahren. Eine Lease mit TTL
//        haelt die Zeile; ohne eigene, gueltige Lease wird nicht geschrieben.
//
// Die Uhr kommt hinein (`jetzt`, Millisekunden) — im Kern gibt es kein
// Date.now. Gespeichert wird ueber lies()/schreib(): atomar, mit
// Fremdschreiber-Erkennung.
// ─────────────────────────────────────────────────────────────────────────────

export interface Lease {
  readonly owner: string;
  readonly expiresAt: number;
}

export interface ScopeRow {
  scopeKey: ScopeKey;
  instrumentId: string;
  enabled: boolean;
  profile: string;
  /** Welcher aufgeloeste Plan gerade gilt. */
  planHash: string | null;
  /** Projektion aus dem Journal der Maschine, nie die Quelle. */
  state: string;
  /** ms, wann dieser Zustand begann. */
  since: number;
  health: {
    feedAgeMs: number;
    lastBarTime: number | null;
    gapCount: number;
    degradedReason?: string;
  };
  budgets: Partial<Record<BudgetKlasse, { used: number; limit: number; windowMs: number }>>;
  lease: Lease | null;
  tags: string[];
}

export type Uhr = () => number;

interface MatrixDatei {
  zeilen: Record<ScopeKey, ScopeRow>;
}

type Code = Extract<ErrorCode, 'VP-REG-0014' | 'VP-REG-0015' | 'VP-REG-0016' | 'VP-MCH-0003'>;

export class MatrixFehler extends Error {
  readonly code: Code;

  constructor(code: Code, nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'MatrixFehler';
  }
}

const geladen = (pfad: string): { daten: MatrixDatei; abdruck: string | null } => {
  if (!existsSync(pfad)) return { daten: { zeilen: {} }, abdruck: null };
  const g = lies<MatrixDatei>(pfad);
  return { daten: g.wert, abdruck: g.abdruck };
};

export interface Kollision {
  readonly vorhanden: ScopeKey;
  readonly neu: ScopeKey;
}

/** Alle Paare in `keys`, die nur in der Schreibweise des Symbols auseinanderliegen. */
export function kollisionen(keys: readonly ScopeKey[]): Kollision[] {
  const nach = new Map<string, ScopeKey>();
  const raus: Kollision[] = [];
  for (const k of keys) {
    const f = k.toLowerCase();
    const erster = nach.get(f);
    if (erster === undefined) nach.set(f, k);
    else if (erster !== k) raus.push({ vorhanden: erster, neu: k });
  }
  return raus;
}

export interface NeueZeile {
  venue: string;
  symbol: string;
  timeframe: string;
  profil: string;
  instrumentId?: string;
  tags?: string[];
}

/** Eine neue Zeile — ohne Lease, aktiviert nichts. Kollision und Doppeltes scheitern laut (C37). */
export function eintragen(pfad: string, roh: NeueZeile, jetzt: Uhr): ScopeRow {
  const s = scope(roh);
  const key = scopeKey(s);
  const { daten, abdruck } = geladen(pfad);

  if (key in daten.zeilen) {
    throw new MatrixFehler('VP-REG-0016', `Scope ${key} gibt es schon`);
  }
  const k = kollisionen([...Object.keys(daten.zeilen), key]).find((x) => x.neu === key);
  if (k) {
    throw new MatrixFehler(
      'VP-REG-0014',
      `Scope ${key} kollidiert mit ${k.vorhanden} — derselbe Markt, nur anders geschrieben; nichts angelegt`,
    );
  }

  const zeile: ScopeRow = {
    scopeKey: key,
    instrumentId: roh.instrumentId ?? `${s.venue}:${s.symbol}`,
    enabled: false,
    profile: s.profil,
    planHash: null,
    state: 'IDLE',
    since: jetzt(),
    health: { feedAgeMs: 0, lastBarTime: null, gapCount: 0 },
    budgets: {},
    lease: null,
    tags: [...(roh.tags ?? [])],
  };
  daten.zeilen[key] = zeile;
  schreib(pfad, daten, abdruck);
  return zeile;
}

export function zeilen(pfad: string): ScopeRow[] {
  return Object.values(geladen(pfad).daten.zeilen);
}

const wirdGehalten = (l: Lease | null, jetzt: number): l is Lease => l !== null && l.expiresAt > jetzt;

function ttlPruefen(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError(`ttlMs muss eine positive Zahl sein: ${ttlMs}`);
  }
}

function zeileHolen(daten: MatrixDatei, key: ScopeKey): ScopeRow {
  const z = daten.zeilen[key];
  if (!z) throw new MatrixFehler('VP-REG-0016', `Scope ${key} ist nicht eingetragen`);
  return z;
}

/**
 * Lease erwerben. Frei oder abgelaufen: gehoert dem Bewerber. Von einem anderen
 * gehalten: der Bewerber scheitert laut (D41) — kein stilles Mitfahren.
 */
export function leaseErwerben(pfad: string, key: ScopeKey, owner: string, ttlMs: number, jetzt: Uhr): Lease {
  ttlPruefen(ttlMs);
  const { daten, abdruck } = geladen(pfad);
  const z = zeileHolen(daten, key);
  const t = jetzt();
  if (wirdGehalten(z.lease, t) && z.lease.owner !== owner) {
    throw new MatrixFehler('VP-REG-0015', `Scope ${key} haelt ${z.lease.owner} noch bis ${z.lease.expiresAt}`);
  }
  z.lease = { owner, expiresAt: t + ttlMs };
  schreib(pfad, daten, abdruck);
  return z.lease;
}

/**
 * Erneuern — nur der Halter, nur solange die Lease noch gilt (D55). Eine
 * abgelaufene wird NICHT stillschweigend wiederbelebt: der Halter hat sie
 * verloren und muss anhalten.
 */
export function leaseErneuern(pfad: string, key: ScopeKey, owner: string, ttlMs: number, jetzt: Uhr): Lease {
  ttlPruefen(ttlMs);
  const { daten, abdruck } = geladen(pfad);
  const z = zeileHolen(daten, key);
  const t = jetzt();
  if (!wirdGehalten(z.lease, t) || z.lease.owner !== owner) {
    throw new MatrixFehler('VP-MCH-0003', `${owner} haelt ${key} nicht mehr`);
  }
  z.lease = { owner, expiresAt: t + ttlMs };
  schreib(pfad, daten, abdruck);
  return z.lease;
}

/** Freigeben — nur der Halter. Eine schon abgelaufene Lease gilt als frei. */
export function leaseFreigeben(pfad: string, key: ScopeKey, owner: string, jetzt: Uhr): void {
  const { daten, abdruck } = geladen(pfad);
  const z = zeileHolen(daten, key);
  if (wirdGehalten(z.lease, jetzt()) && z.lease.owner !== owner) {
    throw new MatrixFehler('VP-REG-0015', `Scope ${key} haelt ${z.lease.owner}, nicht ${owner}`);
  }
  z.lease = null;
  schreib(pfad, daten, abdruck);
}

type Aenderbar = Partial<Pick<ScopeRow, 'enabled' | 'planHash' | 'state' | 'since' | 'health' | 'budgets' | 'tags'>>;

/** Zeile aendern. Ohne gueltige eigene Lease wird nichts geschrieben (D41). */
export function zeileSchreiben(pfad: string, key: ScopeKey, owner: string, aenderung: Aenderbar, jetzt: Uhr): ScopeRow {
  const { daten, abdruck } = geladen(pfad);
  const z = zeileHolen(daten, key);
  if (!wirdGehalten(z.lease, jetzt()) || z.lease.owner !== owner) {
    throw new MatrixFehler('VP-MCH-0003', `${owner} hat keine gueltige Lease auf ${key} — nichts geschrieben`);
  }
  Object.assign(z, aenderung);
  schreib(pfad, daten, abdruck);
  return z;
}
