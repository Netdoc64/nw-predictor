import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dauer, type Timeframe, type TimeMs } from '@vp/core-ids';
import type { RohBar } from './normalisierung.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Quellen — woher die Bars kommen.
//
// Der `replay`-Feed ist NICHT der Sonderfall fuer den Backtest, sondern die
// Normalform: die Maschine sieht in beiden Faellen denselben Strom (PLAN.md
// §4.6). Der Unterschied ist nur, ob die Bars aus einer Datei oder aus dem Netz
// kommen — und das weiss ab hier niemand mehr.
// ─────────────────────────────────────────────────────────────────────────────

export function ladeNdjson(pfad: string): RohBar[] {
  return readFileSync(pfad, 'utf8')
    .split('\n')
    .filter((z) => z.trim().length > 0)
    .map((z) => JSON.parse(z) as RohBar);
}

export function speichereNdjson(pfad: string, bars: readonly RohBar[]): void {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, `${bars.map((b) => JSON.stringify(b)).join('\n')}\n`, 'utf8');
}

// ── Binance: oeffentliche Kerzen ueber REST ──────────────────────────────────

const BINANCE = 'https://api.binance.com/api/v3/klines';

/**
 * Kerzen holen, seitenweise.
 *
 * Bewusst der REST-Endpunkt und nicht die Monatsarchive: JSON statt ZIP, kein
 * Entpacken, kein Schluessel. Fuer die Mengen des ersten Laufs reicht das —
 * und was nicht reicht, faellt beim Zaehlen der Bars auf, nicht spaeter.
 *
 * Ein Token-Eimer je Venue (PLAN.md §4.5) fehlt hier noch: solange EIN Prozess
 * eine Reihe holt, ist die Pause zwischen den Seiten die ganze Politik. Sobald
 * mehrere Scopes gleichzeitig laden, gehoert er hierher.
 */
export async function holeBinanceKerzen(opt: {
  symbol: string;
  timeframe: Timeframe;
  von: TimeMs;
  bis: TimeMs;
  pauseMs?: number;
}): Promise<RohBar[]> {
  const d = dauer(opt.timeframe);
  const raus: RohBar[] = [];
  let start = opt.von;

  while (start < opt.bis) {
    const u = new URL(BINANCE);
    u.searchParams.set('symbol', opt.symbol);
    u.searchParams.set('interval', opt.timeframe);
    u.searchParams.set('startTime', String(start));
    u.searchParams.set('endTime', String(opt.bis));
    u.searchParams.set('limit', '1000');

    const antwort = await fetch(u, { headers: { accept: 'application/json' } });
    if (!antwort.ok) {
      throw new Error(`Binance antwortet ${antwort.status}: ${await antwort.text()}`);
    }
    const seite = (await antwort.json()) as unknown[][];
    if (seite.length === 0) break;

    for (const k of seite) {
      raus.push({
        t: Number(k[0]),
        o: String(k[1]),
        h: String(k[2]),
        l: String(k[3]),
        c: String(k[4]),
        v: String(k[5]),
      });
    }
    const letzte = Number(seite[seite.length - 1]![0]);
    start = letzte + d;
    if (opt.pauseMs) await new Promise((r) => setTimeout(r, opt.pauseMs));
  }
  return raus;
}

/**
 * Eine deterministische Reihe fuer Tests.
 *
 * Kein Zufall ohne Saat, und die Saat steht im Aufruf: derselbe Aufruf liefert
 * dieselbe Reihe, auf jeder Maschine, in jedem Lauf. Ein Test, der an einem
 * ungesaeten `Math.random()` haengt, faellt irgendwann — und dann sucht man den
 * Fehler im Code statt im Test.
 */
export function kunstReihe(opt: {
  von: TimeMs;
  anzahl: number;
  timeframe: Timeframe;
  start?: number;
  saat?: number;
}): RohBar[] {
  const d = dauer(opt.timeframe);
  let zustand = (opt.saat ?? 42) >>> 0;
  const naechste = (): number => {
    // xorshift32 — klein, schnell, reproduzierbar.
    zustand ^= zustand << 13;
    zustand ^= zustand >>> 17;
    zustand ^= zustand << 5;
    zustand >>>= 0;
    return zustand / 0x1_0000_0000;
  };

  const raus: RohBar[] = [];
  let preis = opt.start ?? 20_000;
  for (let i = 0; i < opt.anzahl; i += 1) {
    const schritt = (naechste() - 0.48) * preis * 0.01;
    const o = preis;
    const c = Math.max(1, o + schritt);
    const h = Math.max(o, c) * (1 + naechste() * 0.002);
    const l = Math.min(o, c) * (1 - naechste() * 0.002);
    raus.push({
      t: opt.von + i * d,
      o: o.toFixed(2),
      h: h.toFixed(2),
      l: l.toFixed(2),
      c: c.toFixed(2),
      v: (100 + naechste() * 50).toFixed(4),
    });
    preis = c;
  }
  return raus;
}
