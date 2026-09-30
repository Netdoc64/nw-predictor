// ─────────────────────────────────────────────────────────────────────────────
// Die Fehlercodes — PLAN.md §6.2.
//
// EINE Datei, und ein Drift-Test haelt sie sauber: kein doppelter Code, jeder
// mit Schwere, Budgetklasse und Wiederholbarkeit. Wer einen Code hinzufuegt
// und die Klasse vergisst, bekommt einen roten Lauf statt einer stillen
// Vorgabe — denn die Budgetklasse ist es, die spaeter eine Maschine anhaelt.
// ─────────────────────────────────────────────────────────────────────────────

export type Schwere = 'info' | 'warn' | 'error' | 'fatal';

export type BudgetKlasse = 'feed' | 'calc' | 'model' | 'render' | 'io' | 'global';

export interface CodeEintrag {
  readonly schwere: Schwere;
  readonly klasse: BudgetKlasse;
  /** Darf der Aufrufer es noch einmal versuchen? Falsch gesetzt = Endlosschleife. */
  readonly wiederholbar: boolean;
  readonly text: string;
}

export const CODES = {
  // ── Registry ──
  'VP-REG-0001': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Definition nicht gefunden' },
  'VP-REG-0002': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Zyklus im Plan' },
  'VP-REG-0003': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Eingang passt nicht zum Schema' },
  'VP-REG-0004': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Ordnungszahl verletzt' },
  'VP-REG-0005': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Eingang unbelegt' },
  'VP-REG-0006': { schwere: 'error', klasse: 'io', wiederholbar: true, text: 'Registry-Datei unlesbar' },
  'VP-REG-0007': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Parameter nicht kanonisierbar' },
  'VP-REG-0008': { schwere: 'error', klasse: 'io', wiederholbar: true, text: 'Fremdschreiber — nichts geschrieben' },
  'VP-REG-0009': { schwere: 'warn', klasse: 'calc', wiederholbar: false, text: 'Definition ist abgekuendigt' },

  // ── Maschine ──
  'VP-MCH-0001': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Uebergang nicht erlaubt' },
  'VP-MCH-0002': { schwere: 'warn', klasse: 'feed', wiederholbar: true, text: 'Warmup unvollstaendig' },
  'VP-MCH-0003': { schwere: 'error', klasse: 'global', wiederholbar: false, text: 'Lease verloren' },
  'VP-MCH-0004': { schwere: 'warn', klasse: 'calc', wiederholbar: false, text: 'Erzwungener Uebergang' },

  // ── Feed ──
  'VP-FEED-0011': { schwere: 'warn', klasse: 'feed', wiederholbar: true, text: 'Bar doppelt empfangen' },
  'VP-FEED-0012': { schwere: 'error', klasse: 'feed', wiederholbar: false, text: 'Zeitstempel in der Zukunft' },
  'VP-FEED-0021': { schwere: 'warn', klasse: 'feed', wiederholbar: false, text: 'Bar ausserhalb des Umsortierfensters' },
  'VP-FEED-0022': { schwere: 'warn', klasse: 'feed', wiederholbar: true, text: 'Luecke im Bar-Strom' },
  'VP-FEED-0031': { schwere: 'error', klasse: 'feed', wiederholbar: false, text: 'Bar unplausibel (high/low/close)' },
  'VP-FEED-0041': { schwere: 'warn', klasse: 'feed', wiederholbar: true, text: 'Feed veraltet' },

  // ── Rechnung ──
  'VP-CALC-0001': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Knoten hat geworfen' },
  'VP-CALC-0002': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Ergebnis ist kein endlicher Wert' },
  'VP-CALC-0003': { schwere: 'warn', klasse: 'calc', wiederholbar: true, text: 'Zeitbudget des Knotens ueberschritten' },

  // ── Modell ──
  'VP-MODEL-0001': { schwere: 'error', klasse: 'model', wiederholbar: false, text: 'Modell nicht ladbar' },
  'VP-MODEL-0002': { schwere: 'error', klasse: 'model', wiederholbar: false, text: 'Vorhersage ist NaN oder unendlich' },
  'VP-MODEL-0003': { schwere: 'warn', klasse: 'model', wiederholbar: false, text: 'Fallback-Modell in Benutzung' },

  // ── Handel und Gewinnrechnung ──
  'VP-TRADE-0001': { schwere: 'warn', klasse: 'calc', wiederholbar: false, text: 'Order unter Mindestgroesse — verworfen' },
  'VP-TRADE-0002': { schwere: 'warn', klasse: 'calc', wiederholbar: false, text: 'Order abgelehnt' },
  'VP-TRADE-0003': { schwere: 'error', klasse: 'calc', wiederholbar: false, text: 'Kontodeckung reicht nicht' },
  'VP-TRADE-0004': { schwere: 'fatal', klasse: 'calc', wiederholbar: false, text: 'Geld-Invariante verletzt' },
  'VP-TRADE-0005': { schwere: 'warn', klasse: 'calc', wiederholbar: false, text: 'Position liquidiert' },

  // ── Chart ──
  'VP-CHART-0011': { schwere: 'warn', klasse: 'render', wiederholbar: true, text: 'Revision uebersprungen — Snapshot noetig' },
  'VP-CHART-0021': { schwere: 'info', klasse: 'render', wiederholbar: false, text: 'Layer vereinfacht gezeichnet' },
  'VP-CHART-0031': { schwere: 'error', klasse: 'render', wiederholbar: false, text: 'Layer-Art vom Treiber nicht unterstuetzt' },

  // ── MCP ──
  'VP-MCP-0001': { schwere: 'warn', klasse: 'global', wiederholbar: false, text: 'Werkzeug ausserhalb des Ausschnitts' },
  'VP-MCP-0002': { schwere: 'warn', klasse: 'global', wiederholbar: true, text: 'Flaechen-Budget erschoepft' },
  'VP-MCP-0003': { schwere: 'error', klasse: 'global', wiederholbar: false, text: 'Vergleich abgelehnt — Pruefstand weicht ab' },

  // ── Sync und Speicher ──
  'VP-SYNC-0001': { schwere: 'warn', klasse: 'io', wiederholbar: true, text: 'dependency-map veraltet' },
  'VP-STORE-0001': { schwere: 'error', klasse: 'io', wiederholbar: true, text: 'Schreiben fehlgeschlagen' },
  'VP-STORE-0002': { schwere: 'error', klasse: 'io', wiederholbar: false, text: 'Inhalt passt nicht zum Hash' },
} as const satisfies Record<string, CodeEintrag>;

export type ErrorCode = keyof typeof CODES;

export function eintrag(code: ErrorCode): CodeEintrag {
  return CODES[code];
}

/** Grenzwerte je Klasse — PLAN.md §6.2. Ueberschreitung haelt eine Maschine an. */
export const BUDGETS: Record<BudgetKlasse, { fensterMs: number; grenze: number }> = {
  feed: { fensterMs: 300_000, grenze: 20 },
  calc: { fensterMs: 300_000, grenze: 10 },
  model: { fensterMs: 900_000, grenze: 5 },
  render: { fensterMs: 60_000, grenze: 50 },
  io: { fensterMs: 300_000, grenze: 30 },
  global: { fensterMs: 900_000, grenze: 20 },
};
