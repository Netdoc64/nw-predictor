import { dauer, type Bar, type Timeframe, type Uhr } from '@vp/core-ids';
import type { Umgebung } from '@vp/compute';
import type { Tracker } from '@vp/errors';
import type { Plan } from '@vp/registry';
import type { Rechenband } from '@vp/trace';
import { Laeufer } from './laeufer.ts';
import { Journal, signaleGueltig, UebergangFehler, ziel, type Ereignis, type Zustand } from './zustand.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Die Maschine — ein Scope, ein Lebenszyklus.
//
// Sie besitzt Plan, Strom und Zustand. Vom Chart weiss sie nichts, und das ist
// Absicht: PLAN.md §9.2.
// ─────────────────────────────────────────────────────────────────────────────

export interface MaschineOptionen {
  readonly plan: Plan;
  readonly umgebung: Umgebung;
  readonly band: Rechenband;
  readonly uhr: Uhr;
  readonly timeframe: Timeframe;
  readonly tracker?: Tracker;
  /** `strict` haelt an, wenn der Warmup nicht zu decken ist; `kulant` laeuft degradiert weiter. */
  readonly warmupPolitik?: 'strict' | 'kulant';
}

export interface SchrittErgebnis {
  readonly zustand: Zustand;
  readonly werte: ReadonlyMap<string, unknown>;
  /** Waehrend des Warmups gerechnet, aber nicht gueltig. */
  readonly gueltig: boolean;
}

export class Maschine {
  readonly journal = new Journal();
  readonly plan: Plan;

  #zustand: Zustand = 'IDLE';
  #laeufer: Laeufer;
  #timeframe: Timeframe;
  #tracker: Tracker | undefined;
  #warmupPolitik: 'strict' | 'kulant';
  #uhr: Uhr;
  #gesehen = 0;
  #letzteBarZeit: number | null = null;
  #gesundeInFolge = 0;

  constructor(opt: MaschineOptionen) {
    this.plan = opt.plan;
    this.#laeufer = new Laeufer({ plan: opt.plan, umgebung: opt.umgebung, band: opt.band, uhr: opt.uhr });
    this.#timeframe = opt.timeframe;
    this.#tracker = opt.tracker;
    this.#warmupPolitik = opt.warmupPolitik ?? 'kulant';
    this.#uhr = opt.uhr;
  }

  get zustand(): Zustand {
    return this.#zustand;
  }

  get gesehen(): number {
    return this.#gesehen;
  }

  /**
   * Ein Uebergang, zweifach protokolliert.
   *
   * `erzwungen` ist erlaubt — aber nur mit Begruendung, und beides steht im
   * Journal. Ein Schalter ohne Spur ist ein Schalter, den spaeter niemand
   * erklaeren kann (PLAN.md §4.2).
   */
  uebergang(
    e: Ereignis,
    opt: { guards?: Record<string, boolean>; erzwungen?: boolean; grund?: string; urheber?: string } = {},
  ): Zustand {
    const nach = ziel(this.#zustand, e);
    if (nach === null) {
      if (!opt.erzwungen) throw new UebergangFehler(this.#zustand, e);
      this.journal.schreibe({
        ts: this.#uhr.jetzt(),
        art: 'gescheitert',
        von: this.#zustand,
        nach: this.#zustand,
        ereignis: e,
        grund: opt.grund ?? 'erzwungen, aber kein Ziel definiert',
      });
      return this.#zustand;
    }

    const kopf = {
      ts: this.#uhr.jetzt(),
      von: this.#zustand,
      nach,
      ereignis: e,
      ...(opt.guards ? { guards: opt.guards } : {}),
      ...(opt.erzwungen ? { erzwungen: true } : {}),
      ...(opt.grund ? { grund: opt.grund } : {}),
      ...(opt.urheber ? { urheber: opt.urheber } : {}),
    };
    this.journal.schreibe({ ...kopf, art: 'vorhaben' });
    this.#zustand = nach;
    this.journal.schreibe({ ...kopf, art: 'vollzogen' });
    return nach;
  }

  starte(): void {
    this.uebergang('start');
    this.uebergang('resolve_ok', { guards: { zyklenfrei: true, schemataPassen: true } });
  }

  /** Eine Bar. Waehrend `WARMUP` wird gerechnet, aber nichts ist gueltig. */
  schritt(bar: Bar): SchrittErgebnis {
    if (this.#zustand === 'HALTED' || this.#zustand === 'RETIRED' || this.#zustand === 'IDLE') {
      return { zustand: this.#zustand, werte: new Map(), gueltig: false };
    }

    // Luecke erkennen, bevor gerechnet wird — ein Indikator ueber ein Loch
    // hinweg ist falsch, nicht ungenau.
    if (this.#letzteBarZeit !== null) {
      const erwartet = this.#letzteBarZeit + dauer(this.#timeframe);
      if (bar.t > erwartet && this.#zustand === 'LIVE') {
        this.uebergang('gap_detected', { guards: { luecke: true } });
      }
    }
    this.#letzteBarZeit = bar.t;

    const werte = this.#laeufer.schritt(bar);
    this.#gesehen += 1;

    if (this.#zustand === 'WARMUP' && this.#gesehen >= this.plan.warmupBars) {
      this.uebergang('coverage_ok', {
        guards: { abdeckung: true, luecken: true },
      });
    }
    if (this.#zustand === 'BACKFILL') {
      this.#gesundeInFolge += 1;
      // Hysterese: drei gesunde Bars, nicht eine. Sonst flattert es.
      if (this.#gesundeInFolge >= 3) {
        this.#gesundeInFolge = 0;
        this.uebergang('gap_closed', { guards: { hysterese: true } });
      }
    }

    // Der Waechter: das Error-Budget ist der EINZIGE Weg, auf dem eine Maschine
    // sich selbst anhaelt (PLAN.md §6.2).
    if (this.#tracker?.budgetErschoepft('calc', this.plan.scopeKey)) {
      this.uebergang('budget_exhausted', { guards: { budget: false } });
    }

    return {
      zustand: this.#zustand,
      werte,
      gueltig: signaleGueltig(this.#zustand),
    };
  }

  /** Warmup ist nicht zu decken — PLAN.md §12/D38. */
  warmupUnmoeglich(grund: string): void {
    if (this.#warmupPolitik === 'strict') {
      this.uebergang('resolve_failed', { grund });
    } else {
      this.uebergang('coverage_impossible', { grund });
    }
  }
}
