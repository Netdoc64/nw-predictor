import type { Bar, Fix, InstrumentMeta, Uhr, Urn } from '@vp/core-ids';

// ─────────────────────────────────────────────────────────────────────────────
// Die Laufzeit eines Knotens — PLAN.md §4.6.
//
// JEDER Knoten ist ein Stromknoten: er bekommt eine Bar nach der anderen und
// gibt einen Wert zurueck. Es gibt keinen zweiten Pfad fuer den Backtest.
//
// Das ist der Grund, warum „Replay ≡ Live" ueberhaupt erreichbar ist: es gibt
// nur EINE Rechnung, und ob die Bars aus dem Netz oder von der Platte kommen,
// weiss dieser Code nicht und darf es nicht wissen.
// ─────────────────────────────────────────────────────────────────────────────

export interface SchrittKontext {
  readonly bar: Bar;
  /** Laufende Nummer der Bar seit Beginn des Stroms, ab 0. */
  readonly index: number;
  /** Wert eines Eingangs-Schachts in DIESEM Schritt. */
  readonly eingang: (schacht: string) => unknown;
  readonly uhr: Uhr;
  readonly knotenId: string;
  readonly nodeHash: string;
  /**
   * Die Wert-Id eines Eingangs in diesem Schritt.
   *
   * Aufgezeichnet wird an einer Stelle — im Laeufer, nicht in den Knoten. Ein
   * Knoten, der selbst aufzeichnet, vergisst es irgendwann, und dann fehlt in
   * genau der Kette ein Glied, die man braucht.
   */
  readonly wertIdVon: (schacht: string) => string;
}

export interface KnotenLaufzeit {
  /**
   * Ein Schritt. Rueckgabe `null` heisst „noch kein gueltiger Wert" — etwa
   * waehrend des Warmups. Das ist kein Fehler und wird nicht gemeldet.
   */
  schritt(ctx: SchrittKontext): unknown;
}

/**
 * Was ein Knoten ausser seinen Parametern noch braucht.
 *
 * Absichtlich ein Dienstverzeichnis und keine Typen aus `trading`: sonst haengt
 * `compute` an `trading`, und die Abhaengigkeitsrichtung aus PLAN.md §9.2 ist
 * hin. Wer einen Dienst zieht, den es nicht gibt, bekommt einen klaren Fehler —
 * das ist der Preis dafuer und er ist niedrig.
 */
export interface Umgebung {
  readonly meta: InstrumentMeta;
  readonly dienste: ReadonlyMap<string, unknown>;
}

export function dienst<T>(u: Umgebung, name: string): T {
  const d = u.dienste.get(name);
  if (d === undefined) throw new Error(`Dienst "${name}" fehlt in der Umgebung`);
  return d as T;
}

export type Fabrik = (
  params: Readonly<Record<string, unknown>>,
  umgebung: Umgebung,
) => KnotenLaufzeit;

const WERKE = new Map<Urn, Fabrik>();

export function melde(urn: Urn, f: Fabrik): void {
  if (WERKE.has(urn)) throw new Error(`Werk doppelt gemeldet: ${urn}`);
  WERKE.set(urn, f);
}

export function werk(urn: Urn): Fabrik {
  const f = WERKE.get(urn);
  if (!f) throw new Error(`keine Implementierung fuer ${urn}`);
  return f;
}

export function gemeldeteWerke(): readonly Urn[] {
  return [...WERKE.keys()].sort();
}

// ── kleine Helfer, damit die Knoten selbst kurz bleiben ──────────────────────

export function alsFix(w: unknown): Fix | null {
  return typeof w === 'bigint' ? w : null;
}

export function alsBar(w: unknown): Bar {
  if (typeof w !== 'object' || w === null || !('c' in w)) {
    throw new Error('Eingang ist keine Bar');
  }
  return w as Bar;
}

export function zahlParam(params: Readonly<Record<string, unknown>>, name: string): number {
  const v = params[name];
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    throw new Error(`Parameter ${name} muss eine positive Ganzzahl sein, ist ${String(v)}`);
  }
  return v;
}
