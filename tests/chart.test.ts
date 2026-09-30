import { describe, expect, it } from 'vitest';
import { fix, fixAlsText, scope } from '@vp/core-ids';
import {
  alsWire, ChartFehler, EChartsTreiber, LightweightTreiber, SpeicherTreiber, vonWire,
  type ChartOp, type EcBibliothek, type LayerSpec, type LwcBibliothek, type Rueckschau, type Treiber,
} from '@vp/chart-adapter';
import { ChartBindung } from '@vp/chart-bindung';
import { resolve } from '@vp/registry';
import { fuehreAus } from '@vp/sim';
import { bars, BTCUSDT, katalog, SCOPE, szenario } from './hilfe.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Konformitaet — PLAN.md §5.4.
//
// Dieselben Op-Folgen gegen ALLE Treiber. Verglichen wird, was die BIBLIOTHEK
// haelt (`series.data()`, `getOption()`), nicht eine Schattenkopie im Treiber.
// Die Attrappen unten verhalten sich an den Stellen wie die echten
// Bibliotheken, an denen ein Treiber falsch werden kann: Lightweight wirft bei
// rueckwaerts laufender Zeit und ersetzt bei gleicher Zeit; ECharts nimmt die
// Option, wie sie kommt.
// ─────────────────────────────────────────────────────────────────────────────

function lwcAttrappe(): LwcBibliothek {
  const serie = () => {
    let daten: Record<string, unknown>[] = [];
    return {
      setData: (d: unknown[]) => {
        daten = (d as Record<string, unknown>[]).map((x) => ({ ...x }));
      },
      update: (e: unknown) => {
        const x = e as Record<string, unknown>;
        const letzte = daten.at(-1);
        if (letzte && Number(x['time']) < Number(letzte['time'])) {
          throw new Error('Cannot update oldest data');
        }
        if (letzte && letzte['time'] === x['time']) daten[daten.length - 1] = { ...x };
        else daten.push({ ...x });
      },
      // Wie die ECHTE Bibliothek: `data()` liefert keinen Whitespace. Die erste
      // Fassung dieser Attrappe tat es — und bestand damit einen Test, den
      // Lightweight im Browser nicht bestand.
      data: () => daten.filter((e) => 'value' in e || 'close' in e),
      applyOptions: () => {},
    };
  };
  return {
    createChart: () => ({
      addSeries: () => serie(),
      timeScale: () => ({ fitContent: () => {} }),
      remove: () => {},
    }),
    createSeriesMarkers: () => {
      let m: Record<string, unknown>[] = [];
      return {
        setMarkers: (x: unknown[]) => {
          m = x as Record<string, unknown>[];
        },
        markers: () => m,
      };
    },
    CandlestickSeries: 'candle',
    LineSeries: 'line',
    AreaSeries: 'area',
    HistogramSeries: 'hist',
  };
}

function ecAttrappe(): EcBibliothek {
  return {
    init: () => {
      let option: Record<string, unknown> = {};
      return {
        setOption: (o) => {
          option = structuredClone(o);
        },
        getOption: () => option,
        dispose: () => {},
      };
    },
  };
}

const TREIBER: Array<[string, () => Treiber]> = [
  ['speicher', () => new SpeicherTreiber()],
  ['lightweight', () => new LightweightTreiber({}, lwcAttrappe())],
  ['echarts', () => new EChartsTreiber({}, ecAttrappe())],
];

function spec(id: string, art: LayerSpec['art'], pane: LayerSpec['pane'] = 'price'): LayerSpec {
  return {
    id, titel: id, art, pane,
    skala: { id: 'right', modus: 'normal', autoFit: true },
    quelle: { knoten: id, nodeHash: 'abc' },
    stil: 'palette:1', format: { praezision: 2 }, ordnung: 0, sichtbar: true, vereinfachbar: true,
  };
}

const STUNDE = 3_600_000;
const T0 = Date.UTC(2019, 0, 1);
const linie = (i: number, v: string | null) => ({ t: T0 + i * STUNDE, werte: { wert: v === null ? null : fix(v) } });
const kerze = (i: number, o: string, h: string, l: string, c: string) => ({
  t: T0 + i * STUNDE, werte: { o: fix(o), h: fix(h), l: fix(l), c: fix(c) },
});

/** Vergleichbare Form: Zeit exakt, Werte auf Layer-Praezision. */
function normal(r: Rueckschau): string[] {
  return r.punkte.map(
    (p) =>
      `${p.t}|${Object.entries(p.werte)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v === null ? '∅' : fixAlsText(v, 2)}`)
        .join(',')}`,
  );
}

function fuerAlle(name: string, lauf: (t: Treiber) => void, pruefe: (r: (id: string) => Rueckschau) => void): void {
  describe(name, () => {
    for (const [treiberName, baue] of TREIBER) {
      it(treiberName, () => {
        const t = baue();
        lauf(t);
        pruefe((id) => t.rueckschau(id));
      });
    }
  });
}

describe('Konformitaet — drei Treiber, ein Ergebnis', () => {
  fuerAlle(
    'snapshot, dann append ergibt eine lueckenlose Reihe',
    (t) => {
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(0, '10'), linie(1, '11')] }]);
      t.wende([{ op: 'append', layer: 'l', rev: 1, punkte: [linie(2, '12.5')] }]);
    },
    (r) => {
      expect(normal(r('l'))).toEqual([
        `${T0}|wert=10.00`,
        `${T0 + STUNDE}|wert=11.00`,
        `${T0 + 2 * STUNDE}|wert=12.50`,
      ]);
    },
  );

  fuerAlle(
    'Zeit kommt in MILLISEKUNDEN zurueck — egal was die Bibliothek intern nimmt',
    (t) => {
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(5, '1')] }]);
    },
    (r) => {
      // Lightweight rechnet in Sekunden. Ein Treiber ohne Umrechnung liefert
      // hier 1000-fach falsche Zeiten (PLAN.md §12/A1).
      expect(r('l').punkte[0]!.t).toBe(T0 + 5 * STUNDE);
    },
  );

  fuerAlle(
    'Kerzen behalten open/high/low/close — auch bei ECharts, das eine andere Reihenfolge will',
    (t) => {
      t.lege(spec('k', 'candles'));
      t.wende([{ op: 'snapshot', layer: 'k', rev: 0, punkte: [kerze(0, '100', '110', '95', '105')] }]);
    },
    (r) => {
      expect(normal(r('k'))).toEqual([`${T0}|c=105.00,h=110.00,l=95.00,o=100.00`]);
    },
  );

  fuerAlle(
    'Whitespace ist nicht beobachtbar — und wird nie zur 0',
    (t) => {
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(0, null), linie(1, null), linie(2, '7')] }]);
    },
    (r) => {
      expect(normal(r('l'))).toEqual([`${T0 + 2 * STUNDE}|wert=7.00`]);
    },
  );

  fuerAlle(
    'vorlaeufig, dann endgueltig ergibt EINEN Punkt, nicht zwei',
    (t) => {
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(0, '1')] }]);
      t.wende([{ op: 'updateLast', layer: 'l', rev: 1, punkt: linie(1, '2'), vorlaeufig: true }]);
      t.wende([{ op: 'updateLast', layer: 'l', rev: 2, punkt: linie(1, '3'), vorlaeufig: false }]);
    },
    (r) => {
      expect(normal(r('l'))).toEqual([`${T0}|wert=1.00`, `${T0 + STUNDE}|wert=3.00`]);
      expect(r('l').vorlaeufigAmEnde).toBe(false);
    },
  );

  fuerAlle(
    'replaceRange tauscht genau den Bereich',
    (t) => {
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [0, 1, 2, 3].map((i) => linie(i, String(i))) }]);
      t.wende([{
        op: 'replaceRange', layer: 'l', rev: 1, von: T0 + STUNDE, bis: T0 + 2 * STUNDE,
        punkte: [linie(1, '10'), linie(2, '20')],
      }]);
    },
    (r) => {
      expect(normal(r('l')).map((z) => z.split('=')[1])).toEqual(['0.00', '10.00', '20.00', '3.00']);
    },
  );

  fuerAlle(
    'reset hinterlaesst nichts',
    (t) => {
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(0, '1')] }]);
      t.wende([{ op: 'reset', layer: 'l', rev: 1, grund: 'plan-changed' }]);
    },
    (r) => {
      expect(r('l').punkte).toHaveLength(0);
    },
  );

  fuerAlle(
    'ausblenden verliert keine Daten',
    (t) => {
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(0, '1'), linie(1, '2')] }]);
      t.wende([{ op: 'setVisible', layer: 'l', rev: 1, sichtbar: false }]);
      t.wende([{ op: 'setVisible', layer: 'l', rev: 2, sichtbar: true }]);
    },
    (r) => {
      expect(r('l').punkte).toHaveLength(2);
      expect(r('l').sichtbar).toBe(true);
    },
  );

  fuerAlle(
    'Marker kommen sortiert und mit Richtung an',
    (t) => {
      t.lege(spec('k', 'candles'));
      t.lege(spec('m', 'markers'));
      t.wende([{ op: 'snapshot', layer: 'k', rev: 0, punkte: [kerze(0, '1', '2', '1', '2'), kerze(1, '2', '3', '2', '3')] }]);
      t.wende([{ op: 'snapshot', layer: 'm', rev: 0, punkte: [] }]);
      t.wende([{
        op: 'setMarkers', layer: 'm', rev: 1,
        marker: [
          { t: T0 + STUNDE, art: 'verkauf', text: 'Verkauf', preis: fix('3') },
          { t: T0, art: 'kauf', text: 'Kauf', preis: fix('1.5') },
        ],
      }]);
    },
    (r) => {
      expect(r('m').marker.map((m) => `${m.t}:${m.art}`)).toEqual([`${T0}:kauf`, `${T0 + STUNDE}:verkauf`]);
    },
  );
});

describe('Revisionen — ein Loch wird gemeldet, nicht gezeichnet', () => {
  for (const [name, baue] of TREIBER) {
    it(name, () => {
      const t = baue();
      t.lege(spec('l', 'line'));
      t.wende([{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(0, '1')] }]);
      expect(() => t.wende([{ op: 'append', layer: 'l', rev: 2, punkte: [linie(1, '2')] }])).toThrow(ChartFehler);
    });
  }
});

describe('Vereinfachen ist sichtbar', () => {
  it('ECharts ohne Markerpreis sagt, was fehlt', () => {
    const t = new EChartsTreiber({}, ecAttrappe());
    t.lege(spec('m', 'markers'));
    t.wende([{ op: 'snapshot', layer: 'm', rev: 0, punkte: [] }]);
    t.wende([{ op: 'setMarkers', layer: 'm', rev: 1, marker: [{ t: T0, art: 'kauf', text: 'x' }] }]);
    expect(t.rueckschau('m').vereinfacht).toMatch(/ohne Preis/);
  });

  it('Lightweight ohne Preisreihe laesst den Marker-Layer leer — und sagt es', () => {
    const t = new LightweightTreiber({}, lwcAttrappe());
    t.lege(spec('m', 'markers'));
    expect(t.rueckschau('m').vereinfacht).toMatch(/ohne Preisreihe/);
  });

  it('eine unbekannte Layer-Art wird abgelehnt, nicht ignoriert', () => {
    const t = new LightweightTreiber({}, lwcAttrappe());
    expect(() => t.lege(spec('h', 'heatmap'))).toThrow(ChartFehler);
  });
});

describe('Wire-Format', () => {
  it('bigint ueberlebt die Leitung — JSON.stringify allein wuerde werfen', () => {
    const ops: ChartOp[] = [{ op: 'snapshot', layer: 'l', rev: 0, punkte: [linie(0, '12345.67890123')] }];
    expect(() => JSON.stringify(ops)).toThrow();
    const zurueck = vonWire<ChartOp[]>(alsWire(ops));
    expect(zurueck).toEqual(ops);
  });
});

describe('Chart-Bindung — Registry-basierte Verknuepfung', () => {
  const K = katalog();
  const BARS = bars(600);
  const S = scope({ venue: 'binance', symbol: 'BTCUSDT', timeframe: '1h', profil: 'default' });

  it('leitet die Layer aus den Definitionen ab — ohne dass der Chart-Code einen Indikator kennt', () => {
    const plan = resolve(K, 'ema-cross-atr14', S, { datenRevision: 'kunst-1' });
    const b = new ChartBindung(plan, K);
    // Innerhalb gleicher Stufe gilt die Plan-Reihenfolge — deterministisch
    // topologisch nach Id, nicht nach der Zeile im Profil.
    expect(b.layer.map((l) => `${l.quelle.knoten}:${l.art}:${l.pane}`)).toEqual([
      'reihe:candles:price',
      'ema-langsam:line:price',
      'ema-schnell:line:price',
      'ausfuehrung:markers:price',
      'atr:line:sub:atr',
      'konto:area:sub:konto',
    ]);
    // Die Entscheidung hat keine Darstellung — sie erscheint ueber ihre Fills.
    expect(b.layer.some((l) => l.quelle.knoten === 'entscheidung')).toBe(false);
  });

  it('dieselbe EMA hat in zwei Plaenen dieselbe Farbe, ein anderer ATR eine eigene', () => {
    const a = new ChartBindung(resolve(K, 'ema-cross-atr14', S, { datenRevision: 'r' }), K);
    const b = new ChartBindung(resolve(K, 'ema-cross-atr10', S, { datenRevision: 'r' }), K);
    const stil = (x: ChartBindung, k: string) => x.layer.find((l) => l.quelle.knoten === k)!.stil;
    expect(stil(a, 'ema-schnell')).toBe(stil(b, 'ema-schnell'));
    expect(a.layer.find((l) => l.quelle.knoten === 'atr')!.id).not.toBe(b.layer.find((l) => l.quelle.knoten === 'atr')!.id);
  });

  it('ein Lauf ergibt je Fill genau einen Marker, und Warmup ist Whitespace', () => {
    let bindung: ChartBindung | null = null;
    const treiber = new SpeicherTreiber();
    const lauf = fuehreAus({
      katalog: K, szenario: szenario('ema-cross-v1'), scopeKey: SCOPE, meta: BTCUSDT, bars: BARS,
      beobachter: (bar, werte) => {
        if (!bindung) {
          bindung = new ChartBindung(resolve(K, 'ema-cross-atr14', S, { datenRevision: 'kunst-1' }), K);
          for (const l of bindung.layer) treiber.lege(l);
        }
        treiber.wende(bindung.schritt(bar, werte));
      },
    });
    const b = bindung as unknown as ChartBindung;
    const id = (k: string) => b.layer.find((l) => l.quelle.knoten === k)!.id;

    expect(treiber.rueckschau(id('reihe')).punkte).toHaveLength(BARS.length);
    expect(treiber.rueckschau(id('ausfuehrung')).marker).toHaveLength(lauf.konto.fills.length);

    // EMA(50) liefert die ersten 49 Bars keinen Wert: Whitespace, und der ist
    // nicht beobachtbar. Die erste zurueckgelesene Zeit ist also Bar 49.
    const langsam = treiber.rueckschau(id('ema-langsam')).punkte;
    expect(langsam).toHaveLength(BARS.length - 49);
    expect(langsam[0]!.t).toBe(BARS[49]!.t);

    // Die Kapitalkurve endet dort, wo der Bericht endet.
    expect(treiber.rueckschau(id('konto')).punkte.at(-1)!.werte['wert']).toBe(lauf.bericht.endkapital);
  });

  it('Schritt fuer Schritt und Snapshot ergeben denselben Chart', () => {
    let bindung: ChartBindung | null = null;
    const schrittweise = new SpeicherTreiber();
    fuehreAus({
      katalog: K, szenario: szenario('ema-cross-v1'), scopeKey: SCOPE, meta: BTCUSDT, bars: BARS,
      beobachter: (bar, werte) => {
        if (!bindung) {
          bindung = new ChartBindung(resolve(K, 'ema-cross-atr14', S, { datenRevision: 'kunst-1' }), K);
          for (const l of bindung.layer) schrittweise.lege(l);
        }
        schrittweise.wende(bindung.schritt(bar, werte));
      },
    });
    const b = bindung as unknown as ChartBindung;
    const neu = new SpeicherTreiber();
    for (const l of b.layer) neu.lege(l);
    neu.wende(b.snapshot());

    for (const l of b.layer) {
      expect(normal(neu.rueckschau(l.id)), l.titel).toEqual(normal(schrittweise.rueckschau(l.id)));
      expect(neu.rueckschau(l.id).marker, l.titel).toEqual(schrittweise.rueckschau(l.id).marker);
    }
  });
});
