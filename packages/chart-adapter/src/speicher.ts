import { hatWert, pruefeRev, type ChartOp, type LayerArt, type LayerSpec, type Marker, type Punkt, type Rueckschau, type Treiber } from './vertrag.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Speicher-Treiber — die Messlatte der Konformitaetssuite.
//
// Er tut genau das, was der Vertrag sagt, und nichts darueber hinaus. Weicht
// ein echter Treiber von ihm ab, ist der echte Treiber falsch — oder der
// Vertrag zu ungenau, und dann gehoert das in `vertrag.ts`, nicht in den Treiber.
// ─────────────────────────────────────────────────────────────────────────────

interface Zustand {
  punkte: Punkt[];
  marker: Marker[];
  sichtbar: boolean;
  rev: number;
  vorlaeufig: boolean;
}

export class SpeicherTreiber implements Treiber {
  readonly name = 'speicher';
  readonly kann: ReadonlySet<LayerArt> = new Set<LayerArt>([
    'candles', 'line', 'area', 'histogram', 'band', 'markers', 'priceLines', 'boxes', 'heatmap',
  ]);

  #layer = new Map<string, Zustand>();
  #zerstoert = false;

  lege(spec: LayerSpec): void {
    if (!this.#layer.has(spec.id)) {
      this.#layer.set(spec.id, { punkte: [], marker: [], sichtbar: spec.sichtbar, rev: -1, vorlaeufig: false });
    }
  }

  #hole(id: string): Zustand {
    const l = this.#layer.get(id);
    if (!l) throw new Error(`Layer ${id} nicht angelegt`);
    return l;
  }

  wende(ops: readonly ChartOp[]): void {
    if (this.#zerstoert) throw new Error('Treiber ist zerstoert');
    for (const op of ops) {
      const l = this.#hole(op.layer);
      pruefeRev(op.layer, l.rev, op);
      l.rev = op.rev;

      switch (op.op) {
        case 'snapshot':
          l.punkte = [...op.punkte];
          l.vorlaeufig = false;
          break;
        case 'append':
          l.punkte.push(...op.punkte);
          l.vorlaeufig = false;
          break;
        case 'updateLast': {
          const letzter = l.punkte.at(-1);
          if (letzter && letzter.t === op.punkt.t) l.punkte[l.punkte.length - 1] = op.punkt;
          else l.punkte.push(op.punkt);
          l.vorlaeufig = op.vorlaeufig;
          break;
        }
        case 'replaceRange':
          l.punkte = [
            ...l.punkte.filter((p) => p.t < op.von),
            ...op.punkte,
            ...l.punkte.filter((p) => p.t > op.bis),
          ].sort((a, b) => a.t - b.t);
          break;
        case 'removeRange':
          l.punkte = l.punkte.filter((p) => p.t < op.von || p.t > op.bis);
          break;
        case 'setMarkers':
          // Sortiert — Vertrag, siehe `Rueckschau.marker`. Die Referenz hatte das
          // zuerst nicht, und erst der Vergleich mit den echten Treibern zeigte
          // es: Lightweight WIRFT bei unsortierten Markern, also sortieren beide.
          l.marker = [...op.marker].sort((a, b) => a.t - b.t);
          break;
        case 'setVisible':
          l.sichtbar = op.sichtbar;
          break;
        case 'reset':
          l.punkte = [];
          l.marker = [];
          l.vorlaeufig = false;
          break;
      }
    }
  }

  rueckschau(layer: string): Rueckschau {
    const l = this.#hole(layer);
    return {
      punkte: l.punkte.filter(hatWert),
      marker: [...l.marker],
      sichtbar: l.sichtbar,
      rev: l.rev,
      vorlaeufigAmEnde: l.vorlaeufig,
      vereinfacht: null,
    };
  }

  zerstoere(): void {
    this.#layer.clear();
    this.#zerstoert = true;
  }
}
