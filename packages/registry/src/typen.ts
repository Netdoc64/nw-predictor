import type { Urn } from '@vp/core-ids';

// ─────────────────────────────────────────────────────────────────────────────
// Die vertikale Achse — PLAN.md §3.1.
//
// Jede Art hat eine Ordnungszahl, und ein Knoten darf nur auf ECHT kleinere
// zeigen. Das erschlaegt Zyklen mit einer Regel statt mit einem Algorithmus —
// der Topo-Lauf in `resolve.ts` ist danach nur noch die Gegenprobe.
// ─────────────────────────────────────────────────────────────────────────────

export const ORDNUNG = {
  venue: 0,
  calendar: 0,
  feed: 1,
  series: 2,
  transform: 3,
  indicator: 4,
  feature: 5,
  model: 6,
  signal: 7,
  decision: 8,
  execution: 9,
  position: 10,
  pnl: 11,
  layer: 12,
} as const;

export type Kind = keyof typeof ORDNUNG;

export function istKind(s: string): s is Kind {
  return Object.hasOwn(ORDNUNG, s);
}

export interface EingangsSchacht {
  readonly name: string;
  readonly nimmt: readonly Kind[];
  /**
   * Welche Ausgabeschemata dieser Eingang LESEN kann, samt Hauptversion
   * (`vp://schema/zahl@1`) — PLAN.md §12/C30.
   *
   * Der Konsument deklariert, die Quelle nennt ihr `ausgabeSchema`, und
   * `resolve()` vergleicht beides. Ohne diese Angabe NAHM der Konsument das
   * Schema nur an: eine Quelle, die auf `@2` hebt, liefe still in jeden Knoten,
   * der noch `@1` liest. Pflicht, auch wenn es nur ein Eintrag ist.
   */
  readonly schema: readonly string[];
  readonly optional?: boolean;
}

/**
 * Wie weit ein Knoten zurueckschaut.
 *
 * `barsAus` nennt den PARAMETER, aus dem sich die Zahl ergibt — nicht eine
 * feste Zahl. Der erste Anlauf hatte hier `bars: 20` stehen, und eine EMA(50)
 * rechnete ihren Warmup mit 20: der Plan meldete `LIVE`, waehrend der Indikator
 * noch anlief. Ein Warmup, der nicht an den Parametern haengt, ist keiner.
 *
 * `konvergenz: 'exponentiell'` ist die ehrliche Antwort fuer rekursive
 * Indikatoren: eine EMA hat theoretisch unendlichen Lookback. `faktor` macht
 * daraus eine endliche Zahl (5 × Periode ist die uebliche Faustregel).
 */
export interface Lookback {
  readonly bars?: number;
  readonly barsAus?: string;
  readonly konvergenz?: 'exponentiell';
  readonly faktor?: number;
}

/**
 * Wie ein Knoten im Chart erscheint — PLAN.md §5.
 *
 * Das ist die Verknuepfung, um die es geht: der CHART weiss nicht, dass es eine
 * EMA gibt. Die Definition sagt, dass ihr Ausgang eine Linie im Preisfenster
 * ist, und die Bindung setzt das um. Wer einen neuen Indikator anlegt, bekommt
 * seine Darstellung damit ohne eine Zeile Chart-Code.
 *
 * Die Arten sind hier als Zeichenketten gefuehrt und nicht aus `chart-adapter`
 * importiert: die Registry darf den Chart nicht kennen (PLAN.md §9.2).
 */
export interface Darstellung {
  readonly art: 'candles' | 'line' | 'area' | 'histogram' | 'markers';
  /** `preis` = ueber den Kerzen; `eigen` = eigenes Fenster darunter, benannt nach dem Knoten. */
  readonly pane: 'preis' | 'eigen';
  /** Bei strukturierten Ausgaengen: welches Feld gezeichnet wird. */
  readonly feld?: string;
  readonly praezision?: number;
}

export interface Definition {
  readonly urn: Urn;
  readonly darstellung?: Darstellung;
  readonly kind: Kind;
  readonly titel: string;
  readonly eingaenge: readonly EingangsSchacht[];
  /** Vorgabewerte. Werden beim Schreiben einer Instanz materialisiert (§12/C29). */
  readonly params: Readonly<Record<string, unknown>>;
  readonly ausgabeSchema: string;
  readonly lookback: Lookback;
  readonly reinheit: 'rein' | 'zustandsbehaftet';
  readonly kosten: { readonly cpu: 'niedrig' | 'mittel' | 'hoch'; readonly io: boolean };
  readonly faehigkeiten?: readonly string[];
  readonly abgekuendigt?: {
    readonly seit: string;
    readonly ersetztDurch?: Urn;
    readonly entferntAb: string;
  };
}

export class LookbackFehler extends Error {
  readonly code = 'VP-REG-0003' as const;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'LookbackFehler';
  }
}

/**
 * Wie viele Bars ein Knoten braucht, bevor sein Wert etwas bedeutet.
 *
 * `params` sind die MATERIALISIERTEN Parameter der Instanz, nicht die Defaults
 * der Definition.
 */
export function lookbackBars(l: Lookback, params: Readonly<Record<string, unknown>>): number {
  let basis: number;
  if (l.barsAus !== undefined) {
    const v = params[l.barsAus];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new LookbackFehler(
        `lookback.barsAus zeigt auf "${l.barsAus}", dort steht ${JSON.stringify(v)} — ` +
          'erwartet wird eine nicht-negative Ganzzahl',
      );
    }
    basis = v;
  } else if (typeof l.bars === 'number') {
    basis = l.bars;
  } else {
    throw new LookbackFehler('lookback braucht `bars` oder `barsAus`');
  }
  if (l.konvergenz === 'exponentiell') {
    if (typeof l.faktor !== 'number' || l.faktor <= 0) {
      throw new LookbackFehler('lookback.konvergenz braucht einen positiven faktor');
    }
    return Math.ceil(basis * l.faktor);
  }
  return basis;
}

// ── Profil: ein benannter Satz verdrahteter Knoten ───────────────────────────

export interface KnotenSpec {
  readonly id: string;
  readonly def: Urn;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Schacht → Knoten-Id im selben Profil. */
  readonly eingaenge?: Readonly<Record<string, string>>;
}

export interface Profil {
  readonly id: string;
  readonly titel: string;
  readonly knoten: readonly KnotenSpec[];
}

// ── Strategie: die dritte Achse — PLAN.md §3.5 ───────────────────────────────

export interface Bruch {
  /** Anteil in Hundertstel-Prozent, als Ganzzahl: 100 = 1 %. Kein Float im Vertrag. */
  readonly bp: number;
}

export interface Strategie {
  readonly id: string;
  readonly profil: string;
  readonly universum: string;
  readonly entscheidung: readonly Urn[];
  readonly risiko: {
    readonly maxPositionsgroesse: Bruch;
    readonly maxGleichzeitig: number;
    readonly maxRueckgang: Bruch;
    readonly maxTagesverlust: Bruch;
  };
  readonly kosten: string;
  readonly eltern?: string;
  readonly notiz: string;
}

// ── MCP-Flaechen: die Registry der Zugaenge — PLAN.md §7.1 ────────────────────

export type FlaechenStufe = 'lesend' | 'vorschlagend' | 'steuernd';

/**
 * Eine MCP-Flaeche ist ein Registry-Eintrag wie jeder andere.
 *
 * Damit gilt fuer sie dieselbe Ordnung: versioniert, als Entwurf angelegt,
 * ausdruecklich aktiviert. Eine Flaeche, die ihren eigenen Ausschnitt
 * erweitern koennte, waere keine Grenze (PLAN.md §12/N143).
 */
export interface McpFlaeche {
  readonly id: string;
  readonly titel: string;
  /** An welche Strategie gebunden; `null` = uebergreifend. Nur uebergreifende Flaechen vergleichen. */
  readonly strategie: string | null;
  /** ALLOWLIST. Was nicht genannt ist, existiert fuer diese Flaeche nicht. */
  readonly scopeMuster: readonly string[];
  readonly werkzeugMuster: readonly string[];
  readonly stufe: FlaechenStufe;
  readonly transport: { readonly art: 'stdio' } | { readonly art: 'netz'; readonly auth: string };
  readonly budget: { readonly simLaeufeProStunde: number; readonly antwortBytes: number };
  /** Steht in Journal und Fehlern — wer war das. */
  readonly identitaet: string;
  /** Darf die Flaeche die anderen auflisten? Genau eine sollte das: die Wurzel. */
  readonly wurzel?: boolean;
}
