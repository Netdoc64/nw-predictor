import type { Fix } from './zahlen.ts';
import type { TimeMs } from './zeit.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Die Bar — das gemeinsame Vokabular.
//
// Sie liegt hier und nicht in `feeds` oder `compute`, weil beide sie brauchen
// und keiner vom anderen abhaengen darf (PLAN.md §9.2). `core-ids` ist deshalb
// genauer gesagt das Woerterbuch: Adressen, Zahlen, Zeit — und die Bar.
//
// `t` ist die OEFFNUNGSZEIT. `volumen` darf fehlen: Indizes und manche
// Devisenreihen haben keins, und eine 0 zu schreiben waere eine Behauptung
// (PLAN.md §12/B21).
// ─────────────────────────────────────────────────────────────────────────────

export interface Bar {
  readonly t: TimeMs;
  readonly o: Fix;
  readonly h: Fix;
  readonly l: Fix;
  readonly c: Fix;
  readonly v: Fix | null;
  /** Die laufende, noch nicht geschlossene Bar. Aus ihr wird kein Beleg. */
  readonly vorlaeufig?: boolean;
}

/** Metadaten des Instruments — vom Venue, nie geraten (PLAN.md §12/B23). */
export interface InstrumentMeta {
  readonly instrumentId: string;
  readonly venue: string;
  readonly symbol: string;
  /** Kleinste Preisstufe. */
  readonly tickSize: Fix;
  /** Kleinste Mengenstufe. */
  readonly stepSize: Fix;
  /** Kleinster Auftragswert in Notierungswaehrung. */
  readonly minNotional: Fix;
  /** Waehrung, in der der Preis notiert. */
  readonly notierung: string;
}
