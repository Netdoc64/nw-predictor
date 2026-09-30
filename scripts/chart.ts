import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { betrag, scopeLesen } from '@vp/core-ids';
import { alsWire } from '@vp/chart-adapter';
import { ChartBindung } from '@vp/chart-bindung';
import { resolve } from '@vp/registry';
import { fuehreAus } from '@vp/sim';
import { ladePruefstand, WURZEL } from './pruefstand.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Chart-Ansicht eines Laufs — beide Treiber nebeneinander.
//
//   node --experimental-strip-types scripts/chart.ts [strategie]
//
// Schreibt `laeufe/<strategie>/chart.html`: eine einzelne Datei, Bibliotheken
// eingebettet, kein Netz noetig. Ob beide Treiber dasselbe zeigen, sieht man —
// und `window.__VP_RUECKSCHAU__` sagt es auch maschinenlesbar.
// ─────────────────────────────────────────────────────────────────────────────

const strategieId = process.argv[2] ?? 'ema-cross-v1';
const ps = ladePruefstand();
const { katalog, bars } = ps;

const strategie = katalog.strategien.get(strategieId);
if (!strategie) {
  console.error(`Strategie unbekannt: ${strategieId}. Vorhanden: ${[...katalog.strategien.keys()].join(', ')}`);
  process.exit(2);
}

const szenario = ps.szenario(strategieId);
const plan = resolve(katalog, strategie.profil, scopeLesen(ps.scopeKey), { datenRevision: szenario.datenRevision });
const bindung = new ChartBindung(plan, katalog);

const lauf = fuehreAus({
  katalog, szenario, scopeKey: ps.scopeKey, meta: ps.meta, bars,
  beobachter: (bar, werte) => {
    bindung.schritt(bar, werte);
  },
});

const b = lauf.bericht;
const paket = bindung.paket(`${strategieId} · BTCUSDT 1h`, [ps.echt ? 'Binance' : 'Kunstreihe']);

// ── Browser-Teil bundeln ──
const bundle = await build({
  entryPoints: [join(WURZEL, 'packages/chart-adapter/browser/einstieg.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  minify: true,
  plugins: [
    {
      name: 'crypto-attrappe',
      setup(p) {
        p.onResolve({ filter: /^node:crypto$/ }, () => ({
          path: join(WURZEL, 'packages/chart-adapter/browser/crypto-attrappe.ts'),
        }));
      },
    },
  ],
});
const einstieg = bundle.outputFiles[0]!.text;

const lwc = readFileSync(join(WURZEL, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'), 'utf8');
const ec = readFileSync(join(WURZEL, 'node_modules/echarts/dist/echarts.min.js'), 'utf8');

const kachel = (k: string, v: string) => `<div class="kachel"><span>${k}</span><strong>${v}</strong></div>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
// Ein `</script>` im eingebetteten Text beendet den Block vorzeitig.
const sicher = (js: string) => js.replace(/<\/script/gi, '<\\/script');

// Die erzeugte Datei enthaelt beide Bibliotheken im Volltext, damit sie ohne
// Netz laeuft. Damit VERTEILT sie Apache-2.0-Code — und Apache 4(a) verlangt,
// dass der Lizenztext mitgeht. Ohne diesen Kopf waere jede weitergegebene
// Chart-Datei ein Lizenzverstoss.
const lizenzkopf = `<!--
  ${strategieId} — erzeugt von nw-predictor
  Copyright 2026 Netdoc64 · Apache-Lizenz 2.0

  Diese Datei enthaelt eingebettet:

    TradingView Lightweight Charts(TM) — Copyright 2023 TradingView, Inc.
    https://github.com/tradingview/lightweight-charts

    Apache ECharts — Copyright The Apache Software Foundation
    https://github.com/apache/echarts

  Beide unter der Apache-Lizenz 2.0:
  https://www.apache.org/licenses/LICENSE-2.0

  Kursdaten stehen NICHT unter dieser Lizenz — sie gehoeren dem Handelsplatz.
-->`;

const html = `<!doctype html>
${lizenzkopf}
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(strategieId)} — nw-predictor</title>
<style>
  :root { --grund:#fafafa; --flaeche:#fff; --text:#1f2328; --leise:#656d76; --linie:#d8dee4; --akzent:#2962ff; }
  @media (prefers-color-scheme: dark) { :root { --grund:#0d1117; --flaeche:#161b22; --text:#e6edf3; --leise:#8d96a0; --linie:#30363d; --akzent:#58a6ff; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:20px 24px 32px; background:var(--grund); color:var(--text); font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  header h1 { margin:0; font-size:20px; font-weight:600; }
  header p { margin:4px 0 16px; color:var(--leise); font-size:13px; }
  .kacheln { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom:16px; }
  .kachel { background:var(--flaeche); border:1px solid var(--linie); border-radius:6px; padding:8px 12px; }
  .kachel span { display:block; color:var(--leise); font-size:12px; }
  .kachel strong { font-size:15px; font-variant-numeric:tabular-nums; }
  .paar { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media (max-width: 900px) { .paar { grid-template-columns:1fr; } }
  .feld { background:var(--flaeche); border:1px solid var(--linie); border-radius:6px; overflow:hidden; }
  .feld h2 { margin:0; padding:8px 12px; font-size:13px; font-weight:600; border-bottom:1px solid var(--linie); }
  .chart { height:620px; width:100%; }
  #hinweise { margin-top:12px; color:var(--leise); font-size:12px; }
  footer { margin-top:16px; color:var(--leise); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>${esc(paket.titel)}</h1>
  <p>${esc(paket.untertitel)}</p>
</header>
<section class="kacheln">
  ${kachel('Start', betrag(b.startkapital, b.waehrung))}
  ${kachel('Ende', betrag(b.endkapital, b.waehrung))}
  ${kachel('realisiert', betrag(b.realisiert, b.waehrung))}
  ${kachel('Gebühren', betrag(b.gebuehren, b.waehrung))}
  ${kachel('Trades', `${b.trades} (${b.gewinnTrades} im Plus)`)}
  ${kachel('Rückgang', `${(b.maxRueckgangBp / 100).toFixed(2).replace('.', ',')} %`)}
</section>
<section class="paar">
  <div class="feld"><h2>Lightweight Charts</h2><div id="lwc" class="chart"></div></div>
  <div class="feld"><h2>ECharts</h2><div id="ec" class="chart"></div></div>
</section>
<p id="hinweise"></p>
<footer>Layer aus der Registry: ${paket.layer.map((l) => esc(l.titel)).join(' · ')}. Beträge vor Steuern, keine Empfehlung.<br>
Gezeichnet mit <a href="https://github.com/tradingview/lightweight-charts">TradingView Lightweight Charts™</a> und <a href="https://github.com/apache/echarts">Apache ECharts</a>, beide Apache-2.0. Erzeugt von nw-predictor, Apache-2.0.</footer>
<script>${sicher(lwc)}</script>
<script>${sicher(ec)}</script>
<script>window.__VP_PAKET__ = ${JSON.stringify(alsWire(paket))};</script>
<script>${sicher(einstieg)}</script>
</body>
</html>`;

const ziel = join(WURZEL, 'laeufe', strategieId, 'chart.html');
mkdirSync(dirname(ziel), { recursive: true });
writeFileSync(ziel, html, 'utf8');
console.log(`${ziel}  (${(html.length / 1024).toFixed(0)} KB, ${paket.layer.length} Layer, ${b.trades} Trades)`);
