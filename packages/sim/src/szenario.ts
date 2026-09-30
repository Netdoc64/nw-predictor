import { hash, kanon, type Fix, type TimeMs } from '@vp/core-ids';
import type { Strategie } from '@vp/registry';
import type { KostenModell } from '@vp/trading';
import type { TraceStufe } from '@vp/trace';

// ─────────────────────────────────────────────────────────────────────────────
// Szenario — PLAN.md §4.6.
//
// Zwei Hashes statt einem, und darin liegt der ganze Sinn:
//
//   datenHash      der PRUEFSTAND — Zeitraum, Konto, Kosten, Marktmodell, Saat,
//                  Datenstand. Muss fuer einen Vergleich gleich sein.
//   strategieHash  der PRUEFLING.
//
// Zwei Ergebnisse mit verschiedenem Kostenmodell nebeneinanderzustellen ist kein
// Vergleich, sondern eine Verwechslung — und `vergleiche()` verweigert ihn.
// ─────────────────────────────────────────────────────────────────────────────

export interface KontoSpec {
  readonly startkapital: Fix;
  readonly waehrung: string;
  /**
   * Waehrungsumrechnung.
   *
   * `keine` heisst: Kontowaehrung ist die Notierungswaehrung des Instruments.
   * Der erste Lauf rechnet so — in USDT — und sagt es an jeder Kennzahl.
   * PLAN.md/W6 will EUR; das braucht eine FX-Reihe als eigenen Knoten, und die
   * gibt es erst, wenn die Daten dafuer da sind. Ein fest verdrahteter Kurs
   * waere die schlechtere Antwort.
   */
  readonly fx: { readonly art: 'keine' } | { readonly art: 'serie'; readonly knoten: string };
}

export interface MarktModell {
  readonly id: string;
  /** Wo gefuellt wird. Mehr Formen erst, wenn die Ordertiefe da ist (PLAN.md/W7). */
  readonly fill: 'naechste-oeffnung';
}

export interface Szenario {
  readonly id: string;
  // ── Pruefstand ──
  readonly scopes: readonly string[];
  readonly zeitraum: { readonly von: TimeMs; readonly bis: TimeMs };
  readonly warmupVor: TimeMs;
  readonly konto: KontoSpec;
  readonly kosten: KostenModell;
  readonly markt: MarktModell;
  readonly seed: number;
  readonly datenRevision: string;
  // ── Pruefling ──
  readonly strategie: string;
  // ── nur Aufzeichnung ──
  readonly trace: TraceStufe;
}

export class SzenarioFehler extends Error {
  readonly code: 'VP-MCP-0003' | 'VP-REG-0001';

  constructor(code: 'VP-MCP-0003' | 'VP-REG-0001', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'SzenarioFehler';
  }
}

/** Der Pruefstand. `trace` steht bewusst NICHT darin: eine Aufzeichnung, die das Ergebnis aendert, waere keine. */
export function datenHash(s: Szenario): string {
  return hash(
    kanon({
      scopes: [...s.scopes].sort(),
      zeitraum: s.zeitraum,
      warmupVor: s.warmupVor,
      konto: { startkapital: s.konto.startkapital.toString(), waehrung: s.konto.waehrung, fx: s.konto.fx },
      kosten: s.kosten,
      markt: s.markt,
      seed: s.seed,
      datenRevision: s.datenRevision,
    }),
  );
}

export function strategieHash(st: Strategie): string {
  return hash(kanon(st));
}

export function szenarioHash(s: Szenario, st: Strategie): string {
  return hash(datenHash(s), strategieHash(st));
}

/**
 * Was vor dem Lauf feststehen muss.
 *
 * `warmupVor` VOR `von` ist keine Formalie: liegt der Warmup im
 * Bewertungszeitraum, beruhen die ersten Entscheidungen auf halb gefuellten
 * Indikatoren, und das sieht man dem Ergebnis nicht an (PLAN.md §12/L132).
 */
export function pruefeSzenario(s: Szenario): void {
  if (s.warmupVor >= s.zeitraum.von) {
    throw new SzenarioFehler(
      'VP-MCP-0003',
      `warmupVor (${s.warmupVor}) muss vor zeitraum.von (${s.zeitraum.von}) liegen`,
    );
  }
  if (s.zeitraum.bis <= s.zeitraum.von) {
    throw new SzenarioFehler('VP-MCP-0003', 'zeitraum.bis liegt nicht nach zeitraum.von');
  }
  if (s.konto.startkapital <= 0n) {
    throw new SzenarioFehler('VP-MCP-0003', 'Startkapital muss positiv sein');
  }
}
