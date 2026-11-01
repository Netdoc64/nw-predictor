import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { hash, kanon } from '@vp/core-ids';
import { lies, schreib } from './speicher.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Revisionen, Entwurf und Aktivierung — PLAN.md §3.3.
//
// Ein Upsert schreibt einen ENTWURF, nie etwas Wirksames. Erst `activate`
// verschiebt den Zeiger `aktiv`, und das nur mit dem `confirm`-Hash aus der
// Vorschau. Nichts wird ueberschrieben: die vorige Revision bleibt aktivierbar,
// ein Rollback ist derselbe Zeigerwechsel rueckwaerts.
//
// Pro Eintrag EINE Datei (`<wurzel>/<art>/<schluessel>.json`) mit Revisionen,
// Zeiger UND Journal. So ist jede Aenderung samt ihrem Journal-Eintrag ein
// einziger atomarer `schreib()` — es gibt keinen Zustand „geaendert, aber nicht
// verzeichnet". Jeder Schreibvorgang laeuft ueber `schreib()` und damit durch
// die Fremdschreiber-Erkennung (G83).
// ─────────────────────────────────────────────────────────────────────────────

export type RevisionsArt = 'definition' | 'profil' | 'strategie' | 'flaeche';

export type RevisionsCode = 'VP-REG-0010' | 'VP-REG-0011' | 'VP-REG-0012' | 'VP-REG-0013';

export class RevisionsFehler extends Error {
  readonly code: RevisionsCode;
  constructor(code: RevisionsCode, nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'RevisionsFehler';
  }
}

export interface Revision {
  readonly nr: number;
  readonly inhalt: unknown;
  readonly urheber: string;
  readonly ts: string;
}

export type JournalArt = 'entwurf' | 'aktivierung' | 'rollback';

export interface JournalEintrag {
  readonly ts: string;
  readonly aktion: JournalArt;
  readonly art: RevisionsArt;
  readonly schluessel: string;
  readonly revision: number;
  /** Welche Revision vorher aktiv war; `null` = keine. */
  readonly vorher: number | null;
  /** Pflicht (N145): wer war das. */
  readonly urheber: string;
  readonly confirm?: string;
}

interface Datei {
  readonly art: RevisionsArt;
  readonly schluessel: string;
  readonly revisionen: readonly Revision[];
  readonly aktiv: number | null;
  /** Frueher aktive Revisionen, juengste zuletzt — das Ziel eines Rollbacks. */
  readonly aktivVerlauf: readonly number[];
  readonly journal: readonly JournalEintrag[];
}

export interface Kontext {
  readonly wurzel: string;
  readonly art: RevisionsArt;
  readonly schluessel: string;
  /** Zeitquelle; Vorgabe ist die Systemuhr. Tests reichen eine feste herein. */
  readonly jetzt?: () => string;
}

export interface Vorschau {
  readonly revision: number;
  readonly entwurf: unknown;
  readonly aktiv: number | null;
  readonly aktuell: unknown;
  /** Muss `activate` mitgegeben werden. */
  readonly confirm: string;
}

const SCHLUESSEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function pfadVon(k: Kontext): string {
  if (!SCHLUESSEL.test(k.schluessel)) {
    throw new RevisionsFehler(
      'VP-REG-0013',
      `Schluessel "${k.schluessel}" nicht zulaessig — erlaubt sind Buchstaben, Ziffern, ".", "_" und "-"`,
    );
  }
  return join(k.wurzel, k.art, `${k.schluessel}.json`);
}

function pruefeUrheber(urheber: string): void {
  if (typeof urheber !== 'string' || urheber.trim() === '') {
    throw new RevisionsFehler('VP-REG-0011', 'Aenderung ohne Urheber — nichts geschrieben');
  }
}

/** Die Identitaet einer Flaeche steht als `<id>@<ort>`; verglichen wird mit Id und voller Identitaet. */
function istEigeneFlaeche(inhalt: unknown, urheber: string): boolean {
  if (typeof inhalt !== 'object' || inhalt === null) return false;
  const f = inhalt as { id?: unknown; identitaet?: unknown };
  return f.identitaet === urheber || (typeof f.id === 'string' && f.id === urheber.split('@')[0]);
}

/** N143: eine Flaeche bedient sich nicht selbst — weder Entwurf noch Aktivierung. */
function pruefeSelbstbedienung(k: Kontext, inhalt: unknown, urheber: string): void {
  if (k.art === 'flaeche' && istEigeneFlaeche(inhalt, urheber)) {
    throw new RevisionsFehler(
      'VP-REG-0012',
      `${urheber} darf die eigene Flaechen-Definition "${k.schluessel}" nicht aendern`,
    );
  }
}

function laden(k: Kontext): { datei: Datei; abdruck: string | null } {
  const pfad = pfadVon(k);
  if (!existsSync(pfad)) {
    return {
      datei: { art: k.art, schluessel: k.schluessel, revisionen: [], aktiv: null, aktivVerlauf: [], journal: [] },
      abdruck: null,
    };
  }
  const g = lies<Datei>(pfad);
  return { datei: g.wert, abdruck: g.abdruck };
}

function revisionVon(datei: Datei, nr: number): Revision {
  const r = datei.revisionen.find((x) => x.nr === nr);
  if (r === undefined) throw new RevisionsFehler('VP-REG-0013', `Revision ${nr} von "${datei.schluessel}" gibt es nicht`);
  return r;
}

function uhr(k: Kontext): string {
  return (k.jetzt ?? (() => new Date().toISOString()))();
}

function bestaetigung(r: Revision, abdruck: string | null): string {
  return hash(kanon(r.inhalt), String(r.nr), abdruck ?? '');
}

/** Schreibt einen ENTWURF als neue Revision. Aktiviert nichts. */
export function upsert(k: Kontext, inhalt: unknown, urheber: string): Revision {
  pruefeUrheber(urheber);
  pruefeSelbstbedienung(k, inhalt, urheber);
  kanon(inhalt); // nicht kanonisierbar -> laut, bevor etwas geschrieben wird
  const { datei, abdruck } = laden(k);
  const nr = datei.revisionen.length === 0 ? 1 : Math.max(...datei.revisionen.map((r) => r.nr)) + 1;
  const ts = uhr(k);
  const rev: Revision = { nr, inhalt, urheber, ts };
  const neu: Datei = {
    ...datei,
    revisionen: [...datei.revisionen, rev],
    journal: [
      ...datei.journal,
      { ts, aktion: 'entwurf', art: k.art, schluessel: k.schluessel, revision: nr, vorher: datei.aktiv, urheber },
    ],
  };
  schreib(pfadVon(k), neu, abdruck);
  return rev;
}

/** Was `activate` taete — samt dem Hash, der es bestaetigt. */
export function vorschau(k: Kontext, revision: number): Vorschau {
  const { datei, abdruck } = laden(k);
  const r = revisionVon(datei, revision);
  return {
    revision,
    entwurf: r.inhalt,
    aktiv: datei.aktiv,
    aktuell: datei.aktiv === null ? null : revisionVon(datei, datei.aktiv).inhalt,
    confirm: bestaetigung(r, abdruck),
  };
}

function wechsle(k: Kontext, ziel: number, confirm: string, urheber: string, art: JournalArt): Revision {
  pruefeUrheber(urheber);
  const { datei, abdruck } = laden(k);
  const r = revisionVon(datei, ziel);
  pruefeSelbstbedienung(k, r.inhalt, urheber);
  if (confirm !== bestaetigung(r, abdruck)) {
    throw new RevisionsFehler(
      'VP-REG-0010',
      `confirm passt nicht zum Stand von "${k.schluessel}" — Vorschau ist veraltet oder fremd, nichts aktiviert`,
    );
  }
  if (datei.aktiv === ziel) return r;
  const neu: Datei = {
    ...datei,
    aktiv: ziel,
    aktivVerlauf: art === 'rollback' ? datei.aktivVerlauf.slice(0, -1) : datei.aktiv === null ? datei.aktivVerlauf : [...datei.aktivVerlauf, datei.aktiv],
    journal: [
      ...datei.journal,
      { ts: uhr(k), aktion: art, art: k.art, schluessel: k.schluessel, revision: ziel, vorher: datei.aktiv, urheber, confirm },
    ],
  };
  // Der Abdruck ist der von eben: hat jemand dazwischen geschrieben, bricht schreib() ab.
  schreib(pfadVon(k), neu, abdruck);
  return r;
}

/** Zeigerwechsel auf eine vorhandene Revision. Verlangt den `confirm` der Vorschau. */
export function activate(k: Kontext, revision: number, confirm: string, urheber: string): Revision {
  return wechsle(k, revision, confirm, urheber, 'aktivierung');
}

/** Vorschau des Rollbacks: dieselbe Vorschau, mit der vorigen aktiven Revision als Ziel. */
export function rollbackVorschau(k: Kontext): Vorschau {
  return vorschau(k, rollbackZiel(laden(k).datei, k));
}

function rollbackZiel(datei: Datei, k: Kontext): number {
  const ziel = datei.aktivVerlauf[datei.aktivVerlauf.length - 1];
  if (ziel === undefined) {
    throw new RevisionsFehler('VP-REG-0013', `"${k.schluessel}" hat keine fruehere aktive Revision zum Zuruecknehmen`);
  }
  return ziel;
}

/** Derselbe Vorgang rueckwaerts: der Zeiger geht auf die zuvor aktive Revision, mit Journal-Eintrag. */
export function rollback(k: Kontext, confirm: string, urheber: string): Revision {
  return wechsle(k, rollbackZiel(laden(k).datei, k), confirm, urheber, 'rollback');
}

export function aktive(k: Kontext): Revision | null {
  const { datei } = laden(k);
  return datei.aktiv === null ? null : revisionVon(datei, datei.aktiv);
}

export function revisionen(k: Kontext): readonly Revision[] {
  return laden(k).datei.revisionen;
}

/** Journal eines Eintrags — oder, ohne `schluessel`, aller Eintraege einer Art, nach Zeit geordnet. */
export function journal(wurzel: string, art: RevisionsArt, schluessel?: string): readonly JournalEintrag[] {
  const dir = join(wurzel, art);
  if (!existsSync(dir)) return [];
  const namen = schluessel === undefined
    ? readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5))
    : [schluessel];
  return namen
    .flatMap((s) => laden({ wurzel, art, schluessel: s }).datei.journal)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
