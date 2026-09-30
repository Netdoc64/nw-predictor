import { fix, fixAlsText, type Fix, type TimeMs } from '@vp/core-ids';
import {
  ChartFehler, FARBE_KAUF, FARBE_VERKAUF, farbe, hatWert, pruefeRev,
  type ChartOp, type LayerArt, type LayerSpec, type Marker, type Punkt, type Rueckschau, type Treiber,
} from './vertrag.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Treiber fuer TradingView Lightweight Charts 5.x.
//
// Zwei Eigenheiten dieser Bibliothek sind die Kanten, an denen ein Treiber
// still falsch wird:
//
//   Zeit     Lightweight rechnet in UTC-SEKUNDEN, der Vertrag in Millisekunden.
//            Ohne Umrechnung liegt der Chart im Jahr 51.000 (§12/A1).
//   Zahlen   Lightweight nimmt `number`. Die Umwandlung aus Festkomma passiert
//            HIER und nirgends sonst — an der Oberflaeche, wo sie hingehoert.
//
// Die Bibliothek wird hineingereicht, nicht importiert. Im Browser ist es das
// echte `LightweightCharts`, im Test eine Attrappe — und `rueckschau()` fragt
// in beiden Faellen die BIBLIOTHEK (`series.data()`), nicht eine Kopie hier.
// ─────────────────────────────────────────────────────────────────────────────

type LwcZeit = number;

interface LwcSerie {
  setData(daten: unknown[]): void;
  update(eintrag: unknown): void;
  data(): readonly Record<string, unknown>[];
  applyOptions(o: Record<string, unknown>): void;
}

interface LwcMarkerPlugin {
  setMarkers(m: unknown[]): void;
  markers(): readonly Record<string, unknown>[];
}

interface LwcChart {
  addSeries(def: unknown, optionen?: Record<string, unknown>, paneIndex?: number): LwcSerie;
  timeScale(): { fitContent(): void };
  remove(): void;
}

export interface LwcBibliothek {
  createChart(container: unknown, optionen?: Record<string, unknown>): LwcChart;
  createSeriesMarkers(serie: LwcSerie, marker?: unknown[]): LwcMarkerPlugin;
  CandlestickSeries: unknown;
  LineSeries: unknown;
  AreaSeries: unknown;
  HistogramSeries: unknown;
}

interface Layer {
  spec: LayerSpec;
  serie: LwcSerie | null;
  plugin: LwcMarkerPlugin | null;
  rev: number;
  vorlaeufig: boolean;
  vereinfacht: string | null;
  sichtbar: boolean;
}

const zuLwc = (t: TimeMs): LwcZeit => Math.floor(t / 1000);
const vonLwc = (t: unknown): TimeMs => Number(t) * 1000;
const zahl = (v: Fix): number => Number(fixAlsText(v, 8));

/** Bis zu dieser Zahl tragen Marker ihre Beschriftung. */
export const MARKER_TEXT_BIS = 40;

export class LightweightTreiber implements Treiber {
  readonly name = 'lightweight';
  readonly kann: ReadonlySet<LayerArt> = new Set<LayerArt>(['candles', 'line', 'area', 'histogram', 'markers']);

  readonly #lib: LwcBibliothek;
  readonly #chart: LwcChart;
  readonly #layer = new Map<string, Layer>();
  readonly #panes = new Map<string, number>([['price', 0]]);

  constructor(container: unknown, lib: LwcBibliothek, optionen: Record<string, unknown> = {}) {
    this.#lib = lib;
    this.#chart = lib.createChart(container, {
      autoSize: true,
      layout: { attributionLogo: false },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        // Voreinstellung ist 0,5 px je Bar. Bei 4.329 Stundenbars in einem
        // halben Bildschirm passt dann nur ein Sechstel hinein — `fitContent()`
        // kann nicht enger schieben, als die Bibliothek erlaubt, und der Chart
        // zeigte Mai bis Juli, waehrend ECharts das ganze Halbjahr zeigte.
        minBarSpacing: 0.01,
      },
      ...optionen,
    });
  }

  #paneIndex(pane: string): number {
    let i = this.#panes.get(pane);
    if (i === undefined) {
      i = this.#panes.size;
      this.#panes.set(pane, i);
    }
    return i;
  }

  /** Die Kerzenreihe des Preisfensters — dort haengen die Marker. */
  #preisSerie(): LwcSerie | null {
    for (const l of this.#layer.values()) {
      if (l.spec.pane === 'price' && l.spec.art === 'candles' && l.serie) return l.serie;
    }
    for (const l of this.#layer.values()) {
      if (l.spec.pane === 'price' && l.serie) return l.serie;
    }
    return null;
  }

  lege(spec: LayerSpec): void {
    if (this.#layer.has(spec.id)) return;
    if (!this.kann.has(spec.art)) {
      throw new ChartFehler('VP-CHART-0031', `${this.name} kann ${spec.art} nicht (Layer ${spec.id})`);
    }
    const f = farbe(spec.stil);
    const format = { type: 'price', precision: spec.format.praezision, minMove: 10 ** -spec.format.praezision };
    const pane = this.#paneIndex(spec.pane);

    const layer: Layer = { spec, serie: null, plugin: null, rev: -1, vorlaeufig: false, vereinfacht: null, sichtbar: spec.sichtbar };

    switch (spec.art) {
      case 'candles':
        layer.serie = this.#chart.addSeries(this.#lib.CandlestickSeries, { priceFormat: format, title: spec.titel }, pane);
        break;
      case 'line':
        layer.serie = this.#chart.addSeries(this.#lib.LineSeries, { color: f, lineWidth: 2, priceFormat: format, title: spec.titel }, pane);
        break;
      case 'area':
        layer.serie = this.#chart.addSeries(
          this.#lib.AreaSeries,
          { lineColor: f, topColor: `${f}55`, bottomColor: `${f}08`, priceFormat: format, title: spec.titel },
          pane,
        );
        break;
      case 'histogram':
        layer.serie = this.#chart.addSeries(this.#lib.HistogramSeries, { color: f, priceFormat: format, title: spec.titel }, pane);
        break;
      case 'markers': {
        const ziel = this.#preisSerie();
        if (!ziel) {
          // Vertrag: sichtbar vereinfachen, nie still weglassen (§12/E53).
          layer.vereinfacht = 'Marker ohne Preisreihe — Layer bleibt leer';
          break;
        }
        layer.plugin = this.#lib.createSeriesMarkers(ziel, []);
        break;
      }
    }
    if (!spec.sichtbar) layer.serie?.applyOptions({ visible: false });
    this.#layer.set(spec.id, layer);
  }

  #eintrag(l: Layer, p: Punkt): Record<string, unknown> {
    const time = zuLwc(p.t);
    if (l.spec.art === 'candles') {
      const { o, h, l: tief, c } = p.werte;
      if (o == null || h == null || tief == null || c == null) return { time };
      return { time, open: zahl(o), high: zahl(h), low: zahl(tief), close: zahl(c) };
    }
    const w = p.werte['wert'];
    // Whitespace: ein Zeitpunkt ohne Wert. Lightweight zeichnet dort eine Luecke.
    return w == null ? { time } : { time, value: zahl(w) };
  }

  #zuPunkt(l: Layer, e: Record<string, unknown>): Punkt {
    const t = vonLwc(e['time']);
    const f = (k: string): Fix | null => (typeof e[k] === 'number' ? fix(String(e[k])) : null);
    if (l.spec.art === 'candles') return { t, werte: { o: f('open'), h: f('high'), l: f('low'), c: f('close') } };
    return { t, werte: { wert: f('value') } };
  }

  #marker(m: Marker, mitText: boolean): Record<string, unknown> {
    const kauf = m.art === 'kauf';
    return {
      time: zuLwc(m.t),
      position: kauf ? 'belowBar' : 'aboveBar',
      color: kauf ? FARBE_KAUF : m.art === 'verkauf' ? FARBE_VERKAUF : '#9e9e9e',
      shape: kauf ? 'arrowUp' : m.art === 'verkauf' ? 'arrowDown' : 'circle',
      ...(mitText ? { text: m.text } : {}),
    };
  }

  wende(ops: readonly ChartOp[]): void {
    for (const op of ops) {
      const l = this.#layer.get(op.layer);
      if (!l) throw new Error(`Layer ${op.layer} nicht angelegt`);
      pruefeRev(op.layer, l.rev, op);
      l.rev = op.rev;

      switch (op.op) {
        case 'snapshot':
          l.serie?.setData(op.punkte.map((p) => this.#eintrag(l, p)));
          l.vorlaeufig = false;
          break;
        case 'append':
          for (const p of op.punkte) l.serie?.update(this.#eintrag(l, p));
          l.vorlaeufig = false;
          break;
        case 'updateLast':
          // Gleiche Zeit ersetzt den letzten Eintrag — so will es Lightweight.
          l.serie?.update(this.#eintrag(l, op.punkt));
          l.vorlaeufig = op.vorlaeufig;
          if (op.vorlaeufig) l.vereinfacht = 'vorlaeufige Bar wird nicht gesondert gezeichnet';
          break;
        case 'replaceRange':
        case 'removeRange': {
          if (!l.serie) break;
          // `data()` liefert keinen Whitespace — ein replaceRange ueber einen
          // Warmup-Bereich verliert dessen Luecken-Zeitpunkte. Die Werte
          // stimmen; nur die Zeitachse wird dort ggf. enger.
          const bisher = l.serie.data().map((e) => this.#zuPunkt(l, e));
          const neu = [
            ...bisher.filter((p) => p.t < op.von),
            ...(op.op === 'replaceRange' ? op.punkte : []),
            ...bisher.filter((p) => p.t > op.bis),
          ].sort((a, b) => a.t - b.t);
          l.serie.setData(neu.map((p) => this.#eintrag(l, p)));
          break;
        }
        case 'setMarkers': {
          // Ab einer Dichte ueberdecken Beschriftungen die Kerzen (§12/E61) —
          // dann nur Pfeile, und das steht SICHTBAR in `vereinfacht`.
          const mitText = op.marker.length <= MARKER_TEXT_BIS;
          l.vereinfacht = mitText ? null : `Beschriftung ab ${MARKER_TEXT_BIS} Markern ausgeblendet`;
          // Lightweight verlangt aufsteigend sortierte Marker — sonst wirft es.
          l.plugin?.setMarkers([...op.marker].sort((a, b) => a.t - b.t).map((m) => this.#marker(m, mitText)));
          break;
        }
        case 'setVisible':
          l.sichtbar = op.sichtbar;
          l.serie?.applyOptions({ visible: op.sichtbar });
          break;
        case 'reset':
          l.serie?.setData([]);
          l.plugin?.setMarkers([]);
          l.vorlaeufig = false;
          break;
      }
    }
  }

  /**
   * Zeitachse auf alle Daten.
   *
   * Nicht sofort: mit `autoSize` misst Lightweight sein Gefaess erst im naechsten
   * Frame. Ein `fitContent()` davor passt auf Breite 0 — und der Chart zeigte in
   * der ersten Sichtprobe nur Mai bis Juli statt des ganzen Halbjahrs.
   */
  passeAn(): void {
    const tu = () => this.#chart.timeScale().fitContent();
    tu();
    const raf = (globalThis as { requestAnimationFrame?: (f: () => void) => void }).requestAnimationFrame;
    if (raf) raf(() => raf(tu));
  }

  rueckschau(layer: string): Rueckschau {
    const l = this.#layer.get(layer);
    if (!l) throw new Error(`Layer ${layer} nicht angelegt`);
    const punkte = l.serie ? l.serie.data().map((e) => this.#zuPunkt(l, e)).filter(hatWert) : [];
    const marker: Marker[] = (l.plugin?.markers() ?? []).map((m) => ({
      t: vonLwc(m['time']),
      art: m['shape'] === 'arrowUp' ? 'kauf' : m['shape'] === 'arrowDown' ? 'verkauf' : 'hinweis',
      text: String(m['text'] ?? ''),
    }));
    return { punkte, marker, sichtbar: l.sichtbar, rev: l.rev, vorlaeufigAmEnde: l.vorlaeufig, vereinfacht: l.vereinfacht };
  }

  zerstoere(): void {
    this.#chart.remove();
    this.#layer.clear();
  }
}
