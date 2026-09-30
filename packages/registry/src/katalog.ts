import { basename } from 'node:path';
import type { Urn } from '@vp/core-ids';
import { jsonDateien, lies } from './speicher.ts';
import { istKind, type Definition, type McpFlaeche, type Profil, type Strategie } from './typen.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Der Katalog: alles, was in `registry/` liegt, im Speicher.
//
// Er ist absichtlich dumm — laden, pruefen, nachschlagen. Alles Entscheidende
// passiert in `resolve()`, und das ist eine reine Funktion ueber genau diesen
// Katalog. Damit ist der Aufloeser testbar, ohne dass eine Datei existiert.
// ─────────────────────────────────────────────────────────────────────────────

export class KatalogFehler extends Error {
  readonly code: 'VP-REG-0001' | 'VP-REG-0006';

  constructor(code: 'VP-REG-0001' | 'VP-REG-0006', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'KatalogFehler';
  }
}

export interface Katalog {
  readonly definitionen: ReadonlyMap<Urn, Definition>;
  readonly profile: ReadonlyMap<string, Profil>;
  readonly strategien: ReadonlyMap<string, Strategie>;
  readonly flaechen: ReadonlyMap<string, McpFlaeche>;
}

export function katalogAus(
  definitionen: readonly Definition[],
  profile: readonly Profil[] = [],
  strategien: readonly Strategie[] = [],
  flaechen: readonly McpFlaeche[] = [],
): Katalog {
  const d = new Map<Urn, Definition>();
  for (const def of definitionen) {
    if (d.has(def.urn)) throw new KatalogFehler('VP-REG-0006', `Definition doppelt: ${def.urn}`);
    if (!istKind(def.kind)) throw new KatalogFehler('VP-REG-0006', `unbekannte Art: ${def.kind}`);
    d.set(def.urn, def);
  }
  return {
    definitionen: d,
    profile: new Map(profile.map((p) => [p.id, p])),
    strategien: new Map(strategien.map((s) => [s.id, s])),
    flaechen: new Map(flaechen.map((f) => [f.id, f])),
  };
}

/**
 * Katalog von der Platte.
 *
 * Die Ordnerordnung bestimmt nichts — die Art steht IN der Datei. Ein Ordner,
 * der etwas anderes behauptet als sein Inhalt, waere eine zweite Wahrheit.
 */
export function ladeKatalog(wurzel: string): Katalog {
  const defs: Definition[] = [];
  const profile: Profil[] = [];
  const strategien: Strategie[] = [];
  const flaechen: McpFlaeche[] = [];

  for (const pfad of jsonDateien(wurzel)) {
    const { wert } = lies<unknown>(pfad);
    // Eine Datei darf einen Eintrag oder eine Liste enthalten. Die Art steht IN
    // dem Eintrag, nicht im Dateinamen — ein Ordner, der etwas anderes
    // behauptet als sein Inhalt, waere eine zweite Wahrheit.
    const eintraege = Array.isArray(wert) ? wert : [wert];
    for (const e of eintraege) {
      if (typeof e !== 'object' || e === null) {
        throw new KatalogFehler('VP-REG-0006', `${basename(pfad)}: kein Objekt`);
      }
      if ('urn' in e && 'kind' in e) defs.push(e as unknown as Definition);
      else if ('knoten' in e) profile.push(e as unknown as Profil);
      else if ('risiko' in e) strategien.push(e as unknown as Strategie);
      else if ('werkzeugMuster' in e && 'stufe' in e) flaechen.push(e as unknown as McpFlaeche);
      else {
        throw new KatalogFehler('VP-REG-0006', `${basename(pfad)}: weder Definition, Profil, Strategie noch Flaeche`);
      }
    }
  }
  return katalogAus(defs, profile, strategien, flaechen);
}

export function holeDefinition(k: Katalog, u: Urn): Definition {
  const d = k.definitionen.get(u);
  if (!d) throw new KatalogFehler('VP-REG-0001', `Definition nicht gefunden: ${u}`);
  return d;
}
