// ─────────────────────────────────────────────────────────────────────────────
// Festkomma — PLAN.md §4.3, §4.7, §12/I98 und L123.
//
// Kein `number` fuer Preise, Mengen oder Geld. `0.1 + 0.2 !== 0.3` ist keine
// Kuriositaet, sondern der Grund, warum die Summe der Belege am Ende nicht dem
// Kontostand entspricht — und das faellt erst auf, wenn niemand mehr weiss,
// welcher der 4.000 Fills die Abweichung gebracht hat.
//
// EINE Skala fuer alles: 8 Nachkommastellen. Zwei Skalen nebeneinander (Cent
// fuer Geld, 1e8 fuer Mengen) sind eine Umrechnung, die man irgendwo vergisst.
// ─────────────────────────────────────────────────────────────────────────────

/** Festkommazahl mit 8 Nachkommastellen, als bigint. */
export type Fix = bigint;

export const STELLEN = 8;
export const SKALA: Fix = 100_000_000n; // 10^8

export class ZahlFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'ZahlFehler';
  }
}

/**
 * Zeichenkette oder Zahl → Festkomma.
 *
 * `number` ist erlaubt, aber nur fuer LITERALE im Code (Parameter, Schwellen).
 * Marktdaten kommen als Zeichenkette herein und werden nie durch einen `number`
 * geschleust — sonst ist die Genauigkeit weg, bevor die erste Rechnung beginnt.
 */
export function fix(wert: string | number): Fix {
  const s = typeof wert === 'number' ? String(wert) : wert.trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    throw new ZahlFehler(`keine Zahl: ${JSON.stringify(wert)}`);
  }
  const vorzeichen = m[1] === '-' ? -1n : 1n;
  let ganz = m[2] ?? '';
  let bruch = m[3] ?? '';
  const exp = m[4] ? Number(m[4]) : 0;

  // Exponent durch Verschieben des Kommas aufloesen, nicht durch Multiplikation
  // mit einem Float.
  if (exp > 0) {
    const nimm = Math.min(exp, bruch.length);
    ganz += bruch.slice(0, nimm) + '0'.repeat(exp - nimm);
    bruch = bruch.slice(nimm);
  } else if (exp < 0) {
    const n = -exp;
    const nimm = Math.min(n, ganz.length);
    bruch = '0'.repeat(n - nimm) + ganz.slice(ganz.length - nimm) + bruch;
    ganz = ganz.slice(0, ganz.length - nimm);
  }

  if (bruch.length > STELLEN) {
    // Abschneiden, nicht runden: eine Rundung hier waere eine stille
    // Wertaenderung an der Systemgrenze.
    bruch = bruch.slice(0, STELLEN);
  }
  const gefuellt = bruch.padEnd(STELLEN, '0');
  return vorzeichen * (BigInt(ganz || '0') * SKALA + BigInt(gefuellt || '0'));
}

/** Festkomma → Zeichenkette mit fester Stellenzahl (kaufmaennisch gerundet). */
export function fixAlsText(v: Fix, stellen = STELLEN): string {
  if (stellen > STELLEN) throw new ZahlFehler(`hoechstens ${STELLEN} Stellen`);
  const negativ = v < 0n;
  let x = negativ ? -v : v;
  if (stellen < STELLEN) {
    const teiler = 10n ** BigInt(STELLEN - stellen);
    const rest = x % teiler;
    x = x / teiler;
    if (rest * 2n >= teiler) x += 1n;
    x = x * teiler;
  }
  const ganz = x / SKALA;
  const bruch = (x % SKALA).toString().padStart(STELLEN, '0').slice(0, stellen);
  const kopf = `${negativ && (ganz !== 0n || bruch.replace(/0/g, '') !== '') ? '-' : ''}${ganz}`;
  return stellen === 0 ? kopf : `${kopf}.${bruch}`;
}

export type Rundung = 'ab' | 'auf' | 'kaufmaennisch';

function teileMitRundung(zaehler: Fix, nenner: Fix, art: Rundung): Fix {
  if (nenner === 0n) throw new ZahlFehler('Division durch null');
  const negativ = zaehler < 0n !== nenner < 0n;
  const a = zaehler < 0n ? -zaehler : zaehler;
  const b = nenner < 0n ? -nenner : nenner;
  let q = a / b;
  const rest = a % b;
  if (rest !== 0n) {
    if (art === 'auf') q += 1n;
    else if (art === 'kaufmaennisch' && rest * 2n >= b) q += 1n;
  }
  return negativ ? -q : q;
}

/** a · b — mit ausdruecklicher Rundungsregel, weil das Produkt mehr Stellen hat als die Skala. */
export function mal(a: Fix, b: Fix, art: Rundung = 'ab'): Fix {
  return teileMitRundung(a * b, SKALA, art);
}

/** a ÷ b */
export function durch(a: Fix, b: Fix, art: Rundung = 'ab'): Fix {
  return teileMitRundung(a * SKALA, b, art);
}

/** Auf ein Vielfaches von `schritt` abrunden — Mengen an `stepSize`, Preise an `tickSize`. */
export function aufSchritt(wert: Fix, schritt: Fix, art: Rundung = 'ab'): Fix {
  if (schritt <= 0n) return wert;
  return teileMitRundung(wert, schritt, art) * schritt;
}

export const abs = (v: Fix): Fix => (v < 0n ? -v : v);
export const min = (a: Fix, b: Fix): Fix => (a < b ? a : b);
export const max = (a: Fix, b: Fix): Fix => (a > b ? a : b);

/**
 * Deutsche Darstellung eines Geldbetrags: `1.234,50 €`.
 * NUR fuer die Anzeige — nie zurueckparsen, nie weiterrechnen.
 */
export function betrag(v: Fix, waehrung = 'EUR'): string {
  const text = fixAlsText(v, 2);
  const negativ = text.startsWith('-');
  const [ganz = '0', bruch = '00'] = (negativ ? text.slice(1) : text).split('.');
  const mitPunkten = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const zeichen = waehrung === 'EUR' ? '€' : waehrung;
  return `${negativ ? '-' : ''}${mitPunkten},${bruch} ${zeichen}`;
}
