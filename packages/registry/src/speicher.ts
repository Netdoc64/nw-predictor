import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hash } from '@vp/core-ids';

// ─────────────────────────────────────────────────────────────────────────────
// Registry-Speicher — PLAN.md §3.3.
//
// Zwei Sitzungen im selben Arbeitsbaum sind hier der Normalfall, und der
// Schaden ist STILL: wer zuletzt schreibt, gewinnt, der Fortschritt des anderen
// ist weg. Deshalb dasselbe Verfahren, das sich fuer die Verlaufsdatei der
// Themen-Schleife bewaehrt hat —
// beim Laden den Inhalt hashen, vor dem Schreiben erneut hashen, bei Abweichung
// LAUT abbrechen und nichts ueberschreiben.
//
// Gehasht wird der INHALT, nicht mtime oder Groesse: zwei Schreibvorgaenge in
// derselben Millisekunde mit gleicher Laenge waeren daran nicht zu
// unterscheiden.
// ─────────────────────────────────────────────────────────────────────────────

export class FremdschreiberFehler extends Error {
  readonly code = 'VP-REG-0008' as const;
  readonly pfad: string;

  constructor(pfad: string) {
    super(`Fremdschreiber an ${pfad} — nichts geschrieben`);
    this.pfad = pfad;
    this.name = 'FremdschreiberFehler';
  }
}

export class SpeicherFehler extends Error {
  readonly code: 'VP-REG-0006' | 'VP-STORE-0001' | 'VP-STORE-0002';

  constructor(code: 'VP-REG-0006' | 'VP-STORE-0001' | 'VP-STORE-0002', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'SpeicherFehler';
  }
}

export interface Gelesen<T> {
  readonly wert: T;
  /** Der Inhaltsabdruck beim Lesen. Ohne ihn darf nicht geschrieben werden. */
  readonly abdruck: string;
}

export function lies<T>(pfad: string): Gelesen<T> {
  let roh: string;
  try {
    roh = readFileSync(pfad, 'utf8');
  } catch (e) {
    throw new SpeicherFehler('VP-REG-0006', `${pfad} nicht lesbar: ${(e as Error).message}`);
  }
  try {
    return { wert: JSON.parse(roh) as T, abdruck: hash(roh) };
  } catch (e) {
    throw new SpeicherFehler('VP-REG-0006', `${pfad} ist kein gueltiges JSON: ${(e as Error).message}`);
  }
}

/**
 * Atomar schreiben: erst daneben, dann umbenennen.
 *
 * Ein abgebrochenes `writeFileSync` hinterlaesst eine halbe Datei — und die
 * faellt erst beim naechsten Start auf, wenn niemand mehr weiss, was drinstand.
 *
 * `erwarteterAbdruck` ist der aus `lies()`. `null` heisst „die Datei gab es
 * noch nicht"; existiert sie dann doch, war jemand schneller.
 */
export function schreib(pfad: string, wert: unknown, erwarteterAbdruck: string | null): string {
  mkdirSync(dirname(pfad), { recursive: true });

  if (existsSync(pfad)) {
    const jetzt = hash(readFileSync(pfad, 'utf8'));
    if (erwarteterAbdruck === null || jetzt !== erwarteterAbdruck) {
      throw new FremdschreiberFehler(pfad);
    }
  } else if (erwarteterAbdruck !== null) {
    throw new FremdschreiberFehler(pfad);
  }

  const inhalt = `${JSON.stringify(wert, null, 2)}\n`;
  const tmp = `${pfad}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, inhalt, 'utf8');
    renameSync(tmp, pfad);
  } catch (e) {
    throw new SpeicherFehler('VP-STORE-0001', `${pfad}: ${(e as Error).message}`);
  }
  return hash(inhalt);
}

/** Alle `.json` unterhalb eines Verzeichnisses, rekursiv, in stabiler Reihenfolge. */
export function jsonDateien(wurzel: string): string[] {
  if (!existsSync(wurzel)) return [];
  const raus: string[] = [];
  const gehe = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const p = join(dir, e.name);
      if (e.isDirectory()) gehe(p);
      else if (e.name.endsWith('.json')) raus.push(p);
    }
  };
  gehe(wurzel);
  return raus;
}
