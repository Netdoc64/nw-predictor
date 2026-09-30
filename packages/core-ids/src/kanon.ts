// ─────────────────────────────────────────────────────────────────────────────
// Kanonische Form eines Parametersatzes — PLAN.md §2.4.
//
// `JSON.stringify` genuegt NICHT: es behaelt die Einfuegereihenfolge der
// Schluessel, macht aus `-0` eine `0` (gut) und aus `1.0` eine `1` (auch gut),
// laesst aber `undefined` in Arrays zu `null` werden und kennt keine Regel fuer
// `NaN`. Ohne feste Regeln bekommt dieselbe Rechnung zwei Cache-Eintraege —
// oder, schlimmer, zwei verschiedene Rechnungen denselben.
// ─────────────────────────────────────────────────────────────────────────────

export class KanonFehler extends Error {
  readonly code: 'VP-REG-0007';

  constructor(code: 'VP-REG-0007', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'KanonFehler';
  }
}

function zahl(n: number): string {
  if (Number.isNaN(n)) {
    throw new KanonFehler('VP-REG-0007', 'NaN ist als Parameter nicht zulaessig');
  }
  if (!Number.isFinite(n)) {
    throw new KanonFehler('VP-REG-0007', `${n} ist als Parameter nicht zulaessig`);
  }
  // -0 und 0 sind derselbe Parameter. Ohne diese Zeile sind es zwei.
  if (Object.is(n, -0)) return '0';
  // `toString` liefert die kuerzeste Darstellung, die verlustfrei zurueckliest:
  // 1.0 → "1", 0.30000000000000004 → genau das.
  return String(n);
}

function schreibe(wert: unknown, pfad: string): string {
  if (wert === null) return 'null';

  switch (typeof wert) {
    case 'boolean':
      return wert ? 'true' : 'false';
    case 'number':
      return zahl(wert);
    case 'bigint':
      return `${wert.toString()}n`;
    case 'string':
      // NFC: "é" als ein Codepoint oder als e+Akzent ist derselbe Parameter.
      return JSON.stringify(wert.normalize('NFC'));
    case 'undefined':
      throw new KanonFehler('VP-REG-0007', `undefined an ${pfad} — Schluessel weglassen statt setzen`);
    case 'object':
      break;
    default:
      throw new KanonFehler('VP-REG-0007', `${typeof wert} ist als Parameter nicht zulaessig (${pfad})`);
  }

  if (Array.isArray(wert)) {
    // Reihenfolge ist bedeutungstragend — niemals sortieren.
    return `[${wert.map((w, i) => schreibe(w, `${pfad}[${i}]`)).join(',')}]`;
  }

  const eintraege = Object.entries(wert as Record<string, unknown>)
    // `undefined` ist identisch zu "nicht gesetzt" — beides faellt weg.
    .filter(([, v]) => v !== undefined)
    // Codepoint-Reihenfolge, nicht Gebietsschema: `localeCompare` sortiert je
    // nach Sprache verschieden und haette den Hash von der Umgebung abhaengig
    // gemacht.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${eintraege
    .map(([k, v]) => `${JSON.stringify(k.normalize('NFC'))}:${schreibe(v, `${pfad}.${k}`)}`)
    .join(',')}}`;
}

/** Kanonische Zeichenkette eines Wertes. Gleiche Bedeutung → gleiche Zeichenkette. */
export function kanon(wert: unknown): string {
  return schreibe(wert, '$');
}

/**
 * Defaults in den Parametersatz einsetzen — PLAN.md §3.3/C29.
 *
 * Das passiert beim SCHREIBEN einer Definition, nicht beim Lesen. Sonst
 * aendert ein neuer Default still das Ergebnis aller bestehenden Instanzen,
 * und niemand sieht es im Diff.
 */
export function mitDefaults<T extends Record<string, unknown>>(
  gesetzt: Partial<T>,
  defaults: T,
): T {
  const ergebnis = { ...defaults };
  for (const [k, v] of Object.entries(gesetzt)) {
    if (v !== undefined) (ergebnis as Record<string, unknown>)[k] = v;
  }
  return ergebnis;
}
