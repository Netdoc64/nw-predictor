import { beforeEach, describe, expect, it } from 'vitest';
import { fix } from '@vp/core-ids';
import { fuehreAus, laufZaehlerZuruecksetzen, vergleiche, SzenarioFehler } from '@vp/sim';
import { werk, type Umgebung } from '@vp/compute';
import { URNS as HANDEL } from '@vp/trading';
import { bars, BTCUSDT, katalog, KOSTEN, SCOPE, szenario } from './hilfe.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Die Abnahme des ersten Laufs — PLAN.md §16.5.
//
// Erst wenn diese fuenf Punkte stehen, ist eine Zahl aus diesem System etwas
// wert. Alles andere ist Deko.
// ─────────────────────────────────────────────────────────────────────────────

const K = katalog();
const BARS = bars(600);

function lauf(strategie: string, opt: { einzeln?: boolean } = {}) {
  return fuehreAus({
    katalog: K,
    szenario: szenario(strategie),
    scopeKey: SCOPE,
    meta: BTCUSDT,
    bars: BARS,
    ...opt,
  });
}

beforeEach(() => {
  laufZaehlerZuruecksetzen();
});

describe('1 · null-v1 liefert exakt null', () => {
  it('kein Trade, keine Gebuehr, kein Cent Bewegung', () => {
    const l = lauf('null-v1');
    expect(l.bericht.trades).toBe(0);
    expect(l.bericht.gebuehren).toBe(0n);
    expect(l.bericht.realisiert).toBe(0n);
    expect(l.bericht.unrealisiert).toBe(0n);
    // „ungefaehr null" gibt es nicht.
    expect(l.bericht.endkapital).toBe(fix('10000'));
    expect(l.bericht.endkapital - l.bericht.startkapital).toBe(0n);
  });
});

describe('2 · Die Geld-Invariante haelt', () => {
  it('nach jedem Fill, nicht nur am Ende', () => {
    for (const s of ['null-v1', 'buyhold-v1', 'ema-cross-v1', 'ema-cross-v2']) {
      const l = lauf(s);
      // `pruefeInvariante` wirft nach jedem Fill; kommt der Lauf durch, hielt sie.
      expect(() => l.konto.pruefeInvariante()).not.toThrow();
      const st = l.konto.stand();
      expect(st.eigenkapital).toBe(l.konto.startkapital + st.realisiert + st.unrealisiert);
    }
  });

  it('Barmittel werden nie negativ', () => {
    const l = lauf('buyhold-v1');
    expect(l.konto.barmittel >= 0n).toBe(true);
  });
});

describe('3 · Belege sind nachrechenbar', () => {
  it('jeder Beleg traegt planHash, Datenstand und seine Rechenkette', () => {
    const l = lauf('ema-cross-v1');
    expect(l.belege.length).toBeGreaterThan(0);
    for (const b of l.belege) {
      expect(b.planHash).toBe(l.plan.planHash);
      expect(b.datenstand).toBe('kunst-1');
      expect(b.szenarioHash).toBe(l.bericht.szenarioHash);
      expect(b.grund.length).toBeGreaterThan(0);
      // Die Kette reicht rueckwaerts bis zur Rohbar.
      expect(b.kette.some((g) => g.knoten === 'reihe')).toBe(true);
    }
  });

  it('der Fill liegt auf der OEFFNUNG der Bar nach der Entscheidung', () => {
    const l = lauf('buyhold-v1');
    const b = l.belege[0]!;
    const barDesFills = BARS.find((x) => x.t === b.t)!;
    // Kaufpreis = Oeffnung plus Spread und Slippage, auf tickSize aufgerundet.
    expect(b.fill!.preis >= barDesFills.o).toBe(true);
    // Und die Entscheidung fiel FRUEHER als der Fill.
    expect(b.t).toBeGreaterThan(BARS[0]!.t);
  });

  it('ein schliessender Beleg verweist auf seine Eroeffnung', () => {
    const l = lauf('ema-cross-v1');
    const zu = l.belege.find((b) => b.richtung === 'flach');
    if (zu) {
      const auf = l.belege.find((b) => b.abschlussVon === zu.belegId);
      expect(auf, 'jeder Abschluss hat eine Eroeffnung').toBeDefined();
    }
  });
});

describe('4 · Replay ≡ Live', () => {
  it('am Stueck und Bar fuer Bar ergeben dasselbe — sonst gibt es Look-ahead-Bias', () => {
    for (const s of ['buyhold-v1', 'ema-cross-v1', 'ema-cross-v2']) {
      const amStueck = lauf(s);
      const einzeln = lauf(s, { einzeln: true });
      expect(einzeln.bericht.endkapital, s).toBe(amStueck.bericht.endkapital);
      expect(einzeln.bericht.trades, s).toBe(amStueck.bericht.trades);
      expect(einzeln.bericht.gebuehren, s).toBe(amStueck.bericht.gebuehren);
      expect(
        einzeln.belege.map((b) => `${b.t}:${b.richtung}:${b.fill?.preis}`),
        s,
      ).toEqual(amStueck.belege.map((b) => `${b.t}:${b.richtung}:${b.fill?.preis}`));
    }
  });

  it('zweimal derselbe Lauf ergibt denselben planHash und dasselbe Ergebnis', () => {
    const a = lauf('ema-cross-v1');
    const b = lauf('ema-cross-v1');
    expect(b.bericht.planHash).toBe(a.bericht.planHash);
    expect(b.bericht.endkapital).toBe(a.bericht.endkapital);
  });
});

describe('5 · Die Zuordnung findet den ATR-Parameter', () => {
  it('nennt den Knoten, an dem die beiden Strategien auseinandergehen', () => {
    const a = { lauf: lauf('ema-cross-v1'), strategie: K.strategien.get('ema-cross-v1')! };
    const b = { lauf: lauf('ema-cross-v2'), strategie: K.strategien.get('ema-cross-v2')! };
    const v = vergleiche(a, b);

    // Ebene 1: genau ein inhaltlicher Unterschied — das Profil. (Plus `id`,
    // `eltern` und `notiz`, die zur Identitaet gehoeren, nicht zur Rechnung.)
    expect(v.struktur.map((s) => s.pfad)).toContain('profil');

    // Ebene 2: ein Ergebnisunterschied OHNE Verhaltensunterschied waere ein
    // Widerspruch — genau daran ist die erste Fassung des Vergleichs
    // aufgefallen. Deshalb hier keine Nachsicht.
    if (v.ergebnis.differenz !== 0n) {
      expect(v.ersteAbweichung, 'andere Zahl, aber angeblich gleiches Verhalten').not.toBeNull();
    }

    // Ebene 4: die Ursache muss der ATR sein — und nichts anderes.
    expect(v.zuordnung, 'Ursache muss im Rechenband stehen').not.toBeNull();
    expect(v.zuordnung!.knoten).toBe('atr');
  });

  it('verweigert den Vergleich, wenn der Pruefstand abweicht', () => {
    const a = { lauf: lauf('ema-cross-v1'), strategie: K.strategien.get('ema-cross-v1')! };
    const anderePruefung = fuehreAus({
      katalog: K,
      szenario: szenario('ema-cross-v2', { kosten: { ...KOSTEN, gebuehrBp: 25 } }),
      scopeKey: SCOPE,
      meta: BTCUSDT,
      bars: BARS,
    });
    expect(() =>
      vergleiche(a, { lauf: anderePruefung, strategie: K.strategien.get('ema-cross-v2')! }),
    ).toThrow(SzenarioFehler);
  });

  it('zaehlt die Laeufe je Pruefstand — Mehrfachvergleich bleibt sichtbar', () => {
    const erste = lauf('ema-cross-v1');
    const zweite = lauf('ema-cross-v1');
    expect(erste.bericht.laufNr).toBe(1);
    expect(zweite.bericht.laufNr).toBe(2);
  });
});

describe('Kosten wirken', () => {
  it('ohne Gebuehren bleibt mehr uebrig als mit — sonst rechnet das Kostenmodell nicht mit', () => {
    const mit = lauf('buyhold-v1');
    const ohne = fuehreAus({
      katalog: K,
      szenario: szenario('buyhold-v1', { kosten: { ...KOSTEN, gebuehrBp: 0, spreadBp: 0, slippageBp: 0 } }),
      scopeKey: SCOPE,
      meta: BTCUSDT,
      bars: BARS,
    });
    expect(ohne.bericht.endkapital > mit.bericht.endkapital).toBe(true);
    expect(mit.bericht.gebuehren > 0n).toBe(true);
  });
});

describe('Warmup', () => {
  it('zu wenige Bars heissen DEGRADED mit Begruendung, nicht stillschweigend LIVE', () => {
    const l = fuehreAus({
      katalog: K,
      szenario: szenario('ema-cross-v1'),
      scopeKey: SCOPE,
      meta: BTCUSDT,
      bars: bars(30),
    });
    expect(l.maschine.zustand).toBe('DEGRADED');
    expect(l.bericht.hinweise.join(' ')).toMatch(/Warmup nicht gedeckt/);
  });

  it('erst nach dem Warmup sind Signale gueltig', () => {
    const l = lauf('ema-cross-v1');
    expect(l.bericht.barsGueltig).toBeLessThan(l.bericht.barsGesehen);
    expect(l.bericht.barsGueltig).toBeGreaterThan(0);
  });
});

describe('Parameter kommen aus der Definition — nicht aus einem Rueckfall im Code', () => {
  // Die Vorgaben stehen in registry/definitionen.json und werden beim Aufloesen
  // materialisiert (§12/C29). Ein `?? 100` im Knoten waere eine zweite Wahrheit:
  // aendert jemand die Definition und verliert dabei den Parameter, rechnet der
  // Knoten still mit der alten Zahl weiter, und der Beleg nennt sie nicht.
  const UMGEBUNG = { meta: undefined as never, dienste: new Map() } satisfies Umgebung;

  it('ema-cross ohne risikoBp startet nicht', () => {
    expect(() => werk(HANDEL.EMA_CROSS)({ atrFaktor: 2, maxAnteilBp: 10_000 }, UMGEBUNG)).toThrow(/risikoBp/);
  });

  it('ema-cross mit atrFaktor als Text startet nicht', () => {
    expect(() =>
      werk(HANDEL.EMA_CROSS)({ risikoBp: 100, atrFaktor: '2', maxAnteilBp: 10_000 }, UMGEBUNG),
    ).toThrow(/atrFaktor/);
  });

  it('buyhold ohne anteilBp startet nicht', () => {
    expect(() => werk(HANDEL.BUYHOLD)({}, UMGEBUNG)).toThrow(/anteilBp/);
  });

  it('mit den Parametern der Definition startet jeder Entscheidungsknoten', () => {
    const k = katalog();
    for (const urn of [HANDEL.NULL, HANDEL.BUYHOLD, HANDEL.EMA_CROSS]) {
      const def = k.definitionen.get(urn)!;
      expect(() => werk(urn)(def.params, UMGEBUNG), urn).not.toThrow();
    }
  });
});
