import { hash, type TimeMs } from '@vp/core-ids';

// ─────────────────────────────────────────────────────────────────────────────
// Das Rechenband — PLAN.md §4.8.
//
// Eine Gewinnzahl, die man nicht zurueckverfolgen kann, ist eine Behauptung.
// Das Band haelt fest, aus welchen Werten ein Wert entstanden ist.
//
// Die Stufe `entscheidungen` ist der Normalfall und der Grund, warum das Band
// tragbar bleibt: waehrend eines Laufs stehen nur die letzten Bars im Speicher,
// und aufbewahrt wird NUR, was rueckwaerts von einer Entscheidung aus
// erreichbar ist. Alles andere faellt aus dem Fenster und ist weg.
// ─────────────────────────────────────────────────────────────────────────────

export type TraceStufe = 'off' | 'entscheidungen' | 'voll';

export interface Kettenglied {
  readonly wertId: string;
  /** Knoten-Id im Plan — zusammen mit dem planHash eindeutig. */
  readonly knoten: string;
  readonly nodeHash: string;
  readonly t: TimeMs;
  readonly eingaenge: readonly string[];
  /** Darstellung des Wertes. Zeichenkette, damit das Band serialisierbar bleibt. */
  readonly wert: string;
}

export function wertId(nodeHash: string, t: TimeMs): string {
  return hash(nodeHash, String(t)).slice(0, 24);
}

export class Rechenband {
  readonly stufe: TraceStufe;
  readonly #fensterBars: number;

  /** t → (wertId → Glied). Ein Eintrag je Bar, damit das Fenster billig raeumt. */
  #fenster = new Map<TimeMs, Map<string, Kettenglied>>();
  #alle: Kettenglied[] = [];

  constructor(stufe: TraceStufe = 'entscheidungen', fensterBars = 512) {
    this.stufe = stufe;
    this.#fensterBars = fensterBars;
  }

  notiere(g: Kettenglied): void {
    if (this.stufe === 'off') return;
    if (this.stufe === 'voll') this.#alle.push(g);

    let bar = this.#fenster.get(g.t);
    if (!bar) {
      bar = new Map();
      this.#fenster.set(g.t, bar);
      // Aelteste Bar wegwerfen — `Map` haelt die Einfuegereihenfolge, und die
      // Bars kommen aufsteigend. Kein Sortieren noetig.
      while (this.#fenster.size > this.#fensterBars) {
        const aeltest = this.#fenster.keys().next();
        if (aeltest.done) break;
        this.#fenster.delete(aeltest.value);
      }
    }
    bar.set(g.wertId, g);
  }

  #finde(id: string): Kettenglied | undefined {
    for (const bar of this.#fenster.values()) {
      const g = bar.get(id);
      if (g) return g;
    }
    return undefined;
  }

  /**
   * Die Kette rueckwaerts ab den genannten Wurzeln.
   *
   * Breitensuche mit Besuchsmarke: ein Wert, der in zwei Zweige eingeht,
   * erscheint einmal. Tiefenbegrenzung, damit ein unerwarteter Zyklus die
   * Aufzeichnung nicht zum Absturz bringt statt zum Befund.
   */
  kette(wurzeln: readonly string[], maxTiefe = 64): readonly Kettenglied[] {
    if (this.stufe === 'off') return [];
    const gesehen = new Set<string>();
    const raus: Kettenglied[] = [];
    let schicht = [...wurzeln];

    for (let tiefe = 0; tiefe < maxTiefe && schicht.length > 0; tiefe += 1) {
      const naechste: string[] = [];
      for (const id of schicht) {
        if (gesehen.has(id)) continue;
        gesehen.add(id);
        const g = this.#finde(id);
        if (!g) continue;
        raus.push(g);
        naechste.push(...g.eingaenge);
      }
      schicht = naechste;
    }
    // Aelteste zuerst: so liest sich die Kette von der Rohbar zur Entscheidung.
    return raus.sort((a, b) => a.t - b.t || (a.wertId < b.wertId ? -1 : 1));
  }

  /** Nur bei `voll` gefuellt — fuer die Fehlersuche an einem kurzen Ausschnitt. */
  allesNotierte(): readonly Kettenglied[] {
    return this.#alle;
  }
}
