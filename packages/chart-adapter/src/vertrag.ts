import type { Fix, TimeMs } from '@vp/core-ids';

// ─────────────────────────────────────────────────────────────────────────────
// Der Chart-Vertrag — PLAN.md §5.1 bis §5.3.
//
// Neutral: keine Bibliothek, kein DOM, keine Farbe als Hexwert. Was hier steht,
// muss jeder Treiber koennen oder SICHTBAR vereinfachen — nie still weglassen.
// ─────────────────────────────────────────────────────────────────────────────

export type LayerArt =
  | 'candles' | 'line' | 'area' | 'histogram' | 'band'
  | 'markers' | 'priceLines' | 'boxes' | 'heatmap';

export interface LayerSpec {
  readonly id: string;
  readonly titel: string;
  readonly art: LayerArt;
  /** `price` oder ein benanntes Fenster darunter. */
  readonly pane: 'price' | `sub:${string}`;
  readonly skala: { readonly id: string; readonly modus: 'normal' | 'log' | 'prozent'; readonly autoFit: boolean };
  readonly quelle: { readonly knoten: string; readonly nodeHash: string };
  /** Semantisches Token — `palette:3`, nie `#ff0000`. Der Treiber setzt es in seine Farbe um. */
  readonly stil: string;
  readonly format: { readonly praezision: number };
  readonly ordnung: number;
  readonly sichtbar: boolean;
  readonly vereinfachbar: boolean;
}

export interface Punkt {
  readonly t: TimeMs;
  /**
   * `null` ist WHITESPACE — ein Zeitpunkt ohne Wert. Waehrend des Warmups und
   * ueber Luecken. Nie eine 0: eine 0 waere eine Behauptung.
   */
  readonly werte: Readonly<Record<string, Fix | null>>;
}

export interface Marker {
  readonly t: TimeMs;
  readonly art: 'kauf' | 'verkauf' | 'hinweis';
  readonly text: string;
  /**
   * Preis, an dem der Marker steht. Lightweight braucht ihn nicht (setzt am
   * Bar an), ECharts schon. Fehlt er, vereinfacht ECharts sichtbar.
   */
  readonly preis?: Fix;
  /** Beleg, den ein Klick oeffnen soll (PLAN.md §4.8). */
  readonly beleg?: string;
}

export type ResetGrund = 'plan-changed' | 'overflow' | 'rev-luecke' | 'meta-changed' | 'scope-wechsel';

export type ChartOp =
  | { readonly op: 'snapshot'; readonly layer: string; readonly rev: number; readonly punkte: readonly Punkt[] }
  | { readonly op: 'append'; readonly layer: string; readonly rev: number; readonly punkte: readonly Punkt[] }
  | { readonly op: 'updateLast'; readonly layer: string; readonly rev: number; readonly punkt: Punkt; readonly vorlaeufig: boolean }
  | { readonly op: 'replaceRange'; readonly layer: string; readonly rev: number; readonly von: TimeMs; readonly bis: TimeMs; readonly punkte: readonly Punkt[] }
  | { readonly op: 'removeRange'; readonly layer: string; readonly rev: number; readonly von: TimeMs; readonly bis: TimeMs }
  | { readonly op: 'setMarkers'; readonly layer: string; readonly rev: number; readonly marker: readonly Marker[] }
  | { readonly op: 'setVisible'; readonly layer: string; readonly rev: number; readonly sichtbar: boolean }
  | { readonly op: 'reset'; readonly layer: string; readonly rev: number; readonly grund: ResetGrund };

export interface Rueckschau {
  /**
   * Nur Punkte MIT Wert. Whitespace ist nicht beobachtbar.
   *
   * Das war zuerst anders — und die Attrappe in den Tests gab Whitespace
   * zurueck. Erst die Sichtprobe im Browser zeigte, dass die ECHTE
   * Lightweight-Bibliothek `series.data()` ohne Whitespace liefert: EMA(50)
   * hielt 49 Punkte weniger als in ECharts, genau die Warmup-Laenge. Ein
   * Vertrag, den eine Bibliothek nicht einhalten KANN, ist keiner. Gezeichnet
   * wird Whitespace trotzdem — nur zurueckfragen laesst er sich nicht.
   */
  readonly punkte: readonly Punkt[];
  /** Aufsteigend nach Zeit — gleich, in welcher Reihenfolge `setMarkers` sie brachte. */
  readonly marker: readonly Marker[];
  readonly sichtbar: boolean;
  readonly rev: number;
  readonly vorlaeufigAmEnde: boolean;
  /** Was der Treiber vereinfacht hat — sichtbar, nicht still (§12/E53). */
  readonly vereinfacht: string | null;
}

export interface Treiber {
  readonly name: string;
  readonly kann: ReadonlySet<LayerArt>;
  /** Layer anlegen. Muss vor dem ersten Op fuer diesen Layer geschehen. */
  lege(spec: LayerSpec): void;
  wende(ops: readonly ChartOp[]): void;
  /**
   * Was haelt der Chart WIRKLICH? Echte Treiber fragen die Bibliothek selbst —
   * nicht eine eigene Schattenkopie. Sonst prueft der Test den Treiber gegen
   * sich selbst.
   */
  rueckschau(layer: string): Rueckschau;
  zerstoere(): void;
}

export class ChartFehler extends Error {
  readonly code: 'VP-CHART-0011' | 'VP-CHART-0021' | 'VP-CHART-0031';

  constructor(code: 'VP-CHART-0011' | 'VP-CHART-0021' | 'VP-CHART-0031', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'ChartFehler';
  }
}

/** Hat der Punkt mindestens einen Wert? Whitespace nicht. */
export function hatWert(p: Punkt): boolean {
  return Object.values(p.werte).some((v) => v !== null);
}

/** Revisionspruefung, gemeinsam fuer alle Treiber — ein Vertrag, eine Stelle. */
export function pruefeRev(layer: string, bisher: number, op: ChartOp): void {
  if (op.op === 'snapshot' || op.op === 'reset' || bisher < 0) return;
  if (op.rev !== bisher + 1) {
    // Eine uebersprungene Revision wird NICHT gezeichnet. Ein Chart, der still
    // ein Loch zeigt, ist schlimmer als einer, der neu laedt.
    throw new ChartFehler('VP-CHART-0011', `${layer}: Revision ${op.rev} nach ${bisher} — Snapshot noetig`);
  }
}

/**
 * Die Palette — zwoelf Farben, die auf hellem und dunklem Grund lesbar sind.
 *
 * Sie steht HIER und nicht in jedem Treiber, damit beide Treiber dieselbe
 * Farbe fuer denselben Layer zeigen. Welche Farbe ein Layer bekommt, entscheidet
 * sein nodeHash (§12/E63): nach einem Neustart hat die EMA dieselbe Farbe.
 */
export const PALETTE = [
  '#2962ff', '#e65100', '#2e7d32', '#6a1b9a', '#00838f', '#c62828',
  '#f9a825', '#4527a0', '#558b2f', '#ad1457', '#0277bd', '#5d4037',
] as const;

export const FARBE_KAUF = '#26a69a';
export const FARBE_VERKAUF = '#ef5350';

export function farbe(stil: string): string {
  const m = /^palette:(\d+)$/.exec(stil);
  if (!m) return PALETTE[0];
  return PALETTE[Number(m[1]) % PALETTE.length]!;
}

export function stilAusHash(nodeHash: string): string {
  return `palette:${Number.parseInt(nodeHash.slice(0, 6), 16) % PALETTE.length}`;
}
