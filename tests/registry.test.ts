import { describe, expect, it } from 'vitest';
import { scope } from '@vp/core-ids';
import { katalogAus, resolve, ResolveFehler, type Definition, type EingangsSchacht, type Profil } from '@vp/registry';
import { abdeckungReicht, normalisiere } from '@vp/feeds';
import { katalog, SCOPE } from './hilfe.ts';

const S = scope({ venue: 'binance', symbol: 'BTCUSDT', timeframe: '1h', profil: 'default' });
const OPT = { datenRevision: 'r1' };

function def(teil: Partial<Definition> & Pick<Definition, 'urn' | 'kind'>): Definition {
  return {
    titel: teil.urn,
    eingaenge: [],
    params: {},
    ausgabeSchema: 'vp://schema/x@1',
    lookback: { bars: 1 },
    reinheit: 'rein',
    kosten: { cpu: 'niedrig', io: false },
    ...teil,
  } as Definition;
}

describe('resolve — die Verbindung beider Achsen', () => {
  it('loest das Erstlauf-Profil auf und rechnet den Warmup', () => {
    const p = resolve(katalog(), 'ema-cross-atr14', S, OPT);
    // EMA(50) mit Faktor 5 = 250 Bars — aus dem PARAMETER der Instanz, nicht
    // aus dem Default der Definition. Dazu die Reihe und die Entscheidung.
    expect(p.warmupBars).toBeGreaterThanOrEqual(250);
    expect(p.knoten.find((k) => k.id === 'ema-langsam')!.warmup).toBe(251);
    expect(p.reihenfolge[0]).toBe('reihe');
    expect(p.reihenfolge.at(-1)).toBe('konto');
    expect(p.planHash).toHaveLength(64);
  });

  it('materialisiert die Defaults der Definition in die Instanz', () => {
    const p = resolve(katalog(), 'ema-cross-atr14', S, OPT);
    const atr = p.knoten.find((k) => k.id === 'atr')!;
    // `quelle` steht nicht im Profil — der Default der Definition ist trotzdem da.
    expect(atr.params['periode']).toBe(14);
  });

  it('zwei Profile, die sich in EINEM Parameter unterscheiden, haben andere planHashes', () => {
    const k = katalog();
    const a = resolve(k, 'ema-cross-atr14', S, OPT);
    const b = resolve(k, 'ema-cross-atr10', S, OPT);
    expect(a.planHash).not.toBe(b.planHash);
    // Der Unterschied sitzt am ATR — und pflanzt sich stromabwaerts fort, weil
    // der nodeHash die Eingangs-Hashes enthaelt. Genau das ist gewollt: ein
    // Cache-Eintrag unterhalb des ATR gehoert nicht zu beiden Strategien.
    const unterschiede = a.knoten
      .filter((x) => b.knoten.find((y) => y.id === x.id)?.nodeHash !== x.nodeHash)
      .map((x) => x.id)
      .sort();
    expect(unterschiede).toEqual(['atr', 'ausfuehrung', 'entscheidung', 'konto']);
    // Die EMAs bleiben unberuehrt — sie liegen NEBEN dem ATR, nicht dahinter.
    expect(unterschiede).not.toContain('ema-schnell');
  });

  it('dieselbe Eingabe ergibt denselben Plan — jedes Mal', () => {
    const k = katalog();
    expect(resolve(k, 'null', S, OPT).planHash).toBe(resolve(k, 'null', S, OPT).planHash);
  });

  it('lehnt einen unbelegten Pflicht-Eingang ab', () => {
    const k = katalogAus(
      [def({ urn: 'vp://indicator/core/x@1.0.0', kind: 'indicator', eingaenge: [{ name: 'reihe', nimmt: ['series'], schema: ['vp://schema/x@1'] }] })],
      [{ id: 'p', titel: 'p', knoten: [{ id: 'a', def: 'vp://indicator/core/x@1.0.0' }] } as Profil],
    );
    expect(() => resolve(k, 'p', S, OPT)).toThrow(/unbelegt/);
  });

  it('lehnt eine Kante ab, die gegen die Ordnungszahl laeuft', () => {
    const k = katalogAus(
      [
        def({ urn: 'vp://series/core/s@1.0.0', kind: 'series', eingaenge: [{ name: 'e', nimmt: ['indicator'], schema: ['vp://schema/x@1'] }] }),
        def({ urn: 'vp://indicator/core/i@1.0.0', kind: 'indicator' }),
      ],
      [
        {
          id: 'p',
          titel: 'p',
          knoten: [
            { id: 'i', def: 'vp://indicator/core/i@1.0.0' },
            { id: 's', def: 'vp://series/core/s@1.0.0', eingaenge: { e: 'i' } },
          ],
        } as Profil,
      ],
    );
    expect(() => resolve(k, 'p', S, OPT)).toThrow(ResolveFehler);
  });

  it('erkennt einen Zyklus gleicher Ordnung, statt endlos zu laufen', () => {
    const k = katalogAus(
      [def({ urn: 'vp://indicator/core/i@1.0.0', kind: 'indicator', eingaenge: [{ name: 'e', nimmt: ['indicator'], schema: ['vp://schema/x@1'], optional: true }] })],
      [
        {
          id: 'p',
          titel: 'p',
          knoten: [
            { id: 'a', def: 'vp://indicator/core/i@1.0.0', eingaenge: { e: 'b' } },
            { id: 'b', def: 'vp://indicator/core/i@1.0.0', eingaenge: { e: 'a' } },
          ],
        } as Profil,
      ],
    );
    expect(() => resolve(k, 'p', S, OPT)).toThrow(/Zyklus/);
  });

  // §12/C30: der Konsument DEKLARIERT, welches Schema er liest. Vorher stand
  // `ausgabeSchema` nur an der Quelle, und `resolve()` verglich allein die Art —
  // ein Indikator, der seine Ausgabe von `zahl@1` auf `zahl@2` hebt, waere still
  // in jede Entscheidung gelaufen, die noch `@1` liest.
  const quelle = (schema: string) =>
    def({ urn: 'vp://indicator/core/q@1.0.0', kind: 'indicator', ausgabeSchema: schema });
  const profilQK: Profil = {
    id: 'p',
    titel: 'p',
    knoten: [
      { id: 'q', def: 'vp://indicator/core/q@1.0.0' },
      { id: 'k', def: 'vp://decision/core/k@1.0.0', eingaenge: { e: 'q' } },
    ],
  };

  it('lehnt einen Eingang ab, dessen Schema der Konsument nicht deklariert (C30)', () => {
    const k = katalogAus(
      [
        quelle('vp://schema/zahl@2'),
        def({
          urn: 'vp://decision/core/k@1.0.0',
          kind: 'decision',
          eingaenge: [{ name: 'e', nimmt: ['indicator'], schema: ['vp://schema/zahl@1'] }],
        }),
      ],
      [profilQK],
    );
    expect(() => resolve(k, 'p', S, OPT)).toThrow(/k\.e liest vp:\/\/schema\/zahl@1, bekommt vp:\/\/schema\/zahl@2/);
    try {
      resolve(k, 'p', S, OPT);
    } catch (e) {
      expect((e as ResolveFehler).code).toBe('VP-REG-0003');
    }
  });

  it('lehnt einen Eingang ohne Schema-Deklaration ab — Annehmen ist kein Vertrag (C30)', () => {
    const k = katalogAus(
      [
        quelle('vp://schema/zahl@1'),
        def({
          urn: 'vp://decision/core/k@1.0.0',
          kind: 'decision',
          // So kommt es aus einer JSON-Datei, die den Typ nie gesehen hat.
          eingaenge: [{ name: 'e', nimmt: ['indicator'] } as unknown as EingangsSchacht],
        }),
      ],
      [profilQK],
    );
    expect(() => resolve(k, 'p', S, OPT)).toThrow(/deklariert kein Schema/);
  });

  it('nimmt einen Eingang an, dessen Schema deklariert ist (C30)', () => {
    const k = katalogAus(
      [
        quelle('vp://schema/zahl@1'),
        def({
          urn: 'vp://decision/core/k@1.0.0',
          kind: 'decision',
          eingaenge: [{ name: 'e', nimmt: ['indicator'], schema: ['vp://schema/zahl@1'] }],
        }),
      ],
      [profilQK],
    );
    expect(resolve(k, 'p', S, OPT).reihenfolge).toEqual(['q', 'k']);
  });

  it('jeder Eingang im echten Katalog deklariert ein Schema, das seine Quelle liefert (C30)', () => {
    const k = katalog();
    for (const id of k.profile.keys()) expect(() => resolve(k, id, S, OPT), id).not.toThrow();
    for (const d of k.definitionen.values()) {
      for (const e of d.eingaenge) expect(e.schema?.length, `${d.urn}.${e.name}`).toBeGreaterThan(0);
    }
  });
});

describe('Feed-Normalisierung', () => {
  const roh = (t: number, c: string) => ({ t, o: c, h: c, l: c, c, v: '1' });

  it('erkennt Duplikate und laesst den spaeteren Stand gelten', () => {
    const r = normalisiere([roh(0, '10'), roh(0, '11')], { timeframe: '1h' });
    expect(r.bars).toHaveLength(1);
    expect(r.befunde[0]?.code).toBe('VP-FEED-0011');
  });

  it('sortiert verspaetete Bars ein, statt sie anzuhaengen', () => {
    const d = 3_600_000;
    const r = normalisiere([roh(2 * d, '12'), roh(0, '10'), roh(d, '11')], { timeframe: '1h' });
    expect(r.bars.map((b) => b.t)).toEqual([0, d, 2 * d]);
  });

  it('meldet Luecken mit Groesse', () => {
    const d = 3_600_000;
    const r = normalisiere([roh(0, '10'), roh(3 * d, '13')], { timeframe: '1h' });
    expect(r.luecken).toEqual([{ von: d, bis: 2 * d, bars: 2 }]);
  });

  it('verwirft unplausible Bars, statt sie zurechtzubiegen', () => {
    const r = normalisiere([{ t: 0, o: '10', h: '9', l: '11', c: '10' }], { timeframe: '1h' });
    expect(r.bars).toHaveLength(0);
    expect(r.befunde[0]?.code).toBe('VP-FEED-0031');
  });

  it('weist Zeitstempel aus der Zukunft ab', () => {
    const r = normalisiere([roh(10_000_000, '10')], { timeframe: '1h', jetzt: 0 });
    expect(r.bars).toHaveLength(0);
    expect(r.befunde[0]?.code).toBe('VP-FEED-0012');
  });

  it('Abdeckung: zu wenige Bars sind kein LIVE', () => {
    expect(abdeckungReicht([], 10, []).ok).toBe(false);
    expect(abdeckungReicht(new Array(10).fill({}) as never, 10, [{ bars: 3 }]).ok).toBe(false);
    expect(abdeckungReicht(new Array(10).fill({}) as never, 10, []).ok).toBe(true);
  });
});

describe('Katalog von der Platte', () => {
  it('liest Definitionen, Profile und Strategien aus registry/', () => {
    const k = katalog();
    expect(k.definitionen.size).toBeGreaterThanOrEqual(9);
    expect([...k.profile.keys()].sort()).toEqual(['buyhold', 'ema-cross-atr10', 'ema-cross-atr14', 'null']);
    expect([...k.strategien.keys()].sort()).toEqual(['buyhold-v1', 'ema-cross-v1', 'ema-cross-v2', 'null-v1']);
  });

  it('der Scope aus der Hilfe ist normalisiert', () => {
    expect(SCOPE).toBe('binance:BTCUSDT:1h:default');
  });
});
