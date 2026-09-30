import { fileURLToPath } from 'node:url';
import { fix, scopeKey, scope, type Bar, type InstrumentMeta } from '@vp/core-ids';
import { ladeKatalog, type Katalog } from '@vp/registry';
import { kunstReihe, normalisiere } from '@vp/feeds';
import type { KostenModell } from '@vp/trading';
import type { Szenario } from '@vp/sim';

/** BTCUSDT auf Binance Spot — die Werte stammen aus `exchangeInfo`, nicht aus dem Gefuehl. */
export const BTCUSDT: InstrumentMeta = {
  instrumentId: 'binance:BTCUSDT',
  venue: 'binance',
  symbol: 'BTCUSDT',
  tickSize: fix('0.01'),
  stepSize: fix('0.00001'),
  minNotional: fix('10'),
  notierung: 'USDT',
};

export const KOSTEN: KostenModell = {
  id: 'binance-spot-taker',
  gebuehrBp: 10,
  spreadBp: 1,
  slippageBp: 1,
};

export const SCOPE = scopeKey(
  scope({ venue: 'binance', symbol: 'BTCUSDT', timeframe: '1h', profil: 'default' }),
);

export function katalog(): Katalog {
  return ladeKatalog(fileURLToPath(new URL('../registry', import.meta.url)));
}

/** Eine reproduzierbare Reihe — dieselbe Saat, dieselben Bars, auf jeder Maschine. */
export function bars(anzahl = 600, saat = 7): Bar[] {
  const von = Date.UTC(2019, 0, 1);
  const roh = kunstReihe({ von, anzahl, timeframe: '1h', start: 3800, saat });
  const { bars: b } = normalisiere(roh, { timeframe: '1h', jetzt: Number.MAX_SAFE_INTEGER });
  return [...b];
}

export function szenario(strategie: string, ueberschreibe: Partial<Szenario> = {}): Szenario {
  const von = Date.UTC(2019, 0, 8);
  return {
    id: `erstlauf-${strategie}`,
    scopes: [SCOPE],
    zeitraum: { von, bis: Date.UTC(2019, 1, 1) },
    warmupVor: Date.UTC(2019, 0, 1),
    konto: { startkapital: fix('10000'), waehrung: 'USDT', fx: { art: 'keine' } },
    kosten: KOSTEN,
    markt: { id: 'schlicht', fill: 'naechste-oeffnung' },
    seed: 1,
    datenRevision: 'kunst-1',
    strategie,
    trace: 'entscheidungen',
    ...ueberschreibe,
  };
}
