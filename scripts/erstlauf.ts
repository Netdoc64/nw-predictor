import { betrag } from '@vp/core-ids';
import { berichtAlsText, fuehreAus, vergleiche, vergleichAlsText } from '@vp/sim';
import { ladePruefstand } from './pruefstand.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Der erste Lauf — PLAN.md §16.
//
//   node --experimental-strip-types scripts/erstlauf.ts
//
// Liegt `daten/binance-BTCUSDT-1h.ndjson`, wird damit gerechnet. Sonst mit
// einer reproduzierbaren Kunstreihe — der Lauf soll auch ohne Netz etwas
// sagen, und was er dann sagt, sagt er ueber die Maschine, nicht ueber den
// Markt. Deshalb steht die Quelle im Kopf jeder Ausgabe.
// ─────────────────────────────────────────────────────────────────────────────

const ps = ladePruefstand();
const { katalog, bars } = ps;

function lauf(strategie: string) {
  return fuehreAus({ katalog, szenario: ps.szenario(strategie), scopeKey: ps.scopeKey, meta: ps.meta, bars });
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(' nw-predictor — erster Lauf');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Quelle       ${ps.quelle}`);
console.log(`Bars         ${bars.length}`);
console.log(`Zeitraum     ${new Date(bars[0]!.t).toISOString()} … ${new Date(bars.at(-1)!.t).toISOString()}`);
console.log(`Befunde      ${ps.befunde} (${ps.luecken} Luecken)`);
if (!ps.echt) {
  console.log('HINWEIS      Diese Zahlen beschreiben die MASCHINE, nicht den Markt.');
}

const laeufe = new Map<string, ReturnType<typeof lauf>>();
for (const s of ['null-v1', 'buyhold-v1', 'ema-cross-v1', 'ema-cross-v2']) {
  console.log(`\n── ${s} ───────────────────────────────────────────────`);
  const l = lauf(s);
  laeufe.set(s, l);
  console.log(berichtAlsText(l.bericht));
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' Strategievergleich — ema-cross-v1 gegen ema-cross-v2');
console.log('═══════════════════════════════════════════════════════════════');
const v = vergleiche(
  { lauf: laeufe.get('ema-cross-v1')!, strategie: katalog.strategien.get('ema-cross-v1')! },
  { lauf: laeufe.get('ema-cross-v2')!, strategie: katalog.strategien.get('ema-cross-v2')! },
);
console.log(vergleichAlsText(v));

console.log('\n── Messlatte ──────────────────────────────────────────────');
const latte = laeufe.get('buyhold-v1')!.bericht;
for (const [name, l] of laeufe) {
  if (name === 'buyhold-v1' || name === 'null-v1') continue;
  const d = l.bericht.endkapital - latte.endkapital;
  console.log(
    `${name.padEnd(14)} ${d >= 0n ? 'ueber' : 'unter'} Kaufen-und-Halten um ${betrag(d < 0n ? -d : d, 'USDT')}`,
  );
}
console.log('\nKeine Empfehlung, kein Sieger. Betraege vor Steuern. (PLAN.md §13)');
