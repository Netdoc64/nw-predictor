import { abs, durch, fix, mal, max, type Bar, type Fix } from '@vp/core-ids';
import { alsBar, melde, zahlParam, type KnotenLaufzeit, type SchrittKontext } from './laufzeit.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Indikatoren — alles in Festkomma, alles als Stromknoten.
//
// Die Anlaufregeln sind aufgeschrieben und nicht geraten: jeder Indikator sagt,
// ab wann sein Wert etwas bedeutet, und liefert vorher `null`. Ein Indikator,
// der waehrend des Anlaufs schon Zahlen liefert, erzeugt Entscheidungen auf
// halben Werten — und die sieht man im Ergebnis nicht mehr.
// ─────────────────────────────────────────────────────────────────────────────

const OHLCV = 'vp://series/core/ohlcv@1.0.0';
const SMA = 'vp://indicator/core/sma@1.0.0';
const EMA = 'vp://indicator/core/ema@1.0.0';
const ATR = 'vp://indicator/core/atr@1.0.0';

export const URNS = { OHLCV, SMA, EMA, ATR } as const;

function quelle(bar: Bar, name: unknown): Fix {
  switch (name) {
    case 'open':
      return bar.o;
    case 'high':
      return bar.h;
    case 'low':
      return bar.l;
    case 'close':
    case undefined:
      return bar.c;
    default:
      throw new Error(`unbekannte Quelle: ${String(name)}`);
  }
}

// ── Die Reihe selbst ─────────────────────────────────────────────────────────

melde(OHLCV, () => ({
  schritt: (ctx: SchrittKontext) => ctx.bar,
}));

// ── SMA ──────────────────────────────────────────────────────────────────────

melde(SMA, (params) => {
  const n = zahlParam(params, 'periode');
  const fenster: Fix[] = [];
  let summe = 0n;

  return {
    schritt(ctx) {
      const p = quelle(alsBar(ctx.eingang('reihe')), params['quelle']);
      fenster.push(p);
      summe += p;
      if (fenster.length > n) summe -= fenster.shift()!;
      if (fenster.length < n) return null;
      // Abrunden, ausdruecklich: eine Division ohne genannte Rundungsregel ist
      // eine Entscheidung, die jemand spaeter anders trifft.
      return durch(summe, fix(n), 'ab');
    },
  } satisfies KnotenLaufzeit;
});

// ── EMA ──────────────────────────────────────────────────────────────────────

melde(EMA, (params) => {
  const n = zahlParam(params, 'periode');
  // alpha = 2 / (n + 1)
  const alpha = durch(fix(2), fix(n + 1), 'ab');
  let wert: Fix | null = null;
  let gesehen = 0;

  return {
    schritt(ctx) {
      const p = quelle(alsBar(ctx.eingang('reihe')), params['quelle']);
      gesehen += 1;
      wert = wert === null ? p : wert + mal(alpha, p - wert, 'ab');
      // Erst nach `periode` Bars ist der Wert nicht mehr ueberwiegend vom
      // Startwert bestimmt. Die Definition rechnet mit faktor 5 fuer den
      // Warmup — das hier ist nur die Untergrenze fuer „gibt ueberhaupt etwas".
      return gesehen < n ? null : wert;
    },
  } satisfies KnotenLaufzeit;
});

// ── ATR (Wilder) ─────────────────────────────────────────────────────────────

melde(ATR, (params) => {
  const n = zahlParam(params, 'periode');
  const nFix = fix(n);
  const nMinus1 = fix(n - 1);
  let vorherClose: Fix | null = null;
  let atr: Fix | null = null;
  let gesehen = 0;

  return {
    schritt(ctx) {
      const bar = alsBar(ctx.eingang('reihe'));
      const tr =
        vorherClose === null
          ? bar.h - bar.l
          : max(bar.h - bar.l, max(abs(bar.h - vorherClose), abs(bar.l - vorherClose)));
      vorherClose = bar.c;
      gesehen += 1;

      // Wilder-Glaettung: atr = (atr·(n−1) + tr) / n
      atr = atr === null ? tr : durch(mal(atr, nMinus1, 'ab') + tr, nFix, 'ab');
      return gesehen < n ? null : atr;
    },
  } satisfies KnotenLaufzeit;
});
