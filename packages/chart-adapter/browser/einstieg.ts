import { EChartsTreiber, type EcBibliothek } from '../src/echarts.ts';
import { LightweightTreiber, type LwcBibliothek } from '../src/lightweight.ts';
import type { Treiber } from '../src/vertrag.ts';
import { vonWire, type ChartPaket } from '../src/wire.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Browser-Einstieg — beide Treiber, ein Paket, nebeneinander.
//
// Das ist die Sichtprobe zur Konformitaetssuite: die Tests beweisen, dass die
// Treiber richtig UEBERSETZEN; erst hier sieht man, dass die Bibliotheken das
// Uebersetzte auch richtig ZEICHNEN.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    LightweightCharts: LwcBibliothek;
    echarts: EcBibliothek;
    __VP_PAKET__: string;
    __VP_RUECKSCHAU__?: Record<string, Record<string, { punkte: number; marker: number; vereinfacht: string | null }>>;
  }
}

function dunkel(): boolean {
  const t = document.documentElement.dataset['theme'];
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function starte(): void {
  const paket = vonWire<ChartPaket>(window.__VP_PAKET__);
  const istDunkel = dunkel();

  const lwcEl = document.getElementById('lwc')!;
  const ecEl = document.getElementById('ec')!;

  const lwc = new LightweightTreiber(lwcEl, window.LightweightCharts, {
    layout: {
      attributionLogo: false,
      background: { color: 'transparent' },
      textColor: istDunkel ? '#d1d4dc' : '#333',
    },
    grid: {
      vertLines: { color: istDunkel ? '#2a2e39' : '#eceff1' },
      horzLines: { color: istDunkel ? '#2a2e39' : '#eceff1' },
    },
  });
  const ec = new EChartsTreiber(ecEl, window.echarts, { dunkel: istDunkel });

  const treiber: Treiber[] = [lwc, ec];
  for (const t of treiber) {
    for (const l of paket.layer) t.lege(l);
    t.wende(paket.ops);
  }
  lwc.passeAn();

  // Die Rueckschau beider Treiber — fuer die Kontrolle von aussen, und damit
  // eine Abweichung zwischen den Bibliotheken auffaellt statt nur hinzusehen.
  window.__VP_RUECKSCHAU__ = {};
  for (const t of treiber) {
    const r: Record<string, { punkte: number; marker: number; vereinfacht: string | null }> = {};
    for (const l of paket.layer) {
      const x = t.rueckschau(l.id);
      r[l.titel] = { punkte: x.punkte.length, marker: x.marker.length, vereinfacht: x.vereinfacht };
    }
    window.__VP_RUECKSCHAU__[t.name] = r;
  }

  const hinweise = Object.entries(window.__VP_RUECKSCHAU__)
    .flatMap(([name, r]) => Object.entries(r).filter(([, v]) => v.vereinfacht).map(([l, v]) => `${name} · ${l}: ${v.vereinfacht}`));
  const box = document.getElementById('hinweise');
  if (box) {
    box.textContent = hinweise.length > 0 ? hinweise.join(' — ') : 'Beide Treiber zeichnen alle Layer vollständig.';
  }

  window.addEventListener('resize', () => {
    ec.groesseAnpassen();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', starte);
else starte();
