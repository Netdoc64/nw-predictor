import { barBeginn, dauer, fix, type Bar, type Timeframe, type TimeMs } from '@vp/core-ids';
import type { ErrorCode } from '@vp/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Feed-Normalisierung — PLAN.md §12/A5, A6, A9, B11, B12, B22, B26.
//
// Hier und nur hier wird aus dem, was ein Venue schickt, eine Bar dieses
// Systems: Zeitstempel ist die OEFFNUNGSZEIT, Einheit Millisekunden, Preise in
// Festkomma. Alles, was danach kommt, darf sich darauf verlassen.
//
// Was nicht plausibel ist, wird VERWORFEN und gezaehlt — nicht repariert. Eine
// stillschweigend zurechtgebogene Bar ist ein Messwert, den es nie gab.
// ─────────────────────────────────────────────────────────────────────────────

export interface RohBar {
  /** Oeffnungszeit. Millisekunden oder Sekunden — `einheit` sagt welche. */
  t: number;
  o: string | number;
  h: string | number;
  l: string | number;
  c: string | number;
  v?: string | number | null;
}

export interface Befund {
  readonly code: ErrorCode;
  readonly t: TimeMs;
  readonly text: string;
}

export interface NormErgebnis {
  readonly bars: readonly Bar[];
  readonly befunde: readonly Befund[];
  readonly luecken: readonly { von: TimeMs; bis: TimeMs; bars: number }[];
}

export interface NormOptionen {
  readonly timeframe: Timeframe;
  readonly einheit?: 'ms' | 's';
  /** Zeitpunkt, ab dem ein Zeitstempel „in der Zukunft" liegt. */
  readonly jetzt?: TimeMs;
  /** Wie weit eine zu spaet eintreffende Bar noch einsortiert werden darf. */
  readonly umsortierFensterBars?: number;
}

export function normalisiere(roh: readonly RohBar[], opt: NormOptionen): NormErgebnis {
  const d = dauer(opt.timeframe);
  const jetzt = opt.jetzt ?? Number.MAX_SAFE_INTEGER;
  const befunde: Befund[] = [];
  const nachZeit = new Map<TimeMs, Bar>();

  for (const r of roh) {
    const t = opt.einheit === 's' ? Math.trunc(r.t) * 1000 : Math.trunc(r.t);

    if (t > jetzt) {
      befunde.push({ code: 'VP-FEED-0012', t, text: 'Zeitstempel liegt in der Zukunft' });
      continue;
    }
    // Auf den Bar-Anker ausrichten. Ein Venue, der 09:00:00.123 schickt, meint
    // die 09:00-Bar — aber raten tun wir das nicht still, sondern hier.
    const anker = barBeginn(t, opt.timeframe);

    const bar: Bar = {
      t: anker,
      o: fix(String(r.o)),
      h: fix(String(r.h)),
      l: fix(String(r.l)),
      c: fix(String(r.c)),
      v: r.v === null || r.v === undefined ? null : fix(String(r.v)),
    };

    if (bar.h < bar.l || bar.o > bar.h || bar.o < bar.l || bar.c > bar.h || bar.c < bar.l) {
      befunde.push({ code: 'VP-FEED-0031', t: anker, text: 'high/low/open/close widersprechen sich' });
      continue;
    }
    if (bar.h <= 0n) {
      befunde.push({ code: 'VP-FEED-0031', t: anker, text: 'Preis ist nicht positiv' });
      continue;
    }

    const schon = nachZeit.get(anker);
    if (schon) {
      const gleich = schon.o === bar.o && schon.h === bar.h && schon.l === bar.l && schon.c === bar.c;
      if (!gleich) {
        // Eine Korrektur, kein Duplikat: der spaetere Stand gewinnt, aber er
        // wird gezaehlt — daran haengt spaeter die Datenrevision (§12/B13).
        nachZeit.set(anker, bar);
      }
      befunde.push({
        code: 'VP-FEED-0011',
        t: anker,
        text: gleich ? 'Bar doppelt, inhaltsgleich' : 'Bar doppelt, Inhalt weicht ab — spaeterer Stand gilt',
      });
      continue;
    }
    nachZeit.set(anker, bar);
  }

  const bars = [...nachZeit.values()].sort((a, b) => a.t - b.t);

  const luecken: { von: TimeMs; bis: TimeMs; bars: number }[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const vor = bars[i - 1]!;
    const jetztBar = bars[i]!;
    const abstand = jetztBar.t - vor.t;
    if (abstand > d) {
      const fehlend = abstand / d - 1;
      luecken.push({ von: vor.t + d, bis: jetztBar.t - d, bars: fehlend });
      befunde.push({
        code: 'VP-FEED-0022',
        t: vor.t + d,
        text: `${fehlend} Bar(s) fehlen`,
      });
    }
  }

  return { bars, befunde, luecken };
}

/**
 * Abdeckung pruefen — der Guard `coverage_ok` der Maschine (PLAN.md §4.2).
 *
 * Getrennt von `normalisiere`, weil die Frage eine andere ist: dort „ist diese
 * Bar brauchbar", hier „reicht, was wir haben, fuer den Plan".
 */
export function abdeckungReicht(
  bars: readonly Bar[],
  warmupBars: number,
  luecken: readonly { bars: number }[],
  luekenToleranz = 0,
): { ok: boolean; grund?: string } {
  if (bars.length < warmupBars) {
    return { ok: false, grund: `${bars.length} Bars, ${warmupBars} noetig` };
  }
  const groesste = luecken.reduce((m, l) => Math.max(m, l.bars), 0);
  if (groesste > luekenToleranz) {
    return { ok: false, grund: `groesste Luecke ${groesste} Bars > Toleranz ${luekenToleranz}` };
  }
  return { ok: true };
}
