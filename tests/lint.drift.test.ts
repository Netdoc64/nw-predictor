import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { RECHENPFADE, UHRENPFADE } from '../eslint.config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Die Regel UND ihr Waechter — PLAN.md §4.3.
//
// Der Plan versprach: „`Date.now()` ist in `packages/compute` per Lint-Regel
// verboten — ESLint + Drift-Test". Das Versprechen stand da, der Waechter
// nicht; der Code hielt sich zwar daran, aber die erste Zeile, die es verletzt
// haette, waere gruen durchgelaufen.
//
// Geprueft wird das VERHALTEN, nicht die Konfiguration: ESLint laeuft wirklich
// ueber erfundenen Code. Eine Pruefung, die nur nachsieht, ob eine
// Zeichenkette in der Konfigurationsdatei steht, ist nach einer umbenannten
// Option still wertlos.
//
// Beide Richtungen zaehlen. Nur „verboten, wo es verboten sein muss" waere die
// halbe Wahrheit: eine Regel, die ueberall gilt, zwingt die Uhr selbst dazu,
// sich abzuschalten — und eine Regel, die man an ihrer wichtigsten Stelle
// abschaltet, erzieht niemanden mehr.
// ─────────────────────────────────────────────────────────────────────────────

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: WURZEL });

const ZEILENUMBRUCH = String.fromCharCode(10);

async function befunde(pfad: string, quelle: string): Promise<string[]> {
  const [ergebnis] = await eslint.lintText(quelle, { filePath: pfad, warnIgnored: false });
  return (ergebnis?.messages ?? []).map((m) => `${m.ruleId ?? '?'}: ${m.message}`);
}

const MIT_WANDUHR = 'export const jetzt = () => Date.now();';
const MIT_ZUFALL = 'export const wuerfel = () => Math.random();';

describe('Determinismus wird von ESLint bewacht, nicht nur versprochen', () => {
  for (const muster of RECHENPFADE) {
    const pfad = muster.replace('**/*.ts', 'probe.ts');

    it(`${pfad}: Date.now() ist verboten`, async () => {
      const m = (await befunde(pfad, MIT_WANDUHR)).join(ZEILENUMBRUCH);
      expect(m).toMatch(/no-restricted-properties/);
      expect(m).toMatch(/Wanduhr/);
    });

    it(`${pfad}: Math.random() ist verboten`, async () => {
      const m = (await befunde(pfad, MIT_ZUFALL)).join(ZEILENUMBRUCH);
      expect(m).toMatch(/no-restricted-properties/);
      expect(m).toMatch(/Zufall/);
    });
  }

  it('die Uhr selbst darf die Uhr lesen', async () => {
    for (const pfad of UHRENPFADE) {
      const m = (await befunde(pfad, MIT_WANDUHR)).join(ZEILENUMBRUCH);
      expect(m, pfad).not.toMatch(/no-restricted-properties/);
    }
  });

  it('ausserhalb der Rechenwege gilt das Verbot nicht', async () => {
    const m = (await befunde('scripts/erstlauf.ts', MIT_WANDUHR)).join(ZEILENUMBRUCH);
    expect(m).not.toMatch(/no-restricted-properties/);
  });

  it('die Begruendung nennt den Ausweg, nicht nur das Verbot', async () => {
    const [m] = await befunde('packages/compute/src/probe.ts', MIT_WANDUHR);
    // Ein Verbot ohne Ausweg laesst den Naechsten raten — oder die Regel
    // abschalten.
    expect(m).toMatch(/uhr\.jetzt\(\)|hineingereicht/i);
  });
});

describe('Der Quelltext traegt keine unsichtbaren Zeichen', () => {
  // Der erste Lint-Lauf fand sie in `datentext()` — ausgerechnet in der
  // Funktion, die sie entfernt. Diese Pruefung sieht nicht ESLint zu, sondern
  // den Dateien selbst: Steuer- und Richtungszeichen im Quelltext sind die
  // Grundlage des „trojanischen Quelltexts", bei dem auseinanderfaellt, was ein
  // Mensch liest und was die Maschine ausfuehrt.
  //
  // ZAHLEN STATT ZEICHENKLASSE, und das ist kein Stil: die erste Fassung trug
  // die Bereiche als Escapes im Quelltext, und genau die wurden beim Schreiben
  // der Datei zu echten Zeichen. Die Pruefung gegen unsichtbare Zeichen
  // schmuggelte also selbst welche ein — gefunden hat es die CI, nicht der
  // lokale Lauf. Zahlen koennen das nicht.
  const BEREICHE: ReadonlyArray<readonly [number, number]> = [
    [0x00, 0x08], // C0 ohne Tabulator, Zeilenumbruch, Wagenruecklauf
    [0x0b, 0x0c],
    [0x0e, 0x1f],
    [0x7f, 0x7f], // DEL
    [0x200b, 0x200f], // Nullbreite und Richtungsmarken
    [0x202a, 0x202e], // Richtungs-Einbettung
    [0x2060, 0x2064], // Wortverbinder, unsichtbare Operatoren
    [0x2066, 0x2069], // Richtungs-Isolate
    [0xfeff, 0xfeff], // Byte-Order-Mark mitten im Text
  ];

  const ersterTreffer = (text: string): number => {
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (BEREICHE.some(([von, bis]) => c >= von && c <= bis)) return i;
    }
    return -1;
  };

  it('kein Steuer- oder Richtungszeichen in Quelldateien', () => {
    // `--others` gehoert dazu: eine NEUE Datei ist noch nicht verfolgt und
    // faellt sonst durch die Pruefung. Beim ersten Lauf war das diese Datei
    // selbst — lokal gruen, in der CI rot.
    const dateien = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts', '*.mjs', '*.js', '*.json', '*.md'],
      { cwd: WURZEL, encoding: 'utf8' },
    )
      .split(ZEILENUMBRUCH)
      .filter(Boolean);
    expect(dateien.length).toBeGreaterThan(20);

    const treffer: string[] = [];
    for (const datei of dateien) {
      const text = readFileSync(`${WURZEL}${datei}`, 'utf8');
      const i = ersterTreffer(text);
      if (i < 0) continue;

      let zeile = 1;
      for (let k = 0; k < i; k += 1) if (text.charCodeAt(k) === 10) zeile += 1;
      const punkt = text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
      treffer.push(`${datei}:${zeile} U+${punkt}`);
    }
    expect(treffer).toEqual([]);
  });
});
