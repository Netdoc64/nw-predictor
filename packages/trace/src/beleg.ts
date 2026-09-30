import { hash, type Fix, type TimeMs } from '@vp/core-ids';
import type { Kettenglied } from './band.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Der Beleg — PLAN.md §4.8.
//
// Die Form, in der ein Lauf vermerkt wird und in der er auch in einem halben
// Jahr noch erklaerbar ist. Zwei Eigenschaften machen ihn belastbar:
//
//   nachrechenbar  aus Beleg + Registry + Rohdaten ergibt sich derselbe Wert
//   unveraenderlich  eine spaetere Bar-Korrektur aendert ihn NICHT, sie
//                    haengt einen Vermerk an
//
// Wer die Vergangenheit umschreibt, verliert genau die Spur, wegen der er sie
// aufgezeichnet hat.
// ─────────────────────────────────────────────────────────────────────────────

export interface BelegPosition {
  readonly menge: Fix;
  readonly einstand: Fix;
}

export interface BelegFill {
  readonly seite: 'kauf' | 'verkauf';
  readonly menge: Fix;
  readonly preis: Fix;
  readonly gebuehr: Fix;
  readonly notional: Fix;
  readonly modell: string;
}

export interface Vermerk {
  readonly art: 'daten-korrigiert' | 'liquidiert' | 'abgelehnt';
  readonly text: string;
  readonly vonRevision?: string;
  readonly aufRevision?: string;
}

export interface Beleg {
  readonly belegId: string;
  readonly szenarioHash: string;
  readonly planHash: string;
  readonly t: TimeMs;
  readonly scope: string;
  readonly richtung: 'lang' | 'flach';
  readonly grund: readonly string[];
  readonly kette: readonly Kettenglied[];
  readonly fill: BelegFill | null;
  readonly positionVorher: BelegPosition;
  readonly positionNachher: BelegPosition;
  readonly datenstand: string;
  /** Beleg, der diese Position geschlossen hat — wird nachgetragen. */
  abschlussVon?: string;
  /** Beim schliessenden Beleg: der realisierte Betrag. */
  realisiert?: Fix;
  vermerke?: Vermerk[];
}

export function belegId(szenarioHash: string, scope: string, t: TimeMs, lfd: number): string {
  return hash(szenarioHash, scope, String(t), String(lfd)).slice(0, 20);
}

/**
 * Belege als Zeilen — `bigint` ueberlebt `JSON.stringify` nicht (§12/J108).
 * Deshalb eine eigene Umformung statt eines Ersetzers, den jemand vergisst.
 */
export function belegAlsZeile(b: Beleg): string {
  return JSON.stringify(b, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

export class Belegbuch {
  #belege: Beleg[] = [];
  #offeneKette: string[] = [];

  fuegeHinzu(b: Beleg): void {
    this.#belege.push(b);
    if (b.richtung === 'lang') {
      this.#offeneKette.push(b.belegId);
    } else if (b.richtung === 'flach') {
      // Ein schliessender Beleg verweist auf ALLE Eroeffnungen, die er beendet.
      // Ohne diese Verweise ist „was hat dieser Trade gebracht" eine Suche.
      for (const id of this.#offeneKette) {
        const auf = this.#belege.find((x) => x.belegId === id);
        if (auf) auf.abschlussVon = b.belegId;
      }
      this.#offeneKette = [];
    }
  }

  vermerke(belegId: string, v: Vermerk): void {
    const b = this.#belege.find((x) => x.belegId === belegId);
    if (!b) return;
    (b.vermerke ??= []).push(v);
  }

  alle(): readonly Beleg[] {
    return this.#belege;
  }

  anzahl(): number {
    return this.#belege.length;
  }
}
