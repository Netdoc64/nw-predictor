import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MatrixFehler,
  eintragen,
  kollisionen,
  leaseErneuern,
  leaseErwerben,
  leaseFreigeben,
  zeileSchreiben,
  zeilen,
} from '@vp/registry';
import { CODES } from '@vp/errors';

let pfad: string;
let dir: string;
let t = 1_000;
const uhr = (): number => t;
const BTC = { venue: 'binance', symbol: 'BTCUSDT', timeframe: '1h', profil: 'default' };
const KEY = 'binance:BTCUSDT:1h:default';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-matrix-'));
  pfad = join(dir, 'matrix.json');
  t = 1_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe('Scope-Matrix §3.2 — Eintrag und Kollision (C37)', () => {
  it('normalisiert venue/profil und legt eine Zeile ohne Lease, abgeschaltet an', () => {
    const z = eintragen(pfad, { ...BTC, venue: ' Binance ', profil: 'Default' }, uhr);
    expect(z.scopeKey).toBe(KEY);
    expect(z).toMatchObject({ enabled: false, planHash: null, lease: null, state: 'IDLE', since: 1_000 });
    expect(zeilen(pfad)).toHaveLength(1);
  });

  it('meldet btcusdt gegen BTCUSDT als Kollision und legt nichts an', () => {
    eintragen(pfad, BTC, uhr);
    const vorher = readFileSync(pfad, 'utf8');
    expect(code(() => eintragen(pfad, { ...BTC, symbol: 'btcusdt' }, uhr))).toBe('VP-REG-0014');
    expect(readFileSync(pfad, 'utf8')).toBe(vorher);
  });

  it('gleicher Schluessel zweimal ist keine Kollision, sondern „schon vorhanden“', () => {
    eintragen(pfad, BTC, uhr);
    expect(code(() => eintragen(pfad, BTC, uhr))).toBe('VP-REG-0016');
  });

  it('anderer Timeframe oder anderes Profil ist ein anderer Markt', () => {
    eintragen(pfad, BTC, uhr);
    eintragen(pfad, { ...BTC, symbol: 'btcusdt', timeframe: '1m' }, uhr);
    eintragen(pfad, { ...BTC, symbol: 'btcusdt', profil: 'pilot' }, uhr);
    expect(zeilen(pfad)).toHaveLength(3);
  });

  it('kollisionen() findet eine von Hand entstandene Doppelung im Bestand', () => {
    expect(kollisionen(['a:BTCUSDT:1h:x', 'a:ETHUSDT:1h:x', 'a:btcusdt:1h:x'])).toEqual([
      { vorhanden: 'a:BTCUSDT:1h:x', neu: 'a:btcusdt:1h:x' },
    ]);
    expect(kollisionen(['a:BTCUSDT:1h:x'])).toEqual([]);
  });
});

describe('Scope-Matrix — Lease mit TTL (D41)', () => {
  beforeEach(() => {
    eintragen(pfad, BTC, uhr);
  });

  it('ohne Lease kein Schreiben der Zeile', () => {
    expect(code(() => zeileSchreiben(pfad, KEY, 'a', { enabled: true }, uhr))).toBe('VP-MCH-0003');
    expect(zeilen(pfad)[0]!.enabled).toBe(false);
  });

  it('mit eigener Lease wird geschrieben, fremder Halter scheitert', () => {
    leaseErwerben(pfad, KEY, 'a', 500, uhr);
    zeileSchreiben(pfad, KEY, 'a', { enabled: true, planHash: 'h1' }, uhr);
    expect(zeilen(pfad)[0]).toMatchObject({ enabled: true, planHash: 'h1' });
    expect(code(() => zeileSchreiben(pfad, KEY, 'b', { enabled: false }, uhr))).toBe('VP-MCH-0003');
    expect(zeilen(pfad)[0]!.enabled).toBe(true);
  });

  it('zweiter Bewerber scheitert laut, solange die Lease gilt', () => {
    leaseErwerben(pfad, KEY, 'a', 500, uhr);
    expect(code(() => leaseErwerben(pfad, KEY, 'b', 500, uhr))).toBe('VP-REG-0015');
    expect(zeilen(pfad)[0]!.lease).toEqual({ owner: 'a', expiresAt: 1_500 });
  });

  it('nach Ablauf (Uhr hineingereicht) kann ein anderer uebernehmen; der alte Halter schreibt nicht mehr', () => {
    leaseErwerben(pfad, KEY, 'a', 500, uhr);
    t = 1_500; // genau am Ablauf: gilt nicht mehr
    expect(code(() => zeileSchreiben(pfad, KEY, 'a', { enabled: true }, uhr))).toBe('VP-MCH-0003');
    leaseErwerben(pfad, KEY, 'b', 500, uhr);
    expect(zeilen(pfad)[0]!.lease).toEqual({ owner: 'b', expiresAt: 2_000 });
    expect(code(() => zeileSchreiben(pfad, KEY, 'a', { enabled: true }, uhr))).toBe('VP-MCH-0003');
  });

  it('erneuern verlaengert; eine abgelaufene Lease wird nicht wiederbelebt', () => {
    leaseErwerben(pfad, KEY, 'a', 500, uhr);
    t = 1_400;
    expect(leaseErneuern(pfad, KEY, 'a', 500, uhr).expiresAt).toBe(1_900);
    t = 1_900;
    expect(code(() => leaseErneuern(pfad, KEY, 'a', 500, uhr))).toBe('VP-MCH-0003');
    expect(code(() => leaseErneuern(pfad, KEY, 'b', 500, uhr))).toBe('VP-MCH-0003');
  });

  it('freigeben: nur der Halter; danach kann ein anderer erwerben', () => {
    leaseErwerben(pfad, KEY, 'a', 500, uhr);
    expect(code(() => leaseFreigeben(pfad, KEY, 'b', uhr))).toBe('VP-REG-0015');
    leaseFreigeben(pfad, KEY, 'a', uhr);
    expect(zeilen(pfad)[0]!.lease).toBeNull();
    leaseErwerben(pfad, KEY, 'b', 500, uhr);
  });

  it('unbekannter Scope und unsinnige TTL scheitern', () => {
    expect(code(() => leaseErwerben(pfad, 'binance:ETHUSDT:1h:default', 'a', 500, uhr))).toBe('VP-REG-0016');
    for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => leaseErwerben(pfad, KEY, 'a', ttl, uhr)).toThrow(RangeError);
    }
  });
});

describe('Scope-Matrix — Codes', () => {
  it('jeder gemeldete Code steht in der Code-Tabelle', () => {
    for (const c of ['VP-REG-0014', 'VP-REG-0015', 'VP-REG-0016', 'VP-MCH-0003']) {
      expect(Object.keys(CODES)).toContain(c);
    }
    expect(new MatrixFehler('VP-REG-0014', 'x').name).toBe('MatrixFehler');
  });
});
