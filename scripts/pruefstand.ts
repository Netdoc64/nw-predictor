import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fix, scope, scopeKey, type Bar, type InstrumentMeta } from '@vp/core-ids';
import { kunstReihe, ladeNdjson, normalisiere } from '@vp/feeds';
import { ladeKatalog, type Katalog } from '@vp/registry';
import type { Szenario } from '@vp/sim';

// ─────────────────────────────────────────────────────────────────────────────
// Der Pruefstand des ersten Laufs — PLAN.md §16.
//
// EINE Stelle fuer Erstlauf, Chart und MCP. Vorher stand er in zwei Skripten
// wortgleich, und ein Pruefstand, der an zwei Stellen gepflegt wird, ist bald
// an zwei Stellen verschieden — dann vergleicht `vergleiche()` zwar gleiche
// Hashes, aber der Mensch vergleicht Chart und Bericht aus zwei Welten.
// ─────────────────────────────────────────────────────────────────────────────

export const WURZEL = fileURLToPath(new URL('..', import.meta.url));

export const BTCUSDT: InstrumentMeta = {
  instrumentId: 'binance:BTCUSDT',
  venue: 'binance',
  symbol: 'BTCUSDT',
  tickSize: fix('0.01'),
  stepSize: fix('0.00001'),
  minNotional: fix('10'),
  notierung: 'USDT',
};

export const SCOPE = scopeKey(scope({ venue: 'binance', symbol: 'BTCUSDT', timeframe: '1h', profil: 'default' }));

export interface ErstlaufPruefstand {
  readonly katalog: Katalog;
  readonly scopeKey: string;
  readonly meta: InstrumentMeta;
  readonly bars: readonly Bar[];
  readonly quelle: string;
  readonly echt: boolean;
  readonly befunde: number;
  readonly luecken: number;
  szenario(strategie: string): Szenario;
}

export function ladePruefstand(): ErstlaufPruefstand {
  const datenPfad = join(WURZEL, 'daten', 'binance-BTCUSDT-1h.ndjson');
  const echt = existsSync(datenPfad);
  const roh = echt
    ? ladeNdjson(datenPfad)
    : kunstReihe({ von: Date.UTC(2019, 0, 1), anzahl: 4000, timeframe: '1h', start: 3800, saat: 7 });

  const { bars, befunde, luecken } = normalisiere(roh, { timeframe: '1h', jetzt: Date.now() });
  if (bars.length === 0) throw new Error(`Keine Bars im Pruefstand (${echt ? datenPfad : 'Kunstreihe'})`);

  const erste = bars[0]!;
  const letzte = bars[bars.length - 1]!;
  const datenRevision = echt ? 'binance-rest-1' : 'kunst-1';

  return {
    katalog: ladeKatalog(join(WURZEL, 'registry')),
    scopeKey: SCOPE,
    meta: BTCUSDT,
    bars,
    echt,
    quelle: echt ? `Binance BTCUSDT 1h, ${bars.length} Bars` : 'Kunstreihe (Saat 7) — beschreibt die Maschine, nicht den Markt',
    befunde: befunde.length,
    luecken: luecken.length,
    szenario: (strategie) => ({
      id: `erstlauf-${strategie}`,
      scopes: [SCOPE],
      // Der Warmup liegt VOR dem Bewertungszeitraum (§12/L132): eine Woche.
      zeitraum: { von: erste.t + 7 * 24 * 3_600_000, bis: letzte.t },
      warmupVor: erste.t,
      konto: { startkapital: fix('10000'), waehrung: 'USDT', fx: { art: 'keine' } },
      kosten: { id: 'binance-spot-taker', gebuehrBp: 10, spreadBp: 1, slippageBp: 1 },
      markt: { id: 'schlicht', fill: 'naechste-oeffnung' },
      seed: 1,
      datenRevision,
      strategie,
      trace: 'entscheidungen',
    }),
  };
}
