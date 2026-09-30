import { hash } from '@vp/core-ids';
import { BUDGETS, CODES, type BudgetKlasse, type ErrorCode, type Schwere } from './codes.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Der zentrale Fehler-Tracker — PLAN.md §6.
//
// Kein Logger. Ein Logger schreibt; dieser hier ZAEHLT und ENTSCHEIDET: die
// Guards der Maschine lesen `budgetErschoepft()`. Deshalb ist er zentral —
// nicht aus Ordnungsliebe, sondern weil sonst jede Schicht ihre eigene Idee
// davon haette, wann es zu viel ist.
// ─────────────────────────────────────────────────────────────────────────────

export interface FehlerEingabe {
  code: ErrorCode;
  nachricht?: string;
  scope?: string | null;
  node?: string | null;
  phase?: string | null;
  traceId?: string;
  /** MCP-Flaechen-Identitaet, wenn der Fehler von aussen ausgeloest wurde. */
  urheber?: string | null;
  ursache?: unknown;
  /** Zusatzfelder — gehen durch die Redaktion. */
  daten?: Record<string, unknown>;
}

export interface Fehler {
  readonly code: ErrorCode;
  readonly schwere: Schwere;
  readonly klasse: BudgetKlasse;
  readonly wiederholbar: boolean;
  readonly nachricht: string;
  readonly scope: string | null;
  readonly node: string | null;
  readonly phase: string | null;
  readonly traceId: string | null;
  readonly urheber: string | null;
  readonly fingerprint: string;
  readonly daten: Record<string, unknown>;
  readonly ursache: string | null;
  anzahl: number;
  readonly zuerst: number;
  zuletzt: number;
}

export type Senke = (f: Fehler, neu: boolean) => void;

/**
 * Felder, deren Wert gespeichert werden darf. Alles andere wird zu `[redigiert]`.
 *
 * Allowlist, nicht Blocklist: eine Blocklist vergisst das Feld, das es beim
 * naechsten Mal gibt. Geheimnisse gehoeren ohnehin nicht hierher, sondern in
 * den Business Manager — aber ein Fehlertext ist genau der Ort, an dem eins
 * versehentlich landet.
 */
const ERLAUBTE_DATENFELDER = new Set([
  'bar', 'erwartet', 'erhalten', 'anzahl', 'timeframe', 'venue', 'symbol',
  'dauerMs', 'grenze', 'revision', 'planHash', 'strategieHash', 'datenHash',
  'flaeche', 'werkzeug', 'von', 'bis', 'wert', 'schritt', 'min',
]);

const GEHEIM_RE = /(?:api[_-]?key|secret|token|passwo|bearer|authorization)/i;

function redigiere(daten: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!daten) return {};
  const raus: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(daten)) {
    if (GEHEIM_RE.test(k) || !ERLAUBTE_DATENFELDER.has(k)) {
      raus[k] = '[redigiert]';
      continue;
    }
    raus[k] = typeof v === 'bigint' ? v.toString() : v;
  }
  return raus;
}

/** Volatile Anteile raus, damit derselbe Fehler denselben Fingerabdruck hat. */
function fingerabdruck(code: string, node: string | null, nachricht: string): string {
  const form = nachricht
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<zeit>')
    .replace(/\b\d[\d_.,]*\b/g, '<zahl>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>');
  return hash(code, node ?? '', form).slice(0, 16);
}

interface Fenster {
  zeiten: number[];
}

export interface TrackerOptionen {
  /** Monotone Uhr. Budgets duerfen nicht an der Wanduhr haengen (PLAN.md §12/F73). */
  monoton?: () => number;
  /** Ab der wievielten Wiederholung nur noch jede `abtastung`-te gespeichert wird. */
  dedupeAb?: number;
  abtastung?: number;
  ringGroesse?: number;
}

export class Tracker {
  readonly #monoton: () => number;
  readonly #dedupeAb: number;
  readonly #abtastung: number;
  readonly #ringGroesse: number;

  #ring: Fehler[] = [];
  #bekannt = new Map<string, Fehler>();
  #fenster = new Map<string, Fenster>();
  #senken: Senke[] = [];

  /**
   * Der letzte Fehler, der IN einer Senke aufgetreten ist.
   *
   * Er geht bewusst nicht zurueck in den Tracker: ein Fehlerpfad, der sich
   * selbst aufruft, endet im Stapelueberlauf — und zwar genau dann, wenn
   * ohnehin schon etwas kaputt ist.
   */
  letzterSenkenFehler: unknown = null;

  constructor(opt: TrackerOptionen = {}) {
    this.#monoton = opt.monoton ?? (() => Number(process.hrtime.bigint() / 1_000_000n));
    this.#dedupeAb = opt.dedupeAb ?? 10;
    this.#abtastung = opt.abtastung ?? 20;
    this.#ringGroesse = opt.ringGroesse ?? 2_000;
  }

  senke(s: Senke): void {
    this.#senken.push(s);
  }

  melde(e: FehlerEingabe): Fehler {
    const def = CODES[e.code];
    const nachricht = e.nachricht ?? def.text;
    const node = e.node ?? null;
    const fp = fingerabdruck(e.code, node, nachricht);
    const jetzt = this.#monoton();

    const vorhanden = this.#bekannt.get(fp);
    let fehler: Fehler;
    let neu: boolean;

    if (vorhanden) {
      vorhanden.anzahl += 1;
      vorhanden.zuletzt = jetzt;
      fehler = vorhanden;
      neu = false;
      // Der ZAEHLER bleibt exakt; nur die Ablage wird duenner.
      const speichern =
        vorhanden.anzahl <= this.#dedupeAb || vorhanden.anzahl % this.#abtastung === 0;
      if (speichern) this.#ablegen(fehler);
    } else {
      fehler = {
        code: e.code,
        schwere: def.schwere,
        klasse: def.klasse,
        wiederholbar: def.wiederholbar,
        nachricht,
        scope: e.scope ?? null,
        node,
        phase: e.phase ?? null,
        traceId: e.traceId ?? null,
        urheber: e.urheber ?? null,
        fingerprint: fp,
        daten: redigiere(e.daten),
        ursache: e.ursache instanceof Error ? `${e.ursache.name}: ${e.ursache.message}` : null,
        anzahl: 1,
        zuerst: jetzt,
        zuletzt: jetzt,
      };
      this.#bekannt.set(fp, fehler);
      this.#ablegen(fehler);
      neu = true;
    }

    this.#budgetZaehlen(def.klasse, e.scope ?? null, jetzt);

    for (const s of this.#senken) {
      try {
        s(fehler, neu);
      } catch (err) {
        this.letzterSenkenFehler = err;
      }
    }
    return fehler;
  }

  #ablegen(f: Fehler): void {
    this.#ring.push(f);
    if (this.#ring.length > this.#ringGroesse) this.#ring.shift();
  }

  #schluessel(klasse: BudgetKlasse, scope: string | null): string {
    return `${scope ?? '<global>'}|${klasse}`;
  }

  #budgetZaehlen(klasse: BudgetKlasse, scope: string | null, jetzt: number): void {
    const k = this.#schluessel(klasse, scope);
    const f = this.#fenster.get(k) ?? { zeiten: [] };
    f.zeiten.push(jetzt);
    const ab = jetzt - BUDGETS[klasse].fensterMs;
    while (f.zeiten.length > 0 && f.zeiten[0]! < ab) f.zeiten.shift();
    this.#fenster.set(k, f);
  }

  /** Wie viele Fehler dieser Klasse liegen im laufenden Fenster? */
  budgetStand(klasse: BudgetKlasse, scope: string | null = null): number {
    const f = this.#fenster.get(this.#schluessel(klasse, scope));
    if (!f) return 0;
    const ab = this.#monoton() - BUDGETS[klasse].fensterMs;
    return f.zeiten.filter((t) => t >= ab).length;
  }

  /** Der Guard der Maschine — PLAN.md §4.2, Ereignis `budget_exhausted`. */
  budgetErschoepft(klasse: BudgetKlasse, scope: string | null = null): boolean {
    return this.budgetStand(klasse, scope) > BUDGETS[klasse].grenze;
  }

  letzte(n = 50): readonly Fehler[] {
    return this.#ring.slice(-n);
  }

  /** Haeufigste Fingerabdruecke — die Frage „was ist HIER eigentlich los". */
  haeufigste(n = 10): readonly Fehler[] {
    return [...this.#bekannt.values()].sort((a, b) => b.anzahl - a.anzahl).slice(0, n);
  }

  zaehler(code: ErrorCode): number {
    let summe = 0;
    for (const f of this.#bekannt.values()) if (f.code === code) summe += f.anzahl;
    return summe;
  }

  leeren(): void {
    this.#ring = [];
    this.#bekannt.clear();
    this.#fenster.clear();
  }
}

/**
 * Der Prozess-Tracker.
 *
 * Bewusst eine Instanz: zwei Tracker sind zwei Meinungen darueber, wann ein
 * Budget voll ist. Tests bauen sich ihren eigenen (`new Tracker()`).
 */
export const tracker = new Tracker();
