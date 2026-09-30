import { instanzUrn, iso, type Bar, type Fix } from '@vp/core-ids';
import { holeDefinition, type Katalog, type Plan, type PlanKnoten } from '@vp/registry';
import {
  stilAusHash,
  type ChartOp, type ChartPaket, type LayerSpec, type Marker, type Punkt,
} from '@vp/chart-adapter';

// ─────────────────────────────────────────────────────────────────────────────
// Die Chart-Bindung — Registry-basierte Chartverknuepfung, PLAN.md §5.6.
//
// Hier wird aus einem Plan ein Chart, ohne dass irgendwo „EMA" oder „ATR"
// steht. Die Definition sagt per `darstellung`, wie ihr Ausgang aussieht; die
// Bindung liest das und erzeugt LayerSpecs und ChartOps. Ein neuer Indikator in
// der Registry erscheint damit im Chart, ohne eine Zeile hier zu aendern.
//
// Das Paket kennt Registry und Chart-Vertrag — und sonst nichts. Die Maschine
// weiss nichts vom Chart; sie liefert je Bar eine Wertetabelle, und die kommt
// hier herein (PLAN.md §9.2).
// ─────────────────────────────────────────────────────────────────────────────

interface Fillartig {
  readonly t: number;
  readonly seite: 'kauf' | 'verkauf';
  readonly menge: Fix;
  readonly preis: Fix;
}

interface Bindungslayer {
  readonly spec: LayerSpec;
  readonly knoten: PlanKnoten;
  readonly feld: string | undefined;
  punkte: Punkt[];
  marker: Marker[];
  rev: number;
  /** Punkte, die im laufenden Schritt dazukamen — gehen gebuendelt als ein `append`. */
  offen: Punkt[];
  markerGeaendert: boolean;
}

const ART_RANG: Record<string, number> = { candles: 0, line: 1, area: 1, histogram: 1, markers: 2 };

function titel(k: PlanKnoten): string {
  const periode = k.params['periode'];
  return typeof periode === 'number' ? `${k.id} (${periode})` : k.id;
}

export class ChartBindung {
  readonly layer: readonly LayerSpec[];
  readonly #plan: Plan;
  readonly #layer: Bindungslayer[];

  constructor(plan: Plan, katalog: Katalog) {
    this.#plan = plan;
    const liste: Bindungslayer[] = [];

    for (const k of plan.knoten) {
      const d = holeDefinition(katalog, k.def).darstellung;
      if (!d) continue;
      const spec: LayerSpec = {
        id: instanzUrn(k.def, plan.scopeKey, k.nodeHash),
        titel: titel(k),
        art: d.art,
        pane: d.pane === 'preis' ? 'price' : `sub:${k.id}`,
        skala: { id: d.pane === 'preis' ? 'right' : k.id, modus: 'normal', autoFit: true },
        quelle: { knoten: k.id, nodeHash: k.nodeHash },
        // Farbe aus dem nodeHash — dieselbe EMA hat nach einem Neustart
        // dieselbe Farbe, in beiden Treibern (§12/E63).
        stil: stilAusHash(k.nodeHash),
        format: { praezision: d.praezision ?? 2 },
        ordnung: 0,
        sichtbar: true,
        vereinfachbar: true,
      };
      liste.push({ spec, knoten: k, feld: d.feld, punkte: [], marker: [], rev: -1, offen: [], markerGeaendert: false });
    }

    // Reihenfolge ist Vertrag, nicht Zufall: Kerzen zuerst (an ihnen haengen die
    // Marker), dann Linien, dann Marker; Preisfenster vor den Unterfenstern.
    // Innerhalb gleicher Stufe die Plan-Reihenfolge — die ist deterministisch.
    const reihe = new Map(plan.reihenfolge.map((id, i) => [id, i]));
    liste.sort(
      (a, b) =>
        Number(a.spec.pane !== 'price') - Number(b.spec.pane !== 'price') ||
        (ART_RANG[a.spec.art] ?? 9) - (ART_RANG[b.spec.art] ?? 9) ||
        (reihe.get(a.knoten.id) ?? 0) - (reihe.get(b.knoten.id) ?? 0),
    );
    this.#layer = liste.map((l, i) => ({ ...l, spec: { ...l.spec, ordnung: i } }));
    this.layer = this.#layer.map((l) => l.spec);
  }

  #punkt(l: Bindungslayer, bar: Bar, wert: unknown): Punkt {
    if (l.spec.art === 'candles') {
      const b = wert as Bar | null;
      return b ? { t: bar.t, werte: { o: b.o, h: b.h, l: b.l, c: b.c } } : { t: bar.t, werte: { o: null, h: null, l: null, c: null } };
    }
    let v: unknown = wert;
    if (l.feld !== undefined && v !== null && typeof v === 'object') v = (v as Record<string, unknown>)[l.feld];
    // Kein Wert heisst Whitespace — waehrend des Warmups und ueber Luecken.
    return { t: bar.t, werte: { wert: typeof v === 'bigint' ? v : null } };
  }

  /**
   * Ein Maschinenschritt → die Ops, die ihn im Chart nachziehen.
   *
   * Je Layer hoechstens EIN `append` pro Schritt. Wer je Punkt ein Op schickt,
   * verbraucht Revisionen, die ein Abonnent sonst fuer eine Luecke haelt.
   */
  schritt(bar: Bar, werte: ReadonlyMap<string, unknown>): ChartOp[] {
    for (const l of this.#layer) {
      const wert = werte.get(l.knoten.id);
      if (l.spec.art === 'markers') {
        const f = wert as Fillartig | null | undefined;
        if (f) {
          l.marker.push({
            t: f.t,
            art: f.seite,
            text: f.seite === 'kauf' ? 'Kauf' : 'Verkauf',
            preis: f.preis,
          });
          l.markerGeaendert = true;
        }
        continue;
      }
      const p = this.#punkt(l, bar, wert);
      l.punkte.push(p);
      l.offen.push(p);
    }
    return this.#abholen();
  }

  #abholen(): ChartOp[] {
    const ops: ChartOp[] = [];
    for (const l of this.#layer) {
      if (l.rev < 0) {
        // Der erste Kontakt ist immer ein Snapshot — auch wenn er leer ist. Ein
        // Treiber, der mit `append` beginnt, hat keinen Nullpunkt.
        l.rev = 0;
        ops.push({ op: 'snapshot', layer: l.spec.id, rev: 0, punkte: [...l.offen] });
        if (l.spec.art === 'markers') {
          l.rev = 1;
          ops.push({ op: 'setMarkers', layer: l.spec.id, rev: 1, marker: [...l.marker] });
        }
      } else if (l.offen.length > 0) {
        l.rev += 1;
        ops.push({ op: 'append', layer: l.spec.id, rev: l.rev, punkte: [...l.offen] });
      }
      if (l.markerGeaendert && l.rev >= 1 && l.spec.art === 'markers') {
        l.rev += 1;
        ops.push({ op: 'setMarkers', layer: l.spec.id, rev: l.rev, marker: [...l.marker] });
      }
      l.offen = [];
      l.markerGeaendert = false;
    }
    return ops;
  }

  /**
   * Der vollstaendige Stand fuer einen neuen Abonnenten — oder nach einer
   * Revisionsluecke (§5.2). Rev 0, weil ein Snapshot die Zaehlung neu beginnt.
   */
  snapshot(): ChartOp[] {
    const ops: ChartOp[] = [];
    for (const l of this.#layer) {
      ops.push({ op: 'snapshot', layer: l.spec.id, rev: 0, punkte: [...l.punkte] });
      if (l.spec.art === 'markers') ops.push({ op: 'setMarkers', layer: l.spec.id, rev: 1, marker: [...l.marker] });
    }
    return ops;
  }

  paket(titelText: string, zusatz: string[] = []): ChartPaket {
    const erste = this.#layer.find((l) => l.punkte.length > 0)?.punkte[0];
    const letzte = this.#layer.find((l) => l.punkte.length > 0)?.punkte.at(-1);
    return {
      titel: titelText,
      untertitel: [
        this.#plan.scopeKey,
        erste && letzte ? `${iso(erste.t).slice(0, 10)} – ${iso(letzte.t).slice(0, 10)}` : '',
        `Plan ${this.#plan.planHash.slice(0, 12)}`,
        ...zusatz,
      ].filter(Boolean).join(' · '),
      layer: this.layer,
      ops: this.snapshot(),
    };
  }
}
