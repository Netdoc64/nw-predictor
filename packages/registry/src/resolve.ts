import { hash, mitDefaults, nodeHash, scopeKey, type Scope, type Urn } from '@vp/core-ids';
import { holeDefinition, type Katalog } from './katalog.ts';
import { lookbackBars, ORDNUNG, type Definition, type Kind } from './typen.ts';

// ─────────────────────────────────────────────────────────────────────────────
// resolve() — die Verbindung zwischen vertikaler und horizontaler Achse.
//
// REIN und ohne I/O. Deshalb kann MCP sie als Trockenlauf anbieten, ohne dass
// irgendetwas startet (PLAN.md §3.2), und deshalb braucht ihr Test keine Datei.
// ─────────────────────────────────────────────────────────────────────────────

export class ResolveFehler extends Error {
  readonly code:
      | 'VP-REG-0001'
      | 'VP-REG-0002'
      | 'VP-REG-0003'
      | 'VP-REG-0004'
      | 'VP-REG-0005';

  constructor(code:
      | 'VP-REG-0001'
      | 'VP-REG-0002'
      | 'VP-REG-0003'
      | 'VP-REG-0004'
      | 'VP-REG-0005', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'ResolveFehler';
  }
}

export interface PlanKnoten {
  readonly id: string;
  readonly def: Urn;
  readonly kind: Kind;
  /** Vollstaendig — die Defaults der Definition sind hier bereits eingesetzt. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly eingaenge: Readonly<Record<string, string>>;
  readonly nodeHash: string;
  /** Bars, die dieser Knoten samt seiner Vorgeschichte braucht. */
  readonly warmup: number;
}

export interface Plan {
  readonly scopeKey: string;
  readonly profil: string;
  readonly knoten: readonly PlanKnoten[];
  /** Auswertungsreihenfolge. Gleichrangiges ist nach nodeHash sortiert (§12/D51). */
  readonly reihenfolge: readonly string[];
  readonly warmupBars: number;
  readonly planHash: string;
  readonly faehigkeiten: readonly string[];
}

export interface ResolveOptionen {
  /** Stand der Rohdaten — geht in jeden nodeHash (§2.3). */
  readonly datenRevision: string;
  /** Hashes von Gewichten/Tabellen je Knoten-Id, soweit vorhanden. */
  readonly artefakte?: Readonly<Record<string, string>>;
}

export function resolve(
  katalog: Katalog,
  profilId: string,
  s: Scope,
  opt: ResolveOptionen,
): Plan {
  const profil = katalog.profile.get(profilId);
  if (!profil) throw new ResolveFehler('VP-REG-0001', `Profil nicht gefunden: ${profilId}`);

  const specs = new Map(profil.knoten.map((k) => [k.id, k]));
  if (specs.size !== profil.knoten.length) {
    throw new ResolveFehler('VP-REG-0003', `Knoten-Id doppelt in Profil ${profilId}`);
  }

  // ── 1. Verdrahtung pruefen: Ziel vorhanden, Art erlaubt, Ordnung gewahrt ──
  const defs = new Map<string, Definition>();
  for (const spec of profil.knoten) {
    const def = holeDefinition(katalog, spec.def);
    defs.set(spec.id, def);
  }

  for (const spec of profil.knoten) {
    const def = defs.get(spec.id)!;
    const belegt = spec.eingaenge ?? {};

    for (const schacht of def.eingaenge) {
      const zielId = belegt[schacht.name];
      if (zielId === undefined) {
        if (schacht.optional) continue;
        throw new ResolveFehler(
          'VP-REG-0005',
          `${spec.id}: Eingang "${schacht.name}" ist unbelegt`,
        );
      }
      const zielDef = defs.get(zielId);
      if (!zielDef) {
        throw new ResolveFehler('VP-REG-0001', `${spec.id}.${schacht.name} zeigt auf unbekannten Knoten ${zielId}`);
      }
      if (!schacht.nimmt.includes(zielDef.kind)) {
        throw new ResolveFehler(
          'VP-REG-0003',
          `${spec.id}.${schacht.name} nimmt ${schacht.nimmt.join('|')}, bekommt ${zielDef.kind}`,
        );
      }
      // Die Art sagt, WAS da kommt, das Schema, in welcher FORM (§12/C30). Die
      // Definition kommt aus JSON — dass der Typ `schema` verlangt, beweist hier
      // nichts, also wird das Fehlen ausdruecklich abgelehnt.
      const liest: unknown = (schacht as { schema?: unknown }).schema;
      if (!Array.isArray(liest) || liest.length === 0) {
        throw new ResolveFehler(
          'VP-REG-0003',
          `${spec.id}.${schacht.name} deklariert kein Schema — ${def.urn} muss sagen, was der Eingang liest`,
        );
      }
      if (!liest.includes(zielDef.ausgabeSchema)) {
        throw new ResolveFehler(
          'VP-REG-0003',
          `${spec.id}.${schacht.name} liest ${liest.join('|')}, bekommt ${zielDef.ausgabeSchema} von ${zielId}`,
        );
      }
      // Die Regel, die Zyklen erschlaegt, bevor ein Algorithmus sie suchen muss.
      if (ORDNUNG[zielDef.kind] > ORDNUNG[def.kind]) {
        throw new ResolveFehler(
          'VP-REG-0004',
          `${spec.id} (${def.kind}, Ordnung ${ORDNUNG[def.kind]}) darf nicht auf ` +
            `${zielId} (${zielDef.kind}, Ordnung ${ORDNUNG[zielDef.kind]}) zeigen`,
        );
      }
    }

    for (const name of Object.keys(belegt)) {
      if (!def.eingaenge.some((e) => e.name === name)) {
        throw new ResolveFehler('VP-REG-0003', `${spec.id}: Eingang "${name}" gibt es an ${def.urn} nicht`);
      }
    }
  }

  // ── 2. Topologische Reihenfolge (Gegenprobe gegen Zyklen gleicher Ordnung) ──
  const reihenfolge = topo(profil.knoten.map((k) => k.id), (id) =>
    Object.values(specs.get(id)!.eingaenge ?? {}),
  );

  // ── 3. nodeHash und Warmup, in Auswertungsreihenfolge ──
  const knoten = new Map<string, PlanKnoten>();
  for (const id of reihenfolge) {
    const spec = specs.get(id)!;
    const def = defs.get(id)!;
    const eingaenge = spec.eingaenge ?? {};
    const params = mitDefaults(spec.params ?? {}, def.params as Record<string, unknown>);

    const eingangsHashes = Object.values(eingaenge).map((z) => knoten.get(z)!.nodeHash);
    const nh = nodeHash({
      def: def.urn,
      params,
      eingaenge: eingangsHashes,
      datenRevision: opt.datenRevision,
      artefaktHash: opt.artefakte?.[id],
    });

    const eigen = lookbackBars(def.lookback, params);
    const vor = Object.values(eingaenge).map((z) => knoten.get(z)!.warmup);
    const warmup = eigen + (vor.length > 0 ? Math.max(...vor) : 0);

    knoten.set(id, { id, def: def.urn, kind: def.kind, params, eingaenge, nodeHash: nh, warmup });
  }

  const liste = reihenfolge.map((id) => knoten.get(id)!);
  const faehigkeiten = [
    ...new Set(liste.flatMap((k) => defs.get(k.id)!.faehigkeiten ?? [])),
  ].sort();

  return {
    scopeKey: scopeKey(s),
    profil: profilId,
    knoten: liste,
    reihenfolge,
    warmupBars: liste.reduce((m, k) => Math.max(m, k.warmup), 0),
    planHash: hash(...liste.map((k) => k.nodeHash)),
    faehigkeiten,
  };
}

/**
 * Topologische Sortierung, deterministisch.
 *
 * Knoten, die gleichzeitig laufen koennten, werden nach Id sortiert — nicht
 * nach Einfuegereihenfolge. Sonst haengt das Ergebnis daran, in welcher
 * Reihenfolge jemand die Zeilen ins Profil geschrieben hat (§12/D51).
 */
function topo(ids: readonly string[], vorgaengerVon: (id: string) => readonly string[]): string[] {
  const offen = [...ids].sort();
  const fertig: string[] = [];
  const zustand = new Map<string, 'laeuft' | 'fertig'>();

  const besuche = (id: string, pfad: readonly string[]): void => {
    const z = zustand.get(id);
    if (z === 'fertig') return;
    if (z === 'laeuft') {
      throw new ResolveFehler('VP-REG-0002', `Zyklus: ${[...pfad, id].join(' → ')}`);
    }
    zustand.set(id, 'laeuft');
    for (const v of [...vorgaengerVon(id)].sort()) besuche(v, [...pfad, id]);
    zustand.set(id, 'fertig');
    fertig.push(id);
  };

  for (const id of offen) besuche(id, []);
  return fertig;
}
