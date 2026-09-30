import { hash } from './hash.ts';
import { kanon } from './kanon.ts';
import { istTimeframe, type Timeframe } from './zeit.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Adressen — PLAN.md §2.1 bis §2.3.
//
// Ohne gemeinsame Adresse sprechen Registry, Maschine, Chart, Fehler und MCP
// ueber verschiedene Dinge mit denselben Woertern. Deshalb steht das hier vor
// allem anderen — und deshalb gibt es kein zweites Modul, das Scopes baut.
// ─────────────────────────────────────────────────────────────────────────────

export class AdressFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'AdressFehler';
  }
}

export interface Scope {
  readonly venue: string;
  /** Wie der Venue es schreibt — unveraendert. Jede Umschrift ist eine Fehlerquelle. */
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly profil: string;
}

export type ScopeKey = string;

const VENUE_RE = /^[a-z0-9_-]+$/;
const SYMBOL_RE = /^[A-Za-z0-9._:-]+$/;
const PROFIL_RE = /^[a-z0-9_-]+$/;

/**
 * Normalisieren und pruefen.
 *
 * `venue` und `profil` sind UNSERE Namen — kleingeschrieben. `symbol` ist der
 * des Marktes und bleibt, wie er kam: aus `btcusdt` ein `BTCUSDT` zu machen
 * heisst zu raten, wie der naechste Venue es schreibt.
 */
export function scope(roh: {
  venue: string;
  symbol: string;
  timeframe: string;
  profil: string;
}): Scope {
  const venue = roh.venue.trim().toLowerCase();
  const symbol = roh.symbol.trim();
  const profil = roh.profil.trim().toLowerCase();
  const timeframe = roh.timeframe.trim();

  if (!VENUE_RE.test(venue)) throw new AdressFehler(`venue unzulaessig: ${roh.venue}`);
  if (!SYMBOL_RE.test(symbol)) throw new AdressFehler(`symbol unzulaessig: ${roh.symbol}`);
  if (!PROFIL_RE.test(profil)) throw new AdressFehler(`profil unzulaessig: ${roh.profil}`);
  if (!istTimeframe(timeframe)) {
    throw new AdressFehler(`timeframe unbekannt: ${roh.timeframe} — erlaubt sind z.B. 1m, 1h, 1d`);
  }
  return { venue, symbol, timeframe, profil };
}

export function scopeKey(s: Scope): ScopeKey {
  return `${s.venue}:${s.symbol}:${s.timeframe}:${s.profil}`;
}

export function scopeLesen(key: ScopeKey): Scope {
  const teile = key.split(':');
  if (teile.length !== 4) throw new AdressFehler(`ScopeKey braucht vier Teile: ${key}`);
  const [venue, symbol, timeframe, profil] = teile as [string, string, string, string];
  return scope({ venue, symbol, timeframe, profil });
}

// ── URN ──────────────────────────────────────────────────────────────────────

export type Urn = string;

export interface UrnTeile {
  readonly kind: string;
  readonly ns: string;
  readonly name: string;
  readonly version: string;
}

const URN_RE = /^vp:\/\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)$/;

export function urn(t: UrnTeile): Urn {
  const u = `vp://${t.kind}/${t.ns}/${t.name}@${t.version}`;
  if (!URN_RE.test(u)) throw new AdressFehler(`URN unzulaessig: ${u}`);
  return u;
}

export function urnLesen(u: Urn): UrnTeile {
  const m = URN_RE.exec(u);
  if (!m) throw new AdressFehler(`URN unlesbar: ${u}`);
  return { kind: m[1]!, ns: m[2]!, name: m[3]!, version: m[4]! };
}

/** Hauptversion — der Teil, dessen Wechsel einen Bruch bedeutet. */
export function major(u: Urn): number {
  return Number(urnLesen(u).version.split('.')[0]);
}

// ── nodeHash ─────────────────────────────────────────────────────────────────

/**
 * Die Generation der Implementierung.
 *
 * Steckt im nodeHash, damit ein Cache aus der Zeit vor einer Korrektur nicht
 * weiter Werte liefert, die kein Code mehr erzeugt (PLAN.md §12/I103). Wer eine
 * Knotenrechnung aendert, ohne die Version zu ziehen, erhoeht diese Zahl.
 */
export const CODE_GENERATION = '1';

export interface NodeHashTeile {
  readonly def: Urn;
  readonly params: Record<string, unknown>;
  readonly eingaenge: readonly string[];
  /** Stand der Rohdaten: Bar-Korrekturen, Splits, Feed-Wechsel. */
  readonly datenRevision: string;
  /** Hash der Gewichte/Tabellen, die kein Parameter sind. Leer, wenn es keine gibt. */
  readonly artefaktHash?: string;
}

export function nodeHash(t: NodeHashTeile): string {
  return hash(
    t.def,
    kanon(t.params),
    // Sortiert: die Reihenfolge, in der die Eingaenge im Objekt standen, ist
    // keine Eigenschaft der Rechnung.
    [...t.eingaenge].sort().join(','),
    t.datenRevision,
    t.artefaktHash ?? '',
    CODE_GENERATION,
  );
}

/** Adresse einer Knoten-INSTANZ: Definition + Scope + Inhaltsadresse. */
export function instanzUrn(def: Urn, key: ScopeKey, nHash: string): string {
  return `${def}#${key}/${nHash.slice(0, 8)}`;
}
