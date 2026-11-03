import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RevisionsFehler,
  activate,
  aktive,
  journal,
  rollback,
  rollbackVorschau,
  revisionen,
  upsert,
  vorschau,
  type Kontext,
} from '@vp/registry';
import { CODES } from '@vp/errors';

// Alles in einem Temp-Verzeichnis — nie in registry/.
let wurzel: string;
let tick = 0;
const jetzt = (): string => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}Z`;
const ctx = (art: Kontext['art'] = 'definition', schluessel = 'ema'): Kontext => ({ wurzel, art, schluessel, jetzt });

beforeEach(() => {
  wurzel = mkdtempSync(join(tmpdir(), 'vp-rev-'));
  tick = 0;
});
afterEach(() => rmSync(wurzel, { recursive: true, force: true }));

const fehlerCode = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe('Entwurf und Aktivierung (G83)', () => {
  it('upsert schreibt einen Entwurf, nie etwas Aktives', () => {
    const r = upsert(ctx(), { periode: 20 }, 'agent-a@x');
    expect(r.nr).toBe(1);
    expect(aktive(ctx())).toBeNull();
  });

  it('activate ist ein Zeigerwechsel und ueberschreibt nichts', () => {
    upsert(ctx(), { periode: 20 }, 'a@x');
    upsert(ctx(), { periode: 21 }, 'a@x');
    activate(ctx(), 1, vorschau(ctx(), 1).confirm, 'mensch');
    activate(ctx(), 2, vorschau(ctx(), 2).confirm, 'mensch');
    expect(aktive(ctx())?.inhalt).toEqual({ periode: 21 });
    expect(revisionen(ctx()).map((r) => r.inhalt)).toEqual([{ periode: 20 }, { periode: 21 }]);
  });

  it('abweichender confirm bricht laut ab und aendert nichts', () => {
    upsert(ctx(), { periode: 20 }, 'a@x');
    const vorher = readFileSync(join(wurzel, 'definition', 'ema.json'), 'utf8');
    expect(fehlerCode(() => activate(ctx(), 1, 'falsch', 'mensch'))).toBe('VP-REG-0010');
    expect(readFileSync(join(wurzel, 'definition', 'ema.json'), 'utf8')).toBe(vorher);
    expect(aktive(ctx())).toBeNull();
  });

  it('ein Entwurf nach der Vorschau macht deren confirm ungueltig', () => {
    upsert(ctx(), { periode: 20 }, 'a@x');
    const v = vorschau(ctx(), 1);
    upsert(ctx(), { periode: 99 }, 'b@x');
    expect(fehlerCode(() => activate(ctx(), 1, v.confirm, 'mensch'))).toBe('VP-REG-0010');
  });

  it('Fremdschreiber zwischen Lesen und Schreiben: schreib() bricht ab', () => {
    upsert(ctx(), { periode: 20 }, 'a@x');
    const pfad = join(wurzel, 'definition', 'ema.json');
    const c = vorschau(ctx(), 1).confirm;
    // Jemand veraendert die Datei, ohne den Abdruck zu kennen: schon beim Laden passt der Hash
    // nicht mehr zum Abdruck neben der Datei (C33) — laut, bevor etwas aktiviert wird.
    writeFileSync(pfad, readFileSync(pfad, 'utf8').replace('20', '22'), 'utf8');
    expect(fehlerCode(() => activate(ctx(), 1, c, 'mensch'))).toBe('VP-STORE-0002');
  });

  it('kein Rest von tmp-Dateien nach dem Schreiben', () => {
    upsert(ctx(), { periode: 20 }, 'a@x');
    expect(readdirSync(join(wurzel, 'definition')).filter((n) => !n.endsWith('.sha256'))).toEqual(['ema.json']);
  });

  it('unzulaessiger Schluessel wird abgewiesen', () => {
    expect(fehlerCode(() => upsert(ctx('definition', '../x'), {}, 'a@x'))).toBe('VP-REG-0013');
  });
});

describe('Rollback ist derselbe Vorgang rueckwaerts', () => {
  it('geht auf die zuvor aktive Revision, mit confirm und Journal', () => {
    upsert(ctx(), { v: 1 }, 'a@x');
    upsert(ctx(), { v: 2 }, 'a@x');
    activate(ctx(), 1, vorschau(ctx(), 1).confirm, 'mensch');
    activate(ctx(), 2, vorschau(ctx(), 2).confirm, 'mensch');

    expect(fehlerCode(() => rollback(ctx(), 'falsch', 'mensch'))).toBe('VP-REG-0010');
    rollback(ctx(), rollbackVorschau(ctx()).confirm, 'mensch');
    expect(aktive(ctx())?.inhalt).toEqual({ v: 1 });
    expect(journal(wurzel, 'definition', 'ema').map((j) => j.aktion)).toEqual([
      'entwurf', 'entwurf', 'aktivierung', 'aktivierung', 'rollback',
    ]);
  });

  it('ohne fruehere aktive Revision gibt es nichts zurueckzunehmen', () => {
    upsert(ctx(), { v: 1 }, 'a@x');
    activate(ctx(), 1, vorschau(ctx(), 1).confirm, 'mensch');
    expect(fehlerCode(() => rollbackVorschau(ctx()))).toBe('VP-REG-0013');
  });
});

describe('Journal mit Urheber (N145)', () => {
  it('jede Aenderung steht im Journal, jeder Eintrag mit Urheber', () => {
    upsert(ctx(), { v: 1 }, 'agent-a@x');
    activate(ctx(), 1, vorschau(ctx(), 1).confirm, 'mensch@x');
    const j = journal(wurzel, 'definition');
    expect(j).toHaveLength(2);
    expect(j.map((e) => e.urheber)).toEqual(['agent-a@x', 'mensch@x']);
    expect(j[1]).toMatchObject({ aktion: 'aktivierung', revision: 1, vorher: null });
  });

  it('ohne Urheber wird nichts geschrieben', () => {
    for (const u of ['', '   ']) expect(fehlerCode(() => upsert(ctx(), { v: 1 }, u))).toBe('VP-REG-0011');
    upsert(ctx(), { v: 1 }, 'a@x');
    const c = vorschau(ctx(), 1).confirm;
    expect(fehlerCode(() => activate(ctx(), 1, c, ''))).toBe('VP-REG-0011');
    expect(aktive(ctx())).toBeNull();
    expect(journal(wurzel, 'definition')).toHaveLength(1);
  });
});

describe('Flaeche bedient sich nicht selbst (N143)', () => {
  const flaeche = { id: 'ema-cross-v1', identitaet: 'ema-cross-v1@nw-predictor', stufe: 'lesend', scopeMuster: ['a:*'] };
  let k: Kontext;
  beforeEach(() => {
    k = ctx('flaeche', 'ema-cross-v1');
  });

  it('eigene Definition weder entwerfen noch aktivieren', () => {
    expect(fehlerCode(() => upsert(k, { ...flaeche, scopeMuster: ['*'] }, 'ema-cross-v1@nw-predictor'))).toBe('VP-REG-0012');

    upsert(k, flaeche, 'wurzel@nw-predictor');
    const c = vorschau(k, 1).confirm;
    expect(fehlerCode(() => activate(k, 1, c, 'ema-cross-v1@nw-predictor'))).toBe('VP-REG-0012');
    expect(aktive(k)).toBeNull();
  });

  it('eine andere Instanz darf es', () => {
    upsert(k, flaeche, 'wurzel@nw-predictor');
    activate(k, 1, vorschau(k, 1).confirm, 'mensch');
    expect(aktive(k)?.inhalt).toEqual(flaeche);
  });
});

describe('Fehlercodes', () => {
  it('stehen in der Code-Tabelle', () => {
    for (const c of ['VP-REG-0010', 'VP-REG-0011', 'VP-REG-0012', 'VP-REG-0013']) expect(CODES).toHaveProperty(c);
    expect(new RevisionsFehler('VP-REG-0010', 'x').code).toBe('VP-REG-0010');
  });
});
