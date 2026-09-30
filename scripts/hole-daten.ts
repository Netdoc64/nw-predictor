import { fileURLToPath } from 'node:url';
import { holeBinanceKerzen, speichereNdjson } from '@vp/feeds';

// ─────────────────────────────────────────────────────────────────────────────
// Marktdaten holen — oeffentliche Binance-Kerzen, kein Schluessel.
//
//   node --experimental-strip-types scripts/hole-daten.ts [symbol] [von] [bis]
//
// Die Daten landen unter `daten/` und sind gitignoriert: gross,
// wiederbeschaffbar, und je nach Venue lizenzgebunden (PLAN.md §12/K119).
// ─────────────────────────────────────────────────────────────────────────────

const symbol = process.argv[2] ?? 'BTCUSDT';
const von = Date.parse(process.argv[3] ?? '2019-01-01T00:00:00Z');
const bis = Date.parse(process.argv[4] ?? '2019-07-01T00:00:00Z');

const ziel = fileURLToPath(new URL(`../daten/binance-${symbol}-1h.ndjson`, import.meta.url));

console.log(`Hole ${symbol} 1h von ${new Date(von).toISOString()} bis ${new Date(bis).toISOString()} …`);

const bars = await holeBinanceKerzen({ symbol, timeframe: '1h', von, bis, pauseMs: 250 });

speichereNdjson(ziel, bars);
console.log(`${bars.length} Bars → ${ziel}`);
console.log(
  'Die Datei ist gitignoriert. Wer sie weitergibt, prueft vorher die Lizenz des Venue.',
);
