import {
  betrag,
  durch,
  fix,
  mal,
  scopeLesen,
  SimUhr,
  type Bar,
  type Fix,
  type InstrumentMeta,
  type TimeMs,
} from '@vp/core-ids';
import type { Umgebung } from '@vp/compute';
import { Tracker } from '@vp/errors';
import { resolve, type Katalog, type Plan } from '@vp/registry';
import { Belegbuch, Rechenband, type Beleg } from '@vp/trace';
import { Konto } from '@vp/trading';
import { Maschine } from '@vp/machine';
import { datenHash, pruefeSzenario, strategieHash, szenarioHash, type Szenario } from './szenario.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Ein Lauf — PLAN.md §4.6.
//
// Und der wichtigste Satz dieses Pakets: hier steht KEIN `if (sim)`. Was hier
// anders ist als im Live-Betrieb, sind drei Dinge — die Bars kommen aus einer
// Datei, die Uhr haengt am Bar-Strom, und die Fills entstehen aus einem Modell.
// Alles Uebrige ist derselbe Code.
// ─────────────────────────────────────────────────────────────────────────────

export interface Bericht {
  readonly szenario: string;
  readonly szenarioHash: string;
  readonly datenHash: string;
  readonly strategieHash: string;
  readonly planHash: string;
  readonly waehrung: string;
  readonly startkapital: Fix;
  readonly endkapital: Fix;
  readonly realisiert: Fix;
  readonly unrealisiert: Fix;
  readonly gebuehren: Fix;
  readonly maxRueckgangBp: number;
  readonly trades: number;
  readonly gewinnTrades: number;
  readonly barsGesehen: number;
  readonly barsGueltig: number;
  /** Wie oft die Szenario-Familie schon gerechnet wurde (PLAN.md §12/L130). */
  readonly laufNr: number;
  readonly hinweise: readonly string[];
}

export interface Lauf {
  readonly bericht: Bericht;
  readonly belege: readonly Beleg[];
  readonly band: Rechenband;
  readonly plan: Plan;
  readonly konto: Konto;
  readonly kapitalkurve: readonly { t: TimeMs; wert: Fix }[];
  readonly maschine: Maschine;
}

export interface LaufEingabe {
  readonly katalog: Katalog;
  readonly szenario: Szenario;
  readonly scopeKey: string;
  readonly meta: InstrumentMeta;
  readonly bars: readonly Bar[];
  readonly tracker?: Tracker;
  /**
   * Bars einzeln statt am Stueck einspeisen.
   *
   * Fuer den Aequivalenztest: das Ergebnis MUSS gleich sein. Ist es das nicht,
   * gibt es Look-ahead-Bias und jede Zahl aus diesem System ist wertlos
   * (PLAN.md §4.3).
   */
  readonly einzeln?: boolean;
  /**
   * Wird nach JEDER Bar gerufen, mit allen Knotenwerten dieses Schritts.
   *
   * Absichtlich ein neutraler Rueckruf und kein Chart-Typ: `sim` darf den Chart
   * nicht kennen (PLAN.md §9.2). Wer zuschauen will — Chart-Bindung, MCP,
   * Aufzeichnung —, haengt sich hier an.
   */
  readonly beobachter?: (bar: Bar, werte: ReadonlyMap<string, unknown>, gueltig: boolean) => void;
}

/** Zaehler je Pruefstand — ehrlich gehaltene Statistik zum Mehrfachvergleich. */
const LAUF_ZAEHLER = new Map<string, number>();

export function laufZaehlerStand(dHash: string): number {
  return LAUF_ZAEHLER.get(dHash) ?? 0;
}

export function laufZaehlerZuruecksetzen(): void {
  LAUF_ZAEHLER.clear();
}

export function fuehreAus(e: LaufEingabe): Lauf {
  const { katalog, szenario, meta } = e;
  pruefeSzenario(szenario);

  const strategie = katalog.strategien.get(szenario.strategie);
  if (!strategie) throw new Error(`Strategie nicht gefunden: ${szenario.strategie}`);

  const dHash = datenHash(szenario);
  const sHash = szenarioHash(szenario, strategie);
  const laufNr = (LAUF_ZAEHLER.get(dHash) ?? 0) + 1;
  LAUF_ZAEHLER.set(dHash, laufNr);

  const scope = scopeLesen(e.scopeKey);
  const plan = resolve(katalog, strategie.profil, scope, { datenRevision: szenario.datenRevision });

  const konto = new Konto(szenario.konto.startkapital, szenario.konto.waehrung);
  const buch = new Belegbuch();
  const band = new Rechenband(szenario.trace);
  const erste = e.bars[0];
  const uhr = new SimUhr(erste ? erste.t : szenario.warmupVor);

  const umgebung: Umgebung = {
    meta,
    dienste: new Map<string, unknown>([
      ['konto', konto],
      ['kosten', szenario.kosten],
      ['belegbuch', buch],
      ['band', band],
      ['lauf', {
        szenarioHash: sHash,
        planHash: plan.planHash,
        scope: e.scopeKey,
        datenRevision: szenario.datenRevision,
      }],
    ]),
  };

  const maschine = new Maschine({
    plan,
    umgebung,
    band,
    uhr,
    timeframe: scope.timeframe,
    ...(e.tracker ? { tracker: e.tracker } : {}),
  });
  maschine.starte();

  const kurve: { t: TimeMs; wert: Fix }[] = [];
  let gueltig = 0;
  const hinweise: string[] = [];

  if (e.bars.length < plan.warmupBars) {
    maschine.warmupUnmoeglich(`${e.bars.length} Bars, ${plan.warmupBars} noetig`);
    hinweise.push(
      `Warmup nicht gedeckt: ${e.bars.length} von ${plan.warmupBars} Bars — der Lauf ist DEGRADED`,
    );
  }

  const einspeisen = (bar: Bar): void => {
    uhr.stelle(bar.t);
    const r = maschine.schritt(bar);
    if (r.gueltig) gueltig += 1;
    e.beobachter?.(bar, r.werte, r.gueltig);
    // Die Kapitalkurve wird JE BAR fortgeschrieben, nicht nur bei Fills —
    // sonst hat sie Loecher ueber einer lueckenlosen Preisachse (§12/E71).
    kurve.push({ t: bar.t, wert: konto.eigenkapital(bar.c) });
  };

  if (e.einzeln) {
    for (const bar of e.bars) einspeisen(bar);
  } else {
    // Am Stueck — exakt derselbe Aufruf, nur ohne Umweg. Genau das ist der Punkt.
    for (const bar of e.bars) einspeisen(bar);
  }

  const stand = konto.stand();
  konto.pruefeInvariante();

  const belege = buch.alle();
  const verkaeufe = belege.filter((b) => b.fill?.seite === 'verkauf');

  return {
    bericht: {
      szenario: szenario.id,
      szenarioHash: sHash,
      datenHash: dHash,
      strategieHash: strategieHash(strategie),
      planHash: plan.planHash,
      waehrung: szenario.konto.waehrung,
      startkapital: konto.startkapital,
      endkapital: stand.eigenkapital,
      realisiert: stand.realisiert,
      unrealisiert: stand.unrealisiert,
      gebuehren: stand.gebuehrenGesamt,
      maxRueckgangBp: maxRueckgangBp(kurve),
      trades: belege.length,
      gewinnTrades: verkaeufe.filter((b) => (b.realisiert ?? 0n) > 0n).length,
      barsGesehen: maschine.gesehen,
      barsGueltig: gueltig,
      laufNr,
      hinweise,
    },
    belege,
    band,
    plan,
    konto,
    kapitalkurve: kurve,
    maschine,
  };
}

/** Groesster Rueckgang vom Hoechststand, in Basispunkten. */
export function maxRueckgangBp(kurve: readonly { wert: Fix }[]): number {
  let hoch = 0n;
  let schlimmster = 0n;
  for (const p of kurve) {
    if (p.wert > hoch) hoch = p.wert;
    if (hoch > 0n) {
      const rueck = durch(mal(hoch - p.wert, fix(10_000), 'ab'), hoch, 'ab');
      if (rueck > schlimmster) schlimmster = rueck;
    }
  }
  return Number(schlimmster / 100_000_000n);
}

export function berichtAlsText(b: Bericht): string {
  const z = (v: Fix): string => betrag(v, b.waehrung);
  return [
    `Szenario      ${b.szenario}  (Lauf ${b.laufNr} auf diesem Pruefstand)`,
    `Pruefstand    ${b.datenHash.slice(0, 12)}`,
    `Strategie     ${b.strategieHash.slice(0, 12)}`,
    `Plan          ${b.planHash.slice(0, 12)}`,
    `Start         ${z(b.startkapital)}`,
    `Ende          ${z(b.endkapital)}`,
    `  realisiert  ${z(b.realisiert)}`,
    `  offen       ${z(b.unrealisiert)}`,
    `  Gebuehren   ${z(b.gebuehren)}`,
    `Rueckgang     ${(b.maxRueckgangBp / 100).toFixed(2)} %`,
    `Trades        ${b.trades} (davon ${b.gewinnTrades} im Plus)`,
    `Bars          ${b.barsGesehen} gesehen, ${b.barsGueltig} gueltig`,
    ...b.hinweise.map((h) => `Hinweis       ${h}`),
    `Alle Betraege vor Steuern und in ${b.waehrung}.`,
  ].join('\n');
}
