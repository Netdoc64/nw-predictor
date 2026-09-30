import { fix, fixAlsText, type Fix } from '@vp/core-ids';
import {
  ChartFehler, FARBE_KAUF, FARBE_VERKAUF, farbe, hatWert, pruefeRev,
  type ChartOp, type LayerArt, type LayerSpec, type Marker, type Punkt, type Rueckschau, type Treiber,
} from './vertrag.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Treiber fuer Apache ECharts 6.
//
// Der zweite Treiber ist der, der den Vertrag prueft. Solange nur Lightweight
// angeschlossen war, sah jede Entscheidung richtig aus — erst hier zeigt sich,
// was daran Lightweight war:
//
//   Zeit      ECharts rechnet in MILLISEKUNDEN, Lightweight in Sekunden.
//   Kerzen    ECharts will [open, CLOSE, LOW, HIGH] — eine andere Reihenfolge
//             als alle anderen. Vertauscht zeichnet es trotzdem, nur falsch.
//   Marker    ECharts braucht einen Preis fuer die y-Achse, Lightweight nicht.
//             Deshalb hat `Marker` ein `preis`-Feld; fehlt es, vereinfacht
//             dieser Treiber SICHTBAR.
//   Fenster   ECharts kennt keine Panes, sondern Gitter mit eigenen Achsen.
// ─────────────────────────────────────────────────────────────────────────────

interface EcOption {
  series?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface EcInstanz {
  setOption(option: EcOption, einstellungen?: { notMerge?: boolean; lazyUpdate?: boolean }): void;
  getOption(): EcOption;
  dispose(): void;
  resize?(): void;
}

export interface EcBibliothek {
  init(container: unknown, thema?: string | null, optionen?: Record<string, unknown>): EcInstanz;
}

type Zeile = Array<number | string | null>;

interface Layer {
  spec: LayerSpec;
  daten: Zeile[];
  marker: Marker[];
  rev: number;
  sichtbar: boolean;
  vorlaeufig: boolean;
  vereinfacht: string | null;
}

const zahl = (v: Fix | null | undefined): number | null => (v == null ? null : Number(fixAlsText(v, 8)));
const zuFix = (v: unknown): Fix | null => (typeof v === 'number' && Number.isFinite(v) ? fix(String(v)) : null);

export class EChartsTreiber implements Treiber {
  readonly name = 'echarts';
  readonly kann: ReadonlySet<LayerArt> = new Set<LayerArt>(['candles', 'line', 'area', 'histogram', 'markers']);

  readonly #chart: EcInstanz;
  readonly #layer = new Map<string, Layer>();
  readonly #panes: string[] = ['price'];
  #dunkel: boolean;

  constructor(container: unknown, lib: EcBibliothek, optionen: { dunkel?: boolean } = {}) {
    this.#dunkel = optionen.dunkel ?? false;
    this.#chart = lib.init(container, this.#dunkel ? 'dark' : null, { renderer: 'canvas' });
  }

  lege(spec: LayerSpec): void {
    if (this.#layer.has(spec.id)) return;
    if (!this.kann.has(spec.art)) {
      throw new ChartFehler('VP-CHART-0031', `${this.name} kann ${spec.art} nicht (Layer ${spec.id})`);
    }
    if (!this.#panes.includes(spec.pane)) this.#panes.push(spec.pane);
    this.#layer.set(spec.id, {
      spec, daten: [], marker: [], rev: -1, sichtbar: spec.sichtbar, vorlaeufig: false, vereinfacht: null,
    });
    this.#zeichne();
  }

  #zeile(l: Layer, p: Punkt): Zeile {
    if (l.spec.art === 'candles') {
      // [t, open, close, low, high] — die Reihenfolge von ECharts, nicht unsere.
      return [p.t, zahl(p.werte['o']), zahl(p.werte['c']), zahl(p.werte['l']), zahl(p.werte['h'])];
    }
    return [p.t, zahl(p.werte['wert'])];
  }

  #punkt(l: Layer, z: readonly unknown[]): Punkt {
    const t = Number(z[0]);
    if (l.spec.art === 'candles') {
      return { t, werte: { o: zuFix(z[1]), h: zuFix(z[4]), l: zuFix(z[3]), c: zuFix(z[2]) } };
    }
    return { t, werte: { wert: zuFix(z[1]) } };
  }

  wende(ops: readonly ChartOp[]): void {
    for (const op of ops) {
      const l = this.#layer.get(op.layer);
      if (!l) throw new Error(`Layer ${op.layer} nicht angelegt`);
      pruefeRev(op.layer, l.rev, op);
      l.rev = op.rev;

      switch (op.op) {
        case 'snapshot':
          l.daten = op.punkte.map((p) => this.#zeile(l, p));
          l.vorlaeufig = false;
          break;
        case 'append':
          l.daten.push(...op.punkte.map((p) => this.#zeile(l, p)));
          l.vorlaeufig = false;
          break;
        case 'updateLast': {
          const z = this.#zeile(l, op.punkt);
          const letzte = l.daten.at(-1);
          if (letzte && letzte[0] === op.punkt.t) l.daten[l.daten.length - 1] = z;
          else l.daten.push(z);
          l.vorlaeufig = op.vorlaeufig;
          if (op.vorlaeufig) l.vereinfacht = 'vorlaeufige Bar wird nicht gesondert gezeichnet';
          break;
        }
        case 'replaceRange':
          l.daten = [
            ...l.daten.filter((z) => Number(z[0]) < op.von),
            ...op.punkte.map((p) => this.#zeile(l, p)),
            ...l.daten.filter((z) => Number(z[0]) > op.bis),
          ].sort((a, b) => Number(a[0]) - Number(b[0]));
          break;
        case 'removeRange':
          l.daten = l.daten.filter((z) => Number(z[0]) < op.von || Number(z[0]) > op.bis);
          break;
        case 'setMarkers': {
          l.marker = [...op.marker].sort((a, b) => a.t - b.t);
          const ohnePreis = l.marker.filter((m) => m.preis === undefined).length;
          l.vereinfacht = ohnePreis > 0 ? `${ohnePreis} Marker ohne Preis nicht gezeichnet` : null;
          break;
        }
        case 'setVisible':
          l.sichtbar = op.sichtbar;
          break;
        case 'reset':
          l.daten = [];
          l.marker = [];
          l.vorlaeufig = false;
          break;
      }
    }
    this.#zeichne();
  }

  /**
   * Die vollstaendige Option — neu gebaut statt gemergt.
   *
   * `notMerge: true` ist Absicht: ein Merge laesst Reihen stehen, die es nicht
   * mehr gibt, und ein `reset` wuerde nichts zuruecksetzen.
   */
  #zeichne(): void {
    const n = this.#panes.length;
    const oben = 6;
    const verfuegbar = 80;
    // Die Luecke traegt den Fensternamen. Bei 4 % stiess er an die unterste
    // Beschriftung der Preisachse darueber — gesehen erst in der Sichtprobe.
    const luecke = 7;
    const preisHoehe = n === 1 ? verfuegbar : 48;
    const subHoehe = n === 1 ? 0 : (verfuegbar - preisHoehe - luecke * (n - 1)) / (n - 1);

    const text = this.#dunkel ? '#d1d4dc' : '#333';
    const gitter = this.#dunkel ? '#2a2e39' : '#eceff1';

    const grids = this.#panes.map((_, i) => ({
      left: 64,
      right: 24,
      top: `${i === 0 ? oben : oben + preisHoehe + luecke + (i - 1) * (subHoehe + luecke)}%`,
      height: `${i === 0 ? preisHoehe : subHoehe}%`,
    }));
    const achsenIndex = this.#panes.map((_, i) => i);

    const series: Array<Record<string, unknown>> = [];
    // Unsichtbar heisst AUSGEBLENDET, nicht geloescht: die Reihe bleibt in der
    // Option und behaelt ihre Daten, die Legende blendet sie aus. Sonst waere
    // `setVisible(false)` → `setVisible(true)` ein Datenverlust.
    const ausgewaehlt: Record<string, boolean> = {};
    for (const l of this.#layer.values()) {
      ausgewaehlt[l.spec.titel] = l.sichtbar;
      const i = this.#panes.indexOf(l.spec.pane);
      const f = farbe(l.spec.stil);
      const basis = { id: l.spec.id, name: l.spec.titel, xAxisIndex: i, yAxisIndex: i, animation: false };

      switch (l.spec.art) {
        case 'candles':
          series.push({
            ...basis, type: 'candlestick', data: l.daten, encode: { x: 0, y: [1, 2, 3, 4] },
            itemStyle: { color: FARBE_KAUF, color0: FARBE_VERKAUF, borderColor: FARBE_KAUF, borderColor0: FARBE_VERKAUF },
          });
          break;
        case 'line':
        case 'area':
          series.push({
            ...basis, type: 'line', data: l.daten, showSymbol: false, connectNulls: false,
            lineStyle: { color: f, width: l.spec.art === 'line' ? 2 : 1.5 }, itemStyle: { color: f },
            ...(l.spec.art === 'area' ? { areaStyle: { color: f, opacity: 0.15 } } : {}),
          });
          break;
        case 'histogram':
          series.push({ ...basis, type: 'bar', data: l.daten, itemStyle: { color: f } });
          break;
        case 'markers':
          series.push({
            ...basis, type: 'scatter', symbolSize: 11, z: 10,
            data: l.marker
              .filter((m) => m.preis !== undefined)
              .map((m) => ({
                value: [m.t, zahl(m.preis)],
                name: m.text,
                symbol: 'triangle',
                symbolRotate: m.art === 'verkauf' ? 180 : 0,
                itemStyle: { color: m.art === 'kauf' ? FARBE_KAUF : m.art === 'verkauf' ? FARBE_VERKAUF : '#9e9e9e' },
              })),
          });
          break;
      }
    }

    this.#chart.setOption(
      {
        backgroundColor: 'transparent',
        textStyle: { color: text },
        animation: false,
        legend: { top: 0, textStyle: { color: text }, type: 'scroll', selected: ausgewaehlt },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        grid: grids,
        xAxis: this.#panes.map((_, i) => ({
          type: 'time', gridIndex: i, scale: true,
          axisLabel: { show: i === n - 1, color: text },
          splitLine: { lineStyle: { color: gitter } },
        })),
        yAxis: this.#panes.map((p, i) => ({
          type: 'value', gridIndex: i, scale: true, name: p === 'price' ? '' : p.replace(/^sub:/, ''),
          nameLocation: 'end', nameGap: 8,
          nameTextStyle: { color: text, align: 'left', fontWeight: 600 }, axisLabel: { color: text },
          splitLine: { lineStyle: { color: gitter } },
        })),
        dataZoom: [
          { type: 'inside', xAxisIndex: achsenIndex },
          { type: 'slider', xAxisIndex: achsenIndex, bottom: 8, height: 22 },
        ],
        series,
      },
      { notMerge: true, lazyUpdate: false },
    );
  }

  rueckschau(layer: string): Rueckschau {
    const l = this.#layer.get(layer);
    if (!l) throw new Error(`Layer ${layer} nicht angelegt`);
    const serie = (this.#chart.getOption().series ?? []).find((s) => s['id'] === layer);

    let punkte: Punkt[] = [];
    let marker: Marker[] = [];
    if (serie && l.spec.art === 'markers') {
      marker = ((serie['data'] as Array<Record<string, unknown>>) ?? []).map((d) => {
        const [t, preis] = d['value'] as [number, number];
        const rot = d['symbolRotate'];
        return {
          t: Number(t),
          art: rot === 180 ? 'verkauf' : 'kauf',
          text: String(d['name'] ?? ''),
          ...(zuFix(preis) !== null ? { preis: zuFix(preis)! } : {}),
        } satisfies Marker;
      });
    } else if (serie) {
      punkte = ((serie['data'] as unknown[][]) ?? []).map((z) => this.#punkt(l, z)).filter(hatWert);
    }
    return { punkte, marker, sichtbar: l.sichtbar, rev: l.rev, vorlaeufigAmEnde: l.vorlaeufig, vereinfacht: l.vereinfacht };
  }

  /** ECharts misst sein Gefaess nicht selbst nach — Lightweight mit `autoSize` schon. */
  groesseAnpassen(): void {
    this.#chart.resize?.();
  }

  zerstoere(): void {
    this.#chart.dispose();
    this.#layer.clear();
  }
}
