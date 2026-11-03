import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
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

/** Der Abdruck liegt neben der Datei: `<pfad>.sha256`. Er endet nicht auf `.json`, taucht also in `jsonDateien` nicht auf. */
const abdruckPfad = (pfad: string): string => `${pfad}.sha256`;
const sperrPfad = (pfad: string): string => `${pfad}.lock`;

/**
 * Liegengebliebene `.tmp-*`-Dateien eines Pfads (Rest eines abgebrochenen
 * Schreibens). `lies()` ignoriert sie; wer sie melden will, fragt hier.
 */
export function restTmp(pfad: string): string[] {
  const dir = dirname(pfad);
  if (!existsSync(dir)) return [];
  const vorsatz = `${basename(pfad)}.tmp-`;
  return readdirSync(dir)
    .filter((n) => n.startsWith(vorsatz))
    .sort()
    .map((n) => join(dir, n));
}

export function lies<T>(pfad: string): Gelesen<T> {
  let roh: string;
  try {
    roh = readFileSync(pfad, 'utf8');
  } catch (e) {
    throw new SpeicherFehler('VP-REG-0006', `${pfad} nicht lesbar: ${(e as Error).message}`);
  }
  const abdruck = hash(roh);
  // Ein Abdruck neben der Datei, der nicht passt: halb geschrieben oder von Hand
  // veraendert — lauter Fehler statt Start mit Unsinn. Ohne Abdruck (aeltere
  // Datei) gilt der Inhalt selbst.
  const datei = abdruckPfad(pfad);
  if (existsSync(datei)) {
    const erwartet = readFileSync(datei, 'utf8').trim();
    if (erwartet !== abdruck) {
      throw new SpeicherFehler('VP-STORE-0002', `${pfad}: Inhalt passt nicht zum Abdruck (${datei})`);
    }
  }
  try {
    return { wert: JSON.parse(roh) as T, abdruck };
  } catch (e) {
    throw new SpeicherFehler('VP-REG-0006', `${pfad} ist kein gueltiges JSON: ${(e as Error).message}`);
  }
}

/** Lebt der Prozess? (`kill(pid, 0)` sendet nichts, es prueft nur.) */
function lebt(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Exklusive Sperrdatei (`wx`): genau ein Schreiber zwischen Pruefung und rename. */
function sperre(pfad: string): () => void {
  const lock = sperrPfad(pfad);
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const fd = openSync(lock, 'wx');
      writeFileSync(fd, String(process.pid), 'utf8');
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lock);
        } catch {
          /* schon weg */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new SpeicherFehler('VP-STORE-0001', `${pfad}: Sperre nicht anlegbar: ${(e as Error).message}`);
      }
      // Eine Sperre eines toten Prozesses blockiert nicht fuer immer.
      let pid = NaN;
      try {
        pid = Number(readFileSync(lock, 'utf8'));
      } catch {
        /* gerade freigegeben */
      }
      // Unleserlich/leer heisst: der Halter schreibt gerade seine Kennung — also belegt.
      if (!Number.isInteger(pid) || (pid > 0 && lebt(pid))) throw new FremdschreiberFehler(pfad);
      try {
        unlinkSync(lock);
      } catch {
        /* ein anderer raeumt gleichzeitig */
      }
    }
  }
  throw new FremdschreiberFehler(pfad);
}

/**
 * Atomar schreiben: erst daneben, dann umbenennen — unter exklusiver Sperre.
 *
 * Ein abgebrochenes `writeFileSync` hinterlaesst eine halbe Datei — und die
 * faellt erst beim naechsten Start auf, wenn niemand mehr weiss, was drinstand.
 * Pruefung und `rename` sind nicht ein Schritt; die Sperrdatei (`wx`) schliesst
 * das Fenster dazwischen. Haelt jemand sie, ist das ein Fremdschreiber.
 *
 * `erwarteterAbdruck` ist der aus `lies()`. `null` heisst „die Datei gab es
 * noch nicht"; existiert sie dann doch, war jemand schneller.
 */
export function schreib(pfad: string, wert: unknown, erwarteterAbdruck: string | null): string {
  mkdirSync(dirname(pfad), { recursive: true });
  const frei = sperre(pfad);
  try {
    if (existsSync(pfad)) {
      const jetzt = hash(readFileSync(pfad, 'utf8'));
      if (erwarteterAbdruck === null || jetzt !== erwarteterAbdruck) {
        throw new FremdschreiberFehler(pfad);
      }
    } else if (erwarteterAbdruck !== null) {
      throw new FremdschreiberFehler(pfad);
    }

    const inhalt = `${JSON.stringify(wert, null, 2)}
`;
    const neuerAbdruck = hash(inhalt);
    const tmp = `${pfad}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, inhalt, 'utf8');
      renameSync(tmp, pfad);
      writeFileSync(abdruckPfad(pfad), `${neuerAbdruck}
`, 'utf8');
    } catch (e) {
      throw new SpeicherFehler('VP-STORE-0001', `${pfad}: ${(e as Error).message}`);
    }
    return neuerAbdruck;
  } finally {
    frei();
  }
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
