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
// Dieser Test prueft nicht die KONFIGURATION, sondern das VERHALTEN: er laesst
// ESLint wirklich ueber erfundenen Code laufen. Eine Pruefung, die nur
// nachsieht, ob eine Zeichenkette in der Konfigurationsdatei steht, ist nach
// einer umbenannten Option still wertlos.
//
// Beide Richtungen zaehlen. Nur „verboten, wo es verboten sein muss" waere die
// halbe Wahrheit: eine Regel, die ueberall gilt, zwingt die Uhr selbst dazu,
// sich abzuschalten — und eine Regel, die man an ihrer wichtigsten Stelle
// abschaltet, erzieht niemanden mehr.
// ─────────────────────────────────────────────────────────────────────────────

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: WURZEL });

async function befunde(pfad: string, quelle: string): Promise<string[]> {
  const [ergebnis] = await eslint.lintText(quelle, { filePath: pfad, warnIgnored: false });
  return (ergebnis?.messages ?? []).map((m) => `${m.ruleId ?? '?'}: ${m.message}`);
}

const MIT_WANDUHR = 'export const jetzt = () => Date.now();\n';
const MIT_ZUFALL = 'export const wuerfel = () => Math.random();\n';

describe('Determinismus wird von ESLint bewacht, nicht nur versprochen', () => {
  for (const muster of RECHENPFADE) {
    const pfad = muster.replace('**/*.ts', 'probe.ts');

    it(`${pfad}: Date.now() ist verboten`, async () => {
      const m = (await befunde(pfad, MIT_WANDUHR)).join('\n');
      expect(m).toMatch(/no-restricted-properties/);
      expect(m).toMatch(/Wanduhr/);
    });

    it(`${pfad}: Math.random() ist verboten`, async () => {
      const m = (await befunde(pfad, MIT_ZUFALL)).join('\n');
      expect(m).toMatch(/no-restricted-properties/);
      expect(m).toMatch(/Zufall/);
    });
  }

  it('die Uhr selbst darf die Uhr lesen', async () => {
    for (const pfad of UHRENPFADE) {
      const m = (await befunde(pfad, MIT_WANDUHR)).join('\n');
      expect(m, pfad).not.toMatch(/no-restricted-properties/);
    }
  });

  it('ausserhalb der Rechenwege gilt das Verbot nicht', async () => {
    const m = (await befunde('scripts/erstlauf.ts', MIT_WANDUHR)).join('\n');
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
  it('kein Steuer- oder Richtungszeichen in verfolgten Quelldateien', () => {
    const dateien = execFileSync('git', ['ls-files', '*.ts', '*.mjs', '*.js', '*.json', '*.md'], {
      cwd: WURZEL,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    expect(dateien.length).toBeGreaterThan(20);

    // Diese eine Zeile MUSS die Zeichen benennen, gegen die sie schuetzt —
    // sonst koennte sie nicht nach ihnen suchen. Als Escapes geschrieben, also
    // lesbar; die Regeln davor gelten fuer alle anderen Stellen weiter.
    /* eslint-disable no-control-regex, no-irregular-whitespace */
    const unsichtbar =
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
    /* eslint-enable no-control-regex, no-irregular-whitespace */

    const treffer: string[] = [];
    for (const datei of dateien) {
      const text = readFileSync(`${WURZEL}${datei}`, 'utf8');
      const fund = unsichtbar.exec(text);
      if (fund) {
        const zeile = text.slice(0, fund.index).split('\n').length;
        const punkt = fund[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
        treffer.push(`${datei}:${zeile} U+${punkt}`);
      }
    }
    expect(treffer).toEqual([]);
  });
});
