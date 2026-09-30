import { durch, fix, fixAlsText, mal, type Fix } from '@vp/core-ids';
import { alsBar, alsFix, dienst, melde, zahlParam, type KnotenLaufzeit, type SchrittKontext } from '@vp/compute';
import { Belegbuch, Rechenband, belegId, wertId, type Beleg } from '@vp/trace';
import { fuelle, Konto, type Absicht, type Fill, type KostenModell } from './konto.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Die Knoten der Ebenen 8 bis 11 — PLAN.md §3.1 und §4.7.
//
//   decision   „ich will"        signal + Regel + Risikobudget
//   execution  „so viel, zu diesem Preis, das kostet es"
//   pnl        „das hat es gebracht"
//
// `position` fuehrt das Konto und ist deshalb kein eigener Knoten, sondern ein
// Dienst: es gibt genau EIN Konto je Lauf, und ein Knoten je Scope haette
// daraus mehrere gemacht (PLAN.md §12/L125).
// ─────────────────────────────────────────────────────────────────────────────

export const URNS = {
  NULL: 'vp://decision/core/null@1.0.0',
  BUYHOLD: 'vp://decision/core/buyhold@1.0.0',
  EMA_CROSS: 'vp://decision/core/ema-cross@1.0.0',
  AUSFUEHRUNG: 'vp://execution/core/naechste-oeffnung@1.0.0',
  KONTO: 'vp://pnl/core/konto@1.0.0',
} as const;

export interface LaufInfo {
  readonly szenarioHash: string;
  readonly planHash: string;
  readonly scope: string;
  readonly datenRevision: string;
}

const BP = fix(10_000);

/**
 * Ein positiver Faktor, der auch ein Bruch sein darf (`atrFaktor: 2.5`).
 *
 * Kein Rueckfall: die Vorgaben stehen in registry/definitionen.json und sind
 * beim Aufloesen schon eingesetzt (§12/C29). Fehlt der Wert hier trotzdem,
 * ist die Definition kaputt — und das soll beim Start auffallen, nicht als
 * stille zweite Zahl im Code weiterrechnen.
 */
function faktorParam(params: Readonly<Record<string, unknown>>, name: string): number {
  const v = params[name];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`Parameter ${name} muss eine positive Zahl sein, ist ${String(v)}`);
  }
  return v;
}

// ── 1 · null — entscheidet nie ───────────────────────────────────────────────
//
// Die erste Sprosse der Leiter (PLAN.md §16.4). Sie beweist, dass ohne
// Entscheidung EXAKT nichts passiert: Gewinn 0, Gebuehren 0, Invariante haelt.
// Jeder Verdrahtungsfehler faellt hier auf, bevor eine echte Regel ihn verdeckt.

melde(URNS.NULL, () => ({ schritt: () => null }) satisfies KnotenLaufzeit);

// ── 2 · buy & hold — die Messlatte ───────────────────────────────────────────

melde(URNS.BUYHOLD, (params) => {
  const anteilBp = zahlParam(params, 'anteilBp');
  let gekauft = false;
  return {
    schritt(ctx) {
      if (gekauft || ctx.bar.vorlaeufig) return null;
      gekauft = true;
      return {
        richtung: 'lang',
        anteilBp,
        grund: ['erste Bar'],
      } satisfies Absicht;
    },
  } satisfies KnotenLaufzeit;
});

// ── 3 · EMA-Kreuzung mit ATR-Stopp ───────────────────────────────────────────
//
// Bewusst eine mittelmaessige Handelsregel: gut verstanden, vollstaendig
// durchschaubar, von Hand nachrechenbar. Eine erste Strategie, die ueberraschend
// gut abschneidet, ist meist ein Fehler im Pruefstand.

melde(URNS.EMA_CROSS, (params) => {
  const risikoBp = zahlParam(params, 'risikoBp');
  const atrFaktor = faktorParam(params, 'atrFaktor');
  const maxAnteilBp = zahlParam(params, 'maxAnteilBp');

  let vorherSchnell: Fix | null = null;
  let vorherLangsam: Fix | null = null;
  let imMarkt = false;
  let stopp: Fix | null = null;

  return {
    schritt(ctx) {
      const bar = alsBar(ctx.eingang('reihe'));
      const schnell = alsFix(ctx.eingang('schnell'));
      const langsam = alsFix(ctx.eingang('langsam'));
      const atr = alsFix(ctx.eingang('atr'));

      const vs = vorherSchnell;
      const vl = vorherLangsam;
      vorherSchnell = schnell;
      vorherLangsam = langsam;

      // Stopp zuerst: er gilt auch dann, wenn die Kreuzung nichts sagt.
      if (imMarkt && stopp !== null && bar.l <= stopp) {
        imMarkt = false;
        const s = stopp;
        stopp = null;
        return {
          richtung: 'flach',
          anteilBp: 0,
          grund: [`Stopp bei ${fixAlsText(s, 2)} unterschritten`],
        } satisfies Absicht;
      }

      if (schnell === null || langsam === null || vs === null || vl === null) return null;

      const kreuztHoch = vs <= vl && schnell > langsam;
      const kreuztRunter = vs >= vl && schnell < langsam;

      if (kreuztHoch && !imMarkt) {
        if (atr === null || atr <= 0n) return null;
        // Positionsgroesse aus dem Risiko: Risikobetrag / Stoppabstand.
        // In Anteilen des Eigenkapitals: anteil = risiko · preis / (faktor · atr)
        const zaehler = mal(fix(risikoBp), bar.c, 'ab');
        const nenner = mal(fix(atrFaktor), atr, 'auf');
        const roh = durch(zaehler, nenner, 'ab');
        const anteilBp = Math.min(maxAnteilBp, Number(fixAlsText(roh, 0)));
        if (anteilBp <= 0) return null;

        imMarkt = true;
        stopp = bar.c - mal(fix(atrFaktor), atr, 'auf');
        return {
          richtung: 'lang',
          anteilBp,
          grund: [`EMA-Kreuzung aufwaerts`, `ATR-Stopp ${fixAlsText(stopp, 2)}`],
          stopp,
        } satisfies Absicht;
      }

      if (kreuztRunter && imMarkt) {
        imMarkt = false;
        stopp = null;
        return {
          richtung: 'flach',
          anteilBp: 0,
          grund: ['EMA-Kreuzung abwaerts'],
        } satisfies Absicht;
      }
      return null;
    },
  } satisfies KnotenLaufzeit;
});

// ── 4 · Ausfuehrung: Fill zur OEFFNUNG DER NAECHSTEN BAR ─────────────────────
//
// Der Kern von PLAN.md §12/L121. Eine Absicht, die auf Bar N entsteht, wird auf
// Bar N+1 gefuellt — nie zum Schluss derselben Bar, den die Entscheidung gerade
// erst erfahren hat. Der Aufschub steckt in diesem Knoten und nirgends sonst.

melde(URNS.AUSFUEHRUNG, (_params, umgebung) => {
  const konto = dienst<Konto>(umgebung, 'konto');
  const kosten = dienst<KostenModell>(umgebung, 'kosten');
  const buch = dienst<Belegbuch>(umgebung, 'belegbuch');
  const band = dienst<Rechenband>(umgebung, 'band');
  const lauf = dienst<LaufInfo>(umgebung, 'lauf');
  const meta = umgebung.meta;

  let offen: { absicht: Absicht; wurzeln: string[] } | null = null;
  let lfd = 0;

  return {
    schritt(ctx: SchrittKontext) {
      let fill: Fill | null = null;

      if (offen !== null && !ctx.bar.vorlaeufig) {
        const vorher = { menge: konto.menge, einstand: konto.stand().position.einstand };
        const e = fuelle({ absicht: offen.absicht, bar: ctx.bar, meta, kosten, konto });

        if (e.art === 'gefuellt') {
          fill = e.fill;
          konto.pruefeInvariante(ctx.bar.c);
          lfd += 1;
          const b: Beleg = {
            belegId: belegId(lauf.szenarioHash, lauf.scope, ctx.bar.t, lfd),
            szenarioHash: lauf.szenarioHash,
            planHash: lauf.planHash,
            t: ctx.bar.t,
            scope: lauf.scope,
            richtung: offen.absicht.richtung,
            grund: offen.absicht.grund,
            kette: band.kette(offen.wurzeln),
            fill: {
              seite: e.fill.seite,
              menge: e.fill.menge,
              preis: e.fill.preis,
              gebuehr: e.fill.gebuehr,
              notional: e.fill.notional,
              modell: e.fill.modell,
            },
            positionVorher: vorher,
            positionNachher: { menge: konto.menge, einstand: konto.stand().position.einstand },
            datenstand: lauf.datenRevision,
          };
          if (e.fill.seite === 'verkauf') {
            b.realisiert = konto.stand(ctx.bar.c).realisiert;
          }
          buch.fuegeHinzu(b);
        }
        offen = null;
      }

      const neu = ctx.eingang('absicht') as Absicht | null;
      if (neu !== null && neu !== undefined) {
        // Die Wurzel der Kette ist die Absicht selbst — von dort laeuft das
        // Band rueckwaerts bis zur Rohbar.
        offen = { absicht: neu, wurzeln: [ctx.wertIdVon('absicht')] };
      }

      konto.preisMerken(ctx.bar.c);
      return fill;
    },
  } satisfies KnotenLaufzeit;
});

// ── 5 · Kontostand ───────────────────────────────────────────────────────────

melde(URNS.KONTO, (_params, umgebung) => {
  const konto = dienst<Konto>(umgebung, 'konto');
  return {
    schritt(ctx) {
      // Eingang wird gelesen, damit die Kante im Plan existiert: der Kontostand
      // haengt an der Ausfuehrung, nicht nur an der Bar.
      ctx.eingang('ausfuehrung');
      return konto.stand(ctx.bar.c);
    },
  } satisfies KnotenLaufzeit;
});

export { wertId };
