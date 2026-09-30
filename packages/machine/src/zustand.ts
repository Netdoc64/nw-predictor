import type { TimeMs } from '@vp/core-ids';

// ─────────────────────────────────────────────────────────────────────────────
// Die Zustandsmaschine — PLAN.md §4.1 bis §4.3.
//
// Das Journal ist die QUELLE, der Zustand nur eine Projektion daraus. Und es
// wird zweimal geschrieben: `vorhaben` vor der Wirkung, `vollzogen` danach. Wer
// mitten im Uebergang abstuerzt, findet beim Start ein `vorhaben` ohne
// `vollzogen` — und weiss damit genau, wo er stand.
// ─────────────────────────────────────────────────────────────────────────────

export type Zustand =
  | 'IDLE'
  | 'RESOLVING'
  | 'WARMUP'
  | 'LIVE'
  | 'BACKFILL'
  | 'DEGRADED'
  | 'HALTED'
  | 'RETIRED';

export type Ereignis =
  | 'start'
  | 'resolve_ok'
  | 'resolve_failed'
  | 'coverage_ok'
  | 'coverage_impossible'
  | 'feed_stale'
  | 'gap_detected'
  | 'gap_closed'
  | 'feed_recovered'
  | 'budget_exhausted'
  | 'definition_changed'
  | 'resume'
  | 'retire';

/** Erlaubte Uebergaenge. Was hier nicht steht, geht nicht — auch nicht „kurz". */
export const UEBERGAENGE: ReadonlyArray<{
  von: Zustand | '*';
  ereignis: Ereignis;
  nach: Zustand;
}> = [
  { von: 'IDLE', ereignis: 'start', nach: 'RESOLVING' },
  { von: 'RESOLVING', ereignis: 'resolve_ok', nach: 'WARMUP' },
  { von: 'RESOLVING', ereignis: 'resolve_failed', nach: 'HALTED' },
  { von: 'WARMUP', ereignis: 'coverage_ok', nach: 'LIVE' },
  { von: 'WARMUP', ereignis: 'coverage_impossible', nach: 'DEGRADED' },
  { von: 'LIVE', ereignis: 'feed_stale', nach: 'DEGRADED' },
  { von: 'LIVE', ereignis: 'gap_detected', nach: 'BACKFILL' },
  { von: 'BACKFILL', ereignis: 'gap_closed', nach: 'LIVE' },
  { von: 'DEGRADED', ereignis: 'feed_recovered', nach: 'LIVE' },
  { von: 'DEGRADED', ereignis: 'gap_detected', nach: 'BACKFILL' },
  { von: '*', ereignis: 'budget_exhausted', nach: 'HALTED' },
  { von: '*', ereignis: 'definition_changed', nach: 'RESOLVING' },
  { von: 'HALTED', ereignis: 'resume', nach: 'RESOLVING' },
  { von: '*', ereignis: 'retire', nach: 'RETIRED' },
];

export function ziel(von: Zustand, e: Ereignis): Zustand | null {
  const genau = UEBERGAENGE.find((u) => u.von === von && u.ereignis === e);
  if (genau) return genau.nach;
  const stern = UEBERGAENGE.find((u) => u.von === '*' && u.ereignis === e);
  return stern ? stern.nach : null;
}

/** Nur in diesen Zustaenden sind Signale gueltig — PLAN.md §4.1. */
export function signaleGueltig(z: Zustand): boolean {
  return z === 'LIVE' || z === 'DEGRADED';
}

export interface JournalEintrag {
  readonly seq: number;
  readonly ts: TimeMs;
  readonly art: 'vorhaben' | 'vollzogen' | 'gescheitert';
  readonly von: Zustand;
  readonly nach: Zustand;
  readonly ereignis: Ereignis;
  readonly guards?: Readonly<Record<string, boolean>>;
  readonly erzwungen?: boolean;
  readonly grund?: string;
  /** Wer es ausgeloest hat — MCP-Flaechen-Identitaet (PLAN.md §12/N145). */
  readonly urheber?: string;
}

export class UebergangFehler extends Error {
  readonly code = 'VP-MCH-0001' as const;
  constructor(von: Zustand, e: Ereignis) {
    super(`Uebergang nicht erlaubt: ${von} --${e}-->`);
    this.name = 'UebergangFehler';
  }
}

export class Journal {
  #eintraege: JournalEintrag[] = [];
  #seq = 0;

  schreibe(e: Omit<JournalEintrag, 'seq'>): JournalEintrag {
    this.#seq += 1;
    const voll: JournalEintrag = { ...e, seq: this.#seq };
    this.#eintraege.push(voll);
    return voll;
  }

  alle(): readonly JournalEintrag[] {
    return this.#eintraege;
  }

  /**
   * Beim Start: ein `vorhaben` ohne `vollzogen` heisst, dass der letzte
   * Uebergang unterbrochen wurde.
   */
  unvollendet(): JournalEintrag | null {
    for (let i = this.#eintraege.length - 1; i >= 0; i -= 1) {
      const e = this.#eintraege[i]!;
      if (e.art === 'vollzogen' || e.art === 'gescheitert') return null;
      if (e.art === 'vorhaben') return e;
    }
    return null;
  }

  /** Der Zustand ergibt sich aus dem Journal — nicht umgekehrt. */
  zustand(start: Zustand = 'IDLE'): Zustand {
    let z = start;
    for (const e of this.#eintraege) if (e.art === 'vollzogen') z = e.nach;
    return z;
  }
}
