import {
  aufSchritt,
  betrag,
  durch,
  fix,
  mal,
  type Bar,
  type Fix,
  type InstrumentMeta,
  type TimeMs,
} from '@vp/core-ids';

// ─────────────────────────────────────────────────────────────────────────────
// Konto, Position, Gewinnrechnung — PLAN.md §4.7.
//
// Alles in Festkomma. Die Invariante, die hier gilt und geprueft wird:
//
//     barmittel + Wert der Position  =  Startkapital + realisiert + unrealisiert
//
// Sie wird nach JEDEM Fill nachgerechnet, nicht nur am Ende. Eine Abweichung,
// die man erst im Schlussbericht sieht, gehoert zu einem von 4.000 Fills — und
// welcher es war, weiss dann niemand mehr.
// ─────────────────────────────────────────────────────────────────────────────

export class HandelsFehler extends Error {
  readonly code: 'VP-TRADE-0003' | 'VP-TRADE-0004';

  constructor(code: 'VP-TRADE-0003' | 'VP-TRADE-0004', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'HandelsFehler';
  }
}

export type Richtung = 'lang' | 'flach';

/** Was eine Strategie WILL — noch kein Handel. */
export interface Absicht {
  readonly richtung: Richtung;
  /** Anteil des Eigenkapitals in Basispunkten: 100 = 1 %. */
  readonly anteilBp: number;
  readonly grund: readonly string[];
  readonly stopp?: Fix;
}

export interface KostenModell {
  readonly id: string;
  /** Gebuehr je Seite in Basispunkten. Binance Spot Taker: 10 bp = 0,1 %. */
  readonly gebuehrBp: number;
  /** Halber Spread, in Basispunkten auf den Preis. */
  readonly spreadBp: number;
  /** Zusaetzlicher Abrieb in Basispunkten. */
  readonly slippageBp: number;
}

export interface Fill {
  readonly t: TimeMs;
  readonly seite: 'kauf' | 'verkauf';
  readonly menge: Fix;
  readonly preis: Fix;
  readonly gebuehr: Fix;
  readonly notional: Fix;
  readonly modell: string;
}

export interface Position {
  readonly menge: Fix;
  /** Durchschnittlicher Einstand, inklusive anteiliger Kaufgebuehr. */
  readonly einstand: Fix;
}

export interface KontoStand {
  readonly barmittel: Fix;
  readonly position: Position;
  readonly letzterPreis: Fix;
  readonly eigenkapital: Fix;
  readonly realisiert: Fix;
  readonly unrealisiert: Fix;
  readonly gebuehrenGesamt: Fix;
  readonly fills: number;
}

const BP = fix(10_000);

export class Konto {
  readonly startkapital: Fix;
  readonly waehrung: string;

  #barmittel: Fix;
  #menge: Fix = 0n;
  /**
   * Kostenbasis der offenen Position — der EXAKTE Betrag, der in ihr steckt.
   *
   * Nicht der Einstand je Stueck: den muesste man zurueckmultiplizieren, und
   * genau diese Rueckrechnung hat die Invariante um Bruchteile eines Cents
   * gerissen. Der Einstand je Stueck bleibt, aber nur noch zur ANZEIGE.
   */
  #basis: Fix = 0n;
  #realisiert: Fix = 0n;
  #gebuehren: Fix = 0n;
  #letzterPreis: Fix = 0n;
  #fills: Fill[] = [];

  constructor(startkapital: Fix, waehrung: string) {
    this.startkapital = startkapital;
    this.waehrung = waehrung;
    this.#barmittel = startkapital;
  }

  get barmittel(): Fix {
    return this.#barmittel;
  }

  get menge(): Fix {
    return this.#menge;
  }

  get basis(): Fix {
    return this.#basis;
  }

  /** Einstand je Stueck — abgeleitet, nur fuer die Anzeige. */
  get einstand(): Fix {
    return this.#menge === 0n ? 0n : durch(this.#basis, this.#menge, 'ab');
  }

  get fills(): readonly Fill[] {
    return this.#fills;
  }

  preisMerken(p: Fix): void {
    this.#letzterPreis = p;
  }

  eigenkapital(preis: Fix = this.#letzterPreis): Fix {
    return this.#barmittel + mal(this.#menge, preis, 'ab');
  }

  stand(preis: Fix = this.#letzterPreis): KontoStand {
    const unrealisiert = mal(this.#menge, preis, 'ab') - this.#basis;
    return {
      barmittel: this.#barmittel,
      position: { menge: this.#menge, einstand: this.einstand },
      letzterPreis: preis,
      eigenkapital: this.eigenkapital(preis),
      realisiert: this.#realisiert,
      unrealisiert,
      gebuehrenGesamt: this.#gebuehren,
      fills: this.#fills.length,
    };
  }

  /**
   * Die Invariante — PLAN.md §16.5/2.
   *
   * Sie wird NACH jedem Fill gerufen. `VP-TRADE-0004` ist mit Absicht `fatal`:
   * ein Lauf, dessen Geld nicht aufgeht, darf keine Kennzahl abliefern.
   */
  pruefeInvariante(preis: Fix = this.#letzterPreis): void {
    const links = this.eigenkapital(preis);
    const s = this.stand(preis);
    const rechts = this.startkapital + s.realisiert + s.unrealisiert;
    if (links !== rechts) {
      throw new HandelsFehler(
        'VP-TRADE-0004',
        `Geld-Invariante verletzt: ${betrag(links, this.waehrung)} ≠ ` +
          `${betrag(rechts, this.waehrung)} (Differenz ${betrag(links - rechts, this.waehrung)})`,
      );
    }
  }

  kaufe(t: TimeMs, menge: Fix, preis: Fix, gebuehr: Fix, modell: string): Fill {
    const notional = mal(menge, preis, 'auf');
    if (notional + gebuehr > this.#barmittel) {
      throw new HandelsFehler(
        'VP-TRADE-0003',
        `Deckung reicht nicht: ${betrag(notional + gebuehr, this.waehrung)} > ${betrag(this.#barmittel, this.waehrung)}`,
      );
    }
    // Die Gebuehr wandert in die Kostenbasis. Das ist eine Entscheidung und
    // keine Konvention: so zeigt eine Position erst ab dem Punkt Gewinn, an dem
    // sie ihn wirklich hat — und die Gebuehr wird nicht zweimal abgezogen.
    this.#menge += menge;
    this.#basis += notional + gebuehr;
    this.#barmittel -= notional + gebuehr;
    this.#gebuehren += gebuehr;
    this.#letzterPreis = preis;

    const f: Fill = { t, seite: 'kauf', menge, preis, gebuehr, notional, modell };
    this.#fills.push(f);
    return f;
  }

  verkaufe(t: TimeMs, menge: Fix, preis: Fix, gebuehr: Fix, modell: string): Fill {
    if (menge > this.#menge) {
      throw new HandelsFehler('VP-TRADE-0003', 'mehr verkaufen als gehalten — Leerverkauf ist nicht vorgesehen');
    }
    const notional = mal(menge, preis, 'ab');
    // Anteilige Kostenbasis, und der REST bleibt exakt stehen. Wer stattdessen
    // den Einstand je Stueck zurueckmultipliziert, verliert bei jedem Teilverkauf
    // ein paar Einheiten — und am Ende stimmt das Konto nicht.
    const basisAnteil =
      this.#menge === menge ? this.#basis : durch(mal(this.#basis, menge, 'ab'), this.#menge, 'ab');
    this.#realisiert += notional - gebuehr - basisAnteil;
    this.#basis -= basisAnteil;
    this.#menge -= menge;
    this.#barmittel += notional - gebuehr;
    this.#gebuehren += gebuehr;
    this.#letzterPreis = preis;

    const f: Fill = { t, seite: 'verkauf', menge, preis, gebuehr, notional, modell };
    this.#fills.push(f);
    return f;
  }
}

// ── Das Fill-Modell — PLAN.md §12/L121, L126 ─────────────────────────────────

export type FillErgebnis =
  | { readonly art: 'gefuellt'; readonly fill: Fill }
  | { readonly art: 'nichts' }
  | { readonly art: 'abgelehnt'; readonly code: 'VP-TRADE-0001' | 'VP-TRADE-0002'; readonly grund: string };

export interface FillEingabe {
  readonly absicht: Absicht;
  /** Die Bar, an deren OEFFNUNG gefuellt wird — nie die, auf der entschieden wurde. */
  readonly bar: Bar;
  readonly meta: InstrumentMeta;
  readonly kosten: KostenModell;
  readonly konto: Konto;
}

export function fuelle(e: FillEingabe): FillErgebnis {
  const { absicht, bar, meta, kosten, konto } = e;
  const roh = bar.o;
  const aufschlagBp = fix(kosten.spreadBp + kosten.slippageBp);

  if (absicht.richtung === 'flach') {
    if (konto.menge === 0n) return { art: 'nichts' };
    const preis = aufSchritt(roh - mal(roh, durch(aufschlagBp, BP, 'ab'), 'auf'), meta.tickSize, 'ab');
    const menge = konto.menge;
    const notional = mal(menge, preis, 'ab');
    const gebuehr = mal(notional, durch(fix(kosten.gebuehrBp), BP, 'auf'), 'auf');
    return { art: 'gefuellt', fill: konto.verkaufe(bar.t, menge, preis, gebuehr, kosten.id) };
  }

  // lang: auf den Zielanteil des Eigenkapitals aufstocken
  const preis = aufSchritt(roh + mal(roh, durch(aufschlagBp, BP, 'ab'), 'auf'), meta.tickSize, 'auf');
  if (preis <= 0n) return { art: 'abgelehnt', code: 'VP-TRADE-0002', grund: 'Preis ≤ 0' };

  const zielWert = mal(konto.eigenkapital(preis), durch(fix(absicht.anteilBp), BP, 'ab'), 'ab');
  const habenWert = mal(konto.menge, preis, 'ab');
  const fehlWert = zielWert - habenWert;
  if (fehlWert <= 0n) return { art: 'nichts' };

  let menge = aufSchritt(durch(fehlWert, preis, 'ab'), meta.stepSize, 'ab');
  if (menge <= 0n) {
    return { art: 'abgelehnt', code: 'VP-TRADE-0001', grund: 'Menge unter stepSize' };
  }

  let notional = mal(menge, preis, 'auf');
  let gebuehr = mal(notional, durch(fix(kosten.gebuehrBp), BP, 'auf'), 'auf');

  // Deckung: lieber eine Stufe kleiner als eine Ablehnung, die den ganzen
  // Einstieg verschluckt. Hoechstens zwei Versuche — mehr waere Raten.
  for (let i = 0; i < 2 && notional + gebuehr > konto.barmittel; i += 1) {
    menge = aufSchritt(durch(konto.barmittel, mal(preis, fix(1.002), 'auf'), 'ab'), meta.stepSize, 'ab');
    notional = mal(menge, preis, 'auf');
    gebuehr = mal(notional, durch(fix(kosten.gebuehrBp), BP, 'auf'), 'auf');
  }
  if (menge <= 0n || notional + gebuehr > konto.barmittel) {
    return { art: 'abgelehnt', code: 'VP-TRADE-0002', grund: 'Deckung reicht nicht' };
  }
  if (notional < meta.minNotional) {
    return { art: 'abgelehnt', code: 'VP-TRADE-0001', grund: 'Auftragswert unter minNotional' };
  }

  return { art: 'gefuellt', fill: konto.kaufe(bar.t, menge, preis, gebuehr, kosten.id) };
}
