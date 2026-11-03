import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { FremdschreiberFehler, SpeicherFehler, lies, restTmp, schreib } from '@vp/registry';

// Alles in einem Temp-Verzeichnis — nie in registry/.
let wurzel: string;
let pfad: string;

beforeEach(() => {
  wurzel = mkdtempSync(join(tmpdir(), 'vp-speicher-'));
  pfad = join(wurzel, 'a.json');
});
afterEach(() => rmSync(wurzel, { recursive: true, force: true }));

const codeVon = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe('Speicher: atomar und mit Abdruck (C33)', () => {
  it('schreibt, liest zurueck und hinterlaesst weder tmp noch Sperre', () => {
    const ab = schreib(pfad, { stand: [] }, null);
    const g = lies<{ stand: string[] }>(pfad);
    expect(g.abdruck).toBe(ab);
    expect(g.wert).toEqual({ stand: [] });
    expect(readdirSync(wurzel).sort()).toEqual(['a.json', 'a.json.sha256']);
  });

  it('abgeschnittene Datei: lauter Fehler VP-STORE-0002, kein Start mit Unsinn', () => {
    schreib(pfad, { stand: ['a', 'b', 'c'] }, null);
    const roh = readFileSync(pfad, 'utf8');
    writeFileSync(pfad, roh.slice(0, roh.length - 8), 'utf8');
    expect(() => lies(pfad)).toThrowError(SpeicherFehler);
    expect(codeVon(() => lies(pfad))).toBe('VP-STORE-0002');
  });

  it('von Hand veraendertes, aber gueltiges JSON passt nicht zum Abdruck', () => {
    schreib(pfad, { stand: ['a'] }, null);
    writeFileSync(pfad, '{"stand":[]}\n', 'utf8');
    expect(() => lies(pfad)).toThrowError(/Abdruck/);
  });

  it('Datei ohne Abdruck (aeltere Datei) bleibt lesbar; kaputtes JSON meldet VP-REG-0006', () => {
    writeFileSync(pfad, '{"x":1}\n', 'utf8');
    expect(lies(pfad).wert).toEqual({ x: 1 });
    writeFileSync(pfad, '{"x":', 'utf8');
    expect(codeVon(() => lies(pfad))).toBe('VP-REG-0006');
  });

  it('Rest-tmp eines abgebrochenen Schreibens wird ignoriert und ist meldbar', () => {
    schreib(pfad, { stand: ['a'] }, null);
    const rest = `${pfad}.tmp-99999`;
    writeFileSync(rest, '{"stand":["halb', 'utf8');
    expect(lies<{ stand: string[] }>(pfad).wert.stand).toEqual(['a']);
    expect(restTmp(pfad)).toEqual([rest]);
    // ein weiteres Schreiben bleibt davon unberuehrt
    const g = lies(pfad);
    schreib(pfad, { stand: ['a', 'b'] }, g.abdruck);
    expect(lies<{ stand: string[] }>(pfad).wert.stand).toEqual(['a', 'b']);
  });
});

describe('Speicher: Fremdschreiber und Sperre (C34)', () => {
  it('Inhalt zwischen Lesen und Schreiben geaendert: VP-REG-0008, Datei unberuehrt', () => {
    schreib(pfad, { stand: [] }, null);
    const g = lies(pfad);
    schreib(pfad, { stand: ['fremd'] }, g.abdruck);
    expect(() => schreib(pfad, { stand: ['ich'] }, g.abdruck)).toThrowError(FremdschreiberFehler);
    expect(lies<{ stand: string[] }>(pfad).wert.stand).toEqual(['fremd']);
  });

  it('null heisst neu: existiert die Datei doch, ist das ein Fremdschreiber', () => {
    schreib(pfad, { stand: [] }, null);
    expect(() => schreib(pfad, { stand: ['x'] }, null)).toThrowError(FremdschreiberFehler);
  });

  it('Sperre eines lebenden Halters: VP-REG-0008, nichts geschrieben', () => {
    writeFileSync(`${pfad}.lock`, String(process.pid), 'utf8');
    expect(codeVon(() => schreib(pfad, { stand: [] }, null))).toBe('VP-REG-0008');
    expect(existsSync(pfad)).toBe(false);
  });

  it('Sperre eines toten Prozesses blockiert nicht fuer immer', () => {
    writeFileSync(`${pfad}.lock`, '2147483646', 'utf8');
    schreib(pfad, { stand: [] }, null);
    expect(existsSync(`${pfad}.lock`)).toBe(false);
  });

  it('Sperre wird auch nach einem Fehler freigegeben', () => {
    schreib(pfad, { stand: [] }, null);
    expect(() => schreib(pfad, {}, 'falsch')).toThrowError(FremdschreiberFehler);
    expect(existsSync(`${pfad}.lock`)).toBe(false);
  });
});

describe('Doppellauf mit zwei echten Prozessen (C34)', () => {
  const hilfe = join(dirname(fileURLToPath(import.meta.url)), 'doppellauf', 'schreiber.ts');

  const starte = (kennung: string, startDatei: string): Promise<{ kennung: string; ergebnis: string }> =>
    new Promise((ok, fehl) => {
      const kind = spawn(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', hilfe, pfad, kennung, startDatei],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let aus = '';
      let err = '';
      kind.stdout.on('data', (d) => (aus += d));
      kind.stderr.on('data', (d) => (err += d));
      kind.on('close', (code) => {
        if (code !== 0) return fehl(new Error(`Kind ${kennung} Exit ${code}: ${err}`));
        ok(JSON.parse(aus.trim().split('\n').pop() as string));
      });
    });

  it('genau einer gewinnt, der andere wirft VP-REG-0008, kein Fortschritt geht still verloren', async () => {
    schreib(pfad, { stand: ['start'] }, null);
    const startDatei = join(wurzel, 'start');
    const laeufe = Promise.all([starte('A', startDatei), starte('B', startDatei)]);
    // Erst wenn beide geladen haben, faellt der Startschuss — unabhaengig von der Last des Rechners.
    while (!existsSync(`${startDatei}.bereit-A`) || !existsSync(`${startDatei}.bereit-B`)) await new Promise((r) => setTimeout(r, 20));
    writeFileSync(startDatei, '');
    const [a, b] = await laeufe;

    expect([a.ergebnis, b.ergebnis].sort()).toEqual(['VP-REG-0008', 'ok']);

    const sieger = a.ergebnis === 'ok' ? a.kennung : b.kennung;
    expect(lies<{ stand: string[] }>(pfad).wert.stand).toEqual(['start', sieger]);
    expect(existsSync(`${pfad}.lock`)).toBe(false);
    expect(restTmp(pfad)).toEqual([]);
  }, 30_000);
});
