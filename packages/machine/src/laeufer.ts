import type { Bar, Uhr } from '@vp/core-ids';
import { werk, type KnotenLaufzeit, type SchrittKontext, type Umgebung } from '@vp/compute';
import type { Plan } from '@vp/registry';
import { Rechenband, wertId } from '@vp/trace';

// ─────────────────────────────────────────────────────────────────────────────
// Der Laeufer — eine Bar durch den ganzen Plan.
//
// Hier steckt der Grund, warum „Replay ≡ Live" ueberhaupt erreichbar ist: es
// gibt EINE Methode, `schritt(bar)`. Ob die Bars aus einer Datei am Stueck
// kommen oder einzeln aus dem Netz, aendert an dieser Methode nichts — und
// damit auch nichts am Ergebnis.
//
// Die Aufzeichnung passiert ebenfalls hier und nur hier (PLAN.md §4.8): jeder
// Knotenwert bekommt seine Wert-Id und seine Eingangskanten. Ein Knoten, der
// selbst aufzeichnet, vergisst es irgendwann.
// ─────────────────────────────────────────────────────────────────────────────

export interface LaeuferOptionen {
  readonly plan: Plan;
  readonly umgebung: Umgebung;
  readonly band: Rechenband;
  readonly uhr: Uhr;
}

export class Laeufer {
  readonly plan: Plan;
  readonly #laufzeiten = new Map<string, KnotenLaufzeit>();
  readonly #band: Rechenband;
  readonly #uhr: Uhr;
  #index = -1;

  constructor(opt: LaeuferOptionen) {
    this.plan = opt.plan;
    this.#band = opt.band;
    this.#uhr = opt.uhr;
    for (const k of opt.plan.knoten) {
      this.#laufzeiten.set(k.id, werk(k.def)(k.params, opt.umgebung));
    }
  }

  get index(): number {
    return this.#index;
  }

  /** Eine Bar durch alle Knoten, in Plan-Reihenfolge. */
  schritt(bar: Bar): ReadonlyMap<string, unknown> {
    this.#index += 1;
    const werte = new Map<string, unknown>();
    const ids = new Map<string, string>();

    for (const id of this.plan.reihenfolge) {
      const k = this.plan.knoten.find((x) => x.id === id)!;
      const eigeneId = wertId(k.nodeHash, bar.t);
      ids.set(id, eigeneId);

      const ctx: SchrittKontext = {
        bar,
        index: this.#index,
        uhr: this.#uhr,
        knotenId: id,
        nodeHash: k.nodeHash,
        eingang: (schacht) => {
          const ziel = k.eingaenge[schacht];
          // Ein unbelegter optionaler Schacht ist `null`, kein Fehler: der
          // Knoten hat selbst entschieden, dass er ohne auskommt.
          return ziel === undefined ? null : werte.get(ziel);
        },
        wertIdVon: (schacht) => {
          const ziel = k.eingaenge[schacht];
          return ziel === undefined ? '' : (ids.get(ziel) ?? '');
        },
      };

      const wert = this.#laufzeiten.get(id)!.schritt(ctx);
      werte.set(id, wert);

      this.#band.notiere({
        wertId: eigeneId,
        knoten: id,
        nodeHash: k.nodeHash,
        t: bar.t,
        eingaenge: Object.values(k.eingaenge)
          .map((z) => ids.get(z))
          .filter((x): x is string => x !== undefined),
        wert: darstellung(wert),
      });
    }
    return werte;
  }
}

/**
 * Darstellung eines Wertes fuers Band.
 *
 * Zeichenkette, damit das Band serialisierbar bleibt — `bigint` ueberlebt
 * `JSON.stringify` nicht (PLAN.md §12/J108). Und gekuerzt, weil ein Band, das
 * ganze Objekte spiegelt, groesser wird als die Kursdaten.
 */
function darstellung(w: unknown): string {
  if (w === null || w === undefined) return 'null';
  if (typeof w === 'bigint') return w.toString();
  if (typeof w === 'object') {
    const kurz = JSON.stringify(w, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    return kurz.length > 400 ? `${kurz.slice(0, 400)}…` : kurz;
  }
  return String(w);
}
