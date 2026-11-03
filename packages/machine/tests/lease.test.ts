import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fix, scopeLesen, SimUhr, type Bar } from '@vp/core-ids';
import { eintragen, leaseErneuern, leaseErwerben, resolve } from '@vp/registry';
import { Belegbuch, Rechenband } from '@vp/trace';
import { Konto } from '@vp/trading';
import { Maschine, type LeaseAnschluss } from '@vp/machine';
import { bars, BTCUSDT, katalog, KOSTEN, SCOPE } from '../../../tests/hilfe.ts';

// D55 (Erneuerung vor Ablauf, sonst haelt die Maschine an) und D41 (zwei
// Maschinen, ein Scope).

const TTL = 1_000;
const BTC = { venue: 'binance', symbol: 'BTCUSDT', timeframe: '1h', profil: 'default' };
const BARS = bars(10);
let dir: string;
let pfad: string;
let uhr: SimUhr;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-lease-'));
  pfad = join(dir, 'matrix.json');
  uhr = new SimUhr(10_000);
  eintragen(pfad, { ...BTC, instrumentId: BTCUSDT.instrumentId }, () => uhr.jetzt());
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function anschluss(owner: string): LeaseAnschluss & { erneuerungen: number } {
  const jetzt = (): number => uhr.jetzt();
  const a = {
    ttlMs: TTL,
    erneuerungen: 0,
    erwerben: () => leaseErwerben(pfad, SCOPE, owner, TTL, jetzt),
    erneuern: () => {
      a.erneuerungen += 1;
      return leaseErneuern(pfad, SCOPE, owner, TTL, jetzt);
    },
  };
  return a;
}

function maschine(lease?: LeaseAnschluss): Maschine {
  const k = katalog();
  const strategie = k.strategien.get('null-v1')!;
  const plan = resolve(k, strategie.profil, scopeLesen(SCOPE), { datenRevision: 'kunst-1' });
  const band = new Rechenband('entscheidungen');
  const dienste = new Map<string, unknown>([
    ['konto', new Konto(fix('10000'), 'USDT')],
    ['kosten', KOSTEN],
    ['belegbuch', new Belegbuch()],
    ['band', band],
    ['lauf', { szenarioHash: 's', planHash: plan.planHash, scope: SCOPE, datenRevision: 'kunst-1' }],
  ]);
  return new Maschine({
    plan,
    umgebung: { meta: BTCUSDT, dienste },
    band,
    uhr,
    timeframe: '1h',
    ...(lease ? { lease } : {}),
  });
}

const fuettere = (m: Maschine, bar: Bar) => {
  return m.schritt(bar);
};

describe('D55 — Erneuerung vor Ablauf', () => {
  it('erneuert ab halber TTL, nicht frueher, und rechnet weiter', () => {
    const a = anschluss('m1');
    const m = maschine(a);
    m.starte();
    uhr.stelle(10_000 + TTL / 2 - 1);
    fuettere(m, BARS[0]!);
    expect(a.erneuerungen).toBe(0);
    uhr.stelle(10_000 + TTL / 2);
    const r = fuettere(m, BARS[1]!);
    expect(a.erneuerungen).toBe(1);
    expect(r.zustand).not.toBe('HALTED');
    expect(m.gesehen).toBe(2);
  });

  it('misslingt die Erneuerung, haelt sie selbst an: VP-MCH-0003 im Journal, kein Rechnen mehr', () => {
    const a = anschluss('m1');
    const m = maschine(a);
    m.starte();
    fuettere(m, BARS[0]!);
    // Die Lease laeuft ab, ein anderer uebernimmt sie.
    uhr.stelle(10_000 + TTL + 1);
    leaseErwerben(pfad, SCOPE, 'fremd', TTL, () => uhr.jetzt());
    const r = fuettere(m, BARS[1]!);
    expect(r.zustand).toBe('HALTED');
    expect(r.gueltig).toBe(false);
    expect(m.gesehen).toBe(1);
    const e = m.journal.alle().filter((x) => x.ereignis === 'lease_lost');
    expect(e.map((x) => x.art)).toEqual(['vorhaben', 'vollzogen']);
    expect(e[0]!.grund).toContain('VP-MCH-0003');
    // und es bleibt dabei
    fuettere(m, BARS[2]!);
    expect(m.gesehen).toBe(1);
    expect(m.journal.alle().filter((x) => x.ereignis === 'lease_lost')).toHaveLength(2);
  });
});

describe('D41 — zwei Maschinen, ein Scope', () => {
  it('die zweite bekommt keine Lease und erzeugt keine Signale', () => {
    const m1 = maschine(anschluss('m1'));
    const m2 = maschine(anschluss('m2'));
    m1.starte();
    m2.starte();
    expect(m1.zustand).toBe('WARMUP');
    expect(m2.zustand).toBe('HALTED');
    const r = fuettere(m2, BARS[0]!);
    expect(r.gueltig).toBe(false);
    expect(r.werte.size).toBe(0);
    expect(m2.gesehen).toBe(0);
    const grund = m2.journal.alle().find((x) => x.ereignis === 'lease_lost')?.grund;
    expect(grund).toContain('VP-MCH-0003');
    expect(grund).toContain('VP-REG-0015');
  });
});

describe('ohne Anschluss wie bisher', () => {
  it('keine Lease, kein lease_lost, die Maschine rechnet', () => {
    const m = maschine();
    m.starte();
    fuettere(m, BARS[0]!);
    expect(m.gesehen).toBe(1);
    expect(m.journal.alle().some((x) => x.ereignis === 'lease_lost')).toBe(false);
  });
});
