import { betrag, kanon, type Fix } from '@vp/core-ids';
import type { Strategie } from '@vp/registry';
import type { Beleg, Kettenglied } from '@vp/trace';
import type { Lauf } from './lauf.ts';
import { SzenarioFehler } from './szenario.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Strategievergleich — PLAN.md §7.3.
//
// Vier Ebenen, aufsteigend im Aufwand und im Wert:
//
//   1 Struktur   worin unterscheiden sich die Bauplaene        (ohne Rechnung)
//   2 Verhalten  wo fiel zum ersten Mal eine andere Entscheidung
//   3 Ergebnis   was kam heraus
//   4 ZUORDNUNG  welcher Unterschied aus 1 hat 2 ausgeloest
//
// Ebene 4 ist der Grund, warum das Rechenband existiert. Ohne sie endet jeder
// Vergleich bei „B verdient mehr", und die naechste Aenderung ist wieder geraten.
// ─────────────────────────────────────────────────────────────────────────────

export interface StrukturUnterschied {
  readonly pfad: string;
  readonly a: string;
  readonly b: string;
}

export interface VerhaltensUnterschied {
  readonly t: number;
  readonly a: string;
  readonly b: string;
}

export interface Zuordnung {
  readonly knoten: string;
  readonly t: number;
  readonly wertA: string;
  readonly wertB: string;
  readonly text: string;
}

export interface Vergleich {
  readonly struktur: readonly StrukturUnterschied[];
  readonly ersteAbweichung: VerhaltensUnterschied | null;
  readonly ergebnis: {
    readonly endkapitalA: Fix;
    readonly endkapitalB: Fix;
    readonly differenz: Fix;
    readonly waehrung: string;
    readonly tradesA: number;
    readonly tradesB: number;
  };
  readonly zuordnung: Zuordnung | null;
  readonly warnungen: readonly string[];
}

/** Flache Sicht auf ein Objekt: `risiko.maxRueckgang.bp` → Wert. */
function flach(o: unknown, praefix = ''): Map<string, string> {
  const raus = new Map<string, string>();
  if (o === null || typeof o !== 'object') {
    raus.set(praefix || '$', kanon(o));
    return raus;
  }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const p = praefix ? `${praefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [kk, vv] of flach(v, p)) raus.set(kk, vv);
    } else {
      raus.set(p, kanon(v));
    }
  }
  return raus;
}

export function strukturVergleich(a: Strategie, b: Strategie): StrukturUnterschied[] {
  const fa = flach(a);
  const fb = flach(b);
  const pfade = [...new Set([...fa.keys(), ...fb.keys()])].sort();
  const raus: StrukturUnterschied[] = [];
  for (const p of pfade) {
    const va = fa.get(p) ?? '<fehlt>';
    const vb = fb.get(p) ?? '<fehlt>';
    if (va !== vb) raus.push({ pfad: p, a: va, b: vb });
  }
  return raus;
}

/**
 * Die Kennung einer Entscheidung — Richtung UND Menge.
 *
 * Die Menge gehoert dazu. Der erste Anlauf verglich nur die Richtung und meldete
 * „beide Strategien entscheiden gleich", waehrend die Ergebnisse auseinander-
 * liefen — auf der Kunstreihe um 8,25 USDT, auf BTCUSDT 2019-H1 um 160,26 USDT
 * (PLAN.md §12/N156): gleiche Richtung, andere Positionsgroesse — denn genau die
 * haengt beim ATR-Stopp am ATR. Ein Verhaltensvergleich, der die Groesse
 * uebersieht, erklaert den Ergebnisunterschied nicht und behauptet trotzdem, es
 * gaebe keinen.
 */
function alsEreignis(b: Beleg): string {
  const teile: string[] = [b.richtung];
  if (b.fill) teile.push(b.fill.seite, b.fill.menge.toString());
  return teile.join(' ');
}

/**
 * Der Vergleich.
 *
 * Er VERWEIGERT bei abweichendem Pruefstand — er warnt nicht. Eine Warnung
 * liest niemand zweimal, und eine Zahl, die zwei Dinge gleichzeitig misst,
 * richtet mehr Schaden an als gar keine.
 */
export function vergleiche(
  a: { lauf: Lauf; strategie: Strategie },
  b: { lauf: Lauf; strategie: Strategie },
): Vergleich {
  if (a.lauf.bericht.datenHash !== b.lauf.bericht.datenHash) {
    throw new SzenarioFehler(
      'VP-MCP-0003',
      'Vergleich abgelehnt: die Pruefstaende unterscheiden sich ' +
        `(${a.lauf.bericht.datenHash.slice(0, 12)} ≠ ${b.lauf.bericht.datenHash.slice(0, 12)}). ` +
        'Zeitraum, Konto, Kosten, Marktmodell, Saat und Datenstand muessen gleich sein.',
    );
  }

  const struktur = strukturVergleich(a.strategie, b.strategie);
  const warnungen: string[] = [];
  if (!a.strategie.eltern && !b.strategie.eltern) {
    warnungen.push(
      'Keine der beiden Strategien nennt eine Abstammung — der Vergleich zeigt Unterschiede, ' +
        'aber keine Entwicklungslinie.',
    );
  }
  if (struktur.length > 5) {
    warnungen.push(
      `${struktur.length} strukturelle Unterschiede: die Zuordnung nennt den ersten wirksamen, ` +
        'nicht den einzigen.',
    );
  }
  const laeufeA = a.lauf.bericht.laufNr;
  const laeufeB = b.lauf.bericht.laufNr;
  if (laeufeA > 5 || laeufeB > 5) {
    warnungen.push(
      `Dieser Pruefstand wurde bereits ${Math.max(laeufeA, laeufeB)}-mal gerechnet — ` +
        'bei genug Versuchen sieht irgendeine Variante immer gut aus.',
    );
  }

  // ── Ebene 2: erste abweichende Entscheidung ──
  const ba = a.lauf.belege;
  const bb = b.lauf.belege;
  let erste: VerhaltensUnterschied | null = null;
  for (let i = 0; i < Math.max(ba.length, bb.length); i += 1) {
    const x = ba[i];
    const y = bb[i];
    if (!x || !y || x.t !== y.t || alsEreignis(x) !== alsEreignis(y)) {
      erste = {
        t: x?.t ?? y?.t ?? 0,
        a: x ? `${new Date(x.t).toISOString()} ${alsEreignis(x)} — ${x.grund.join('; ')}` : '<nichts>',
        b: y ? `${new Date(y.t).toISOString()} ${alsEreignis(y)} — ${y.grund.join('; ')}` : '<nichts>',
      };
      break;
    }
  }

  // ── Ebene 4: Zuordnung ──
  const zuordnung = erste ? findeUrsache(ba, bb, erste.t) : null;

  return {
    struktur,
    ersteAbweichung: erste,
    ergebnis: {
      endkapitalA: a.lauf.bericht.endkapital,
      endkapitalB: b.lauf.bericht.endkapital,
      differenz: b.lauf.bericht.endkapital - a.lauf.bericht.endkapital,
      waehrung: a.lauf.bericht.waehrung,
      tradesA: a.lauf.bericht.trades,
      tradesB: b.lauf.bericht.trades,
    },
    zuordnung,
    warnungen,
  };
}

/**
 * Die beiden Rechenketten rueckwaerts vergleichen.
 *
 * Gesucht ist der frueheste Knoten, der in beiden Laeufen dieselbe Id hat, aber
 * einen anderen Wert liefert. Genau dort geht die Entscheidung auseinander —
 * alles davor ist gleich, alles danach ist Folge.
 */
function findeUrsache(
  ba: readonly Beleg[],
  bb: readonly Beleg[],
  t: number,
): Zuordnung | null {
  const belegA = ba.find((x) => x.t >= t);
  const belegB = bb.find((x) => x.t >= t);
  const ketteA = belegA?.kette ?? [];
  const ketteB = belegB?.kette ?? [];
  if (ketteA.length === 0 && ketteB.length === 0) return null;

  const nachKnoten = (k: readonly Kettenglied[]): Map<string, Kettenglied[]> => {
    const m = new Map<string, Kettenglied[]>();
    for (const g of k) {
      const liste = m.get(g.knoten) ?? [];
      liste.push(g);
      m.set(g.knoten, liste);
    }
    return m;
  };

  const ka = nachKnoten(ketteA);
  const kb = nachKnoten(ketteB);
  const kandidaten: Zuordnung[] = [];

  for (const [knoten, listeA] of ka) {
    const listeB = kb.get(knoten);
    if (!listeB) continue;
    for (const ga of listeA) {
      const gb = listeB.find((x) => x.t === ga.t);
      if (!gb) continue;
      if (ga.nodeHash !== gb.nodeHash || ga.wert !== gb.wert) {
        kandidaten.push({
          knoten,
          t: ga.t,
          wertA: ga.wert,
          wertB: gb.wert,
          text:
            ga.nodeHash !== gb.nodeHash
              ? `Knoten "${knoten}" ist in beiden Strategien verschieden parametriert`
              : `Knoten "${knoten}" liefert bei gleicher Parametrierung verschiedene Werte`,
        });
      }
    }
  }
  if (kandidaten.length === 0) return null;
  kandidaten.sort((x, y) => x.t - y.t || (x.knoten < y.knoten ? -1 : 1));
  return kandidaten[0]!;
}

export function vergleichAlsText(v: Vergleich): string {
  const z: string[] = [];
  z.push('── 1 · Struktur ────────────────────────────────────────────');
  if (v.struktur.length === 0) z.push('  keine Unterschiede');
  for (const s of v.struktur) z.push(`  ${s.pfad}: ${s.a} → ${s.b}`);

  z.push('── 2 · Verhalten ───────────────────────────────────────────');
  z.push(
    v.ersteAbweichung
      ? `  erste Abweichung\n    A: ${v.ersteAbweichung.a}\n    B: ${v.ersteAbweichung.b}`
      : '  beide Strategien entscheiden gleich',
  );

  z.push('── 3 · Ergebnis ────────────────────────────────────────────');
  z.push(`  A ${betrag(v.ergebnis.endkapitalA, v.ergebnis.waehrung)}  (${v.ergebnis.tradesA} Trades)`);
  z.push(`  B ${betrag(v.ergebnis.endkapitalB, v.ergebnis.waehrung)}  (${v.ergebnis.tradesB} Trades)`);
  z.push(`  Δ ${betrag(v.ergebnis.differenz, v.ergebnis.waehrung)}`);

  z.push('── 4 · Zuordnung ───────────────────────────────────────────');
  z.push(
    v.zuordnung
      ? `  ${v.zuordnung.text}\n    ${new Date(v.zuordnung.t).toISOString()}  ` +
          `A=${v.zuordnung.wertA}  B=${v.zuordnung.wertB}`
      : '  keine Ursache im Rechenband gefunden',
  );

  if (v.warnungen.length > 0) {
    z.push('── Warnungen ───────────────────────────────────────────────');
    for (const w of v.warnungen) z.push(`  ${w}`);
  }
  z.push('Kein Urteil, kein Sieger — Unterschiede und Betraege. (PLAN.md §13)');
  return z.join('\n');
}
