// ─────────────────────────────────────────────────────────────────────────────
// Zeit — PLAN.md §5.5, §12/A1…A11.
//
// Intern gibt es GENAU eine Zeitform: Millisekunden seit Epoch, UTC. Die
// Chart-Bibliotheken wollen verschiedene Einheiten (Lightweight: Sekunden,
// ECharts: Millisekunden) — das rechnet der jeweilige Treiber um, niemand sonst.
//
// Und: ein Bar-Zeitstempel ist die OEFFNUNGSZEIT. Immer. Jeder Feed-Treiber
// normalisiert darauf, bevor eine Bar das Paket verlaesst.
// ─────────────────────────────────────────────────────────────────────────────

/** Millisekunden seit Epoch, UTC. */
export type TimeMs = number;

export const TIMEFRAMES = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
} as const;

export type Timeframe = keyof typeof TIMEFRAMES;

export function istTimeframe(s: string): s is Timeframe {
  return Object.hasOwn(TIMEFRAMES, s);
}

/**
 * Dauer eines Timeframes in Millisekunden.
 *
 * `1M` (Monat) fehlt in der Tabelle mit Absicht: Monate haben keine feste
 * Dauer, und eine Konstante dafuer waere eine Luege, die erst im Februar
 * auffaellt. Lookback zaehlt ohnehin BARS, nie Zeit (PLAN.md §12/A11).
 */
export function dauer(tf: Timeframe): number {
  return TIMEFRAMES[tf];
}

/** Beginn der Bar, in der `t` liegt — Anker ist 00:00 UTC. */
export function barBeginn(t: TimeMs, tf: Timeframe): TimeMs {
  const d = dauer(tf);
  return Math.floor(t / d) * d;
}

/** Die auf `t` folgende Bar-Oeffnung. */
export function naechsteBar(t: TimeMs, tf: Timeframe): TimeMs {
  return barBeginn(t, tf) + dauer(tf);
}

/**
 * Eine Uhr, die man austauschen kann.
 *
 * `Date.now()` steht in `packages/compute` und `packages/trading` unter Verbot
 * (PLAN.md §4.3). Der Grund ist nicht Reinheit, sondern dass die Simulation
 * dieselbe Rechnung fahren muss wie der Live-Betrieb — mit einer Uhr, die am
 * Bar-Strom haengt statt an der Wand.
 */
export interface Uhr {
  /** Fachliche Zeit: Marktzeit. In der Simulation die Zeit der laufenden Bar. */
  jetzt(): TimeMs;
  /** Monotone Zeit fuer Fristen und Budgets — springt nie zurueck. */
  monoton(): number;
}

export const wanduhr: Uhr = {
  jetzt: () => Date.now(),
  monoton: () => Number(process.hrtime.bigint() / 1_000_000n),
};

/** Uhr, die der Bar-Strom stellt. Kein `sleep`, kein Timer, kein Drift. */
export class SimUhr implements Uhr {
  #t: TimeMs;
  #mono = 0;

  constructor(start: TimeMs) {
    this.#t = start;
  }

  jetzt(): TimeMs {
    return this.#t;
  }

  monoton(): number {
    return this.#mono;
  }

  /** Wird vom Bar-Strom aufgerufen, von sonst niemandem. */
  stelle(t: TimeMs): void {
    if (t < this.#t) throw new Error(`Uhr laeuft rueckwaerts: ${this.#t} → ${t}`);
    this.#mono += t - this.#t;
    this.#t = t;
  }
}

/** ISO-Darstellung fuer Journale und Belege — immer UTC, immer dieselbe Form. */
export function iso(t: TimeMs): string {
  return new Date(t).toISOString();
}
