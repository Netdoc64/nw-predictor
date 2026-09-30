import { describe, expect, it } from 'vitest';
import {
  aufSchritt, betrag, durch, fix, fixAlsText, kanon, KanonFehler, mal, nodeHash, scope, scopeKey,
} from '@vp/core-ids';
import { BUDGETS, CODES, Tracker, type ErrorCode } from '@vp/errors';

describe('kanon — gleiche Bedeutung, gleiche Zeichenkette', () => {
  it('sortiert Schluessel und ignoriert die Einfuegereihenfolge', () => {
    expect(kanon({ b: 1, a: 2 })).toBe(kanon({ a: 2, b: 1 }));
  });

  it('macht 1.0 und 1 ununterscheidbar, -0 und 0 ebenso', () => {
    expect(kanon({ x: 1.0 })).toBe(kanon({ x: 1 }));
    expect(kanon({ x: -0 })).toBe(kanon({ x: 0 }));
  });

  it('behandelt undefined wie „nicht gesetzt"', () => {
    expect(kanon({ a: 1, b: undefined })).toBe(kanon({ a: 1 }));
  });

  it('behaelt die Reihenfolge in Arrays — dort ist sie bedeutungstragend', () => {
    expect(kanon([1, 2])).not.toBe(kanon([2, 1]));
  });

  it('verweigert NaN und Unendlich statt sie stillschweigend zu verschlucken', () => {
    expect(() => kanon({ x: NaN })).toThrow(KanonFehler);
    expect(() => kanon({ x: Infinity })).toThrow(KanonFehler);
  });

  it('normalisiert Unicode — zwei Schreibweisen sind ein Parameter', () => {
    expect(kanon({ x: 'é' })).toBe(kanon({ x: 'é' }));
  });
});

describe('Festkomma — Geld ohne Fliesskomma', () => {
  it('0,1 + 0,2 ist genau 0,3', () => {
    expect(fixAlsText(fix('0.1') + fix('0.2'))).toBe('0.30000000');
  });

  it('liest Exponentialschreibweise verlustfrei', () => {
    expect(fix('1e-8')).toBe(1n);
    expect(fix('1.5e3')).toBe(fix('1500'));
  });

  it('schneidet an der Systemgrenze ab, statt zu runden', () => {
    // fix() nimmt 8 Stellen und laesst den Rest fallen — eine Rundung hier
    // waere eine stille Wertaenderung beim Einlesen von Marktdaten.
    expect(fix('0.333333335')).toBe(fix('0.33333333'));
  });

  it('rundet nur, wo eine Regel genannt ist', () => {
    expect(mal(fix('3'), fix('0.33333333'), 'ab')).toBe(fix('0.99999999'));
    expect(durch(fix('1'), fix('3'), 'auf')).toBe(fix('0.33333334'));
    expect(durch(fix('1'), fix('3'), 'ab')).toBe(fix('0.33333333'));
  });

  it('legt Mengen auf die Schrittweite', () => {
    expect(aufSchritt(fix('0.123456789'), fix('0.00001'), 'ab')).toBe(fix('0.12345'));
  });

  it('zeigt Betraege deutsch', () => {
    expect(betrag(fix('1234.5'))).toBe('1.234,50 €');
    expect(betrag(fix('-42'), 'USDT')).toBe('-42,00 USDT');
  });
});

describe('Adressen', () => {
  it('normalisiert Venue und Profil, laesst das Symbol in Ruhe', () => {
    const s = scope({ venue: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h', profil: 'Default' });
    expect(scopeKey(s)).toBe('binance:BTCUSDT:1h:default');
  });

  it('lehnt einen unbekannten Timeframe ab, statt ihn zu raten', () => {
    expect(() => scope({ venue: 'x', symbol: 'Y', timeframe: '60', profil: 'p' })).toThrow();
  });

  it('nodeHash aendert sich mit der Datenrevision — sonst luegt der Cache', () => {
    const a = { def: 'vp://indicator/core/ema@1.0.0', params: { periode: 20 }, eingaenge: [], datenRevision: 'r1' };
    expect(nodeHash(a)).not.toBe(nodeHash({ ...a, datenRevision: 'r2' }));
  });

  it('nodeHash aendert sich mit dem Artefakt — Gewichte sind kein Parameter', () => {
    const a = { def: 'vp://model/core/x@1.0.0', params: {}, eingaenge: [], datenRevision: 'r1' };
    expect(nodeHash(a)).not.toBe(nodeHash({ ...a, artefaktHash: 'abc' }));
  });
});

describe('Fehler-Tracker', () => {
  it('Code-Tabelle ohne Luecken: jeder Code traegt Schwere, Klasse und Wiederholbarkeit', () => {
    for (const [code, e] of Object.entries(CODES)) {
      expect(['info', 'warn', 'error', 'fatal'], code).toContain(e.schwere);
      expect(Object.keys(BUDGETS), code).toContain(e.klasse);
      expect(typeof e.wiederholbar, code).toBe('boolean');
      expect(e.text.length, code).toBeGreaterThan(3);
    }
  });

  it('dedupliziert, aber zaehlt exakt weiter', () => {
    const t = new Tracker({ monoton: () => 0, dedupeAb: 2, abtastung: 5 });
    for (let i = 0; i < 50; i += 1) t.melde({ code: 'VP-FEED-0011', nachricht: `Bar ${i} doppelt` });
    expect(t.zaehler('VP-FEED-0011')).toBe(50);
    expect(t.letzte(100).length).toBeLessThan(50);
  });

  it('haelt an, sobald das Budget reisst — das ist der Guard der Maschine', () => {
    let jetzt = 0;
    const t = new Tracker({ monoton: () => jetzt });
    for (let i = 0; i <= BUDGETS.calc.grenze; i += 1) {
      t.melde({ code: 'VP-CALC-0001', scope: 's', nachricht: `Knoten ${i}` });
    }
    expect(t.budgetErschoepft('calc', 's')).toBe(true);

    // Fenster laeuft weiter — und die monotone Uhr springt nicht zurueck.
    jetzt += BUDGETS.calc.fensterMs + 1;
    expect(t.budgetErschoepft('calc', 's')).toBe(false);
  });

  it('laesst kein Geheimnis in die Ablage', () => {
    const t = new Tracker({ monoton: () => 0 });
    const f = t.melde({
      code: 'VP-STORE-0001',
      daten: { apiKey: 'KANARIENVOGEL-123', bar: 7, unbekanntesFeld: 'auch weg' },
    });
    expect(JSON.stringify(f.daten)).not.toContain('KANARIENVOGEL');
    expect(f.daten['bar']).toBe(7);
    expect(f.daten['unbekanntesFeld']).toBe('[redigiert]');
  });

  it('eine werfende Senke reisst den Tracker nicht mit', () => {
    const t = new Tracker({ monoton: () => 0 });
    t.senke(() => {
      throw new Error('Senke kaputt');
    });
    expect(() => t.melde({ code: 'VP-CALC-0001' })).not.toThrow();
    expect((t.letzterSenkenFehler as Error).message).toBe('Senke kaputt');
  });
});

// Ein Code, der in keiner Budgetklasse liegt, wuerde hier schon beim Tippen
// auffallen — der Typ laesst ihn nicht zu.
const _typprobe: ErrorCode = 'VP-TRADE-0004';
void _typprobe;
