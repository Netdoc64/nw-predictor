import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { journal, type McpFlaeche } from '@vp/registry';
import { baueServer, type Pruefstand } from '@vp/mcp';
import { bars, BTCUSDT, katalog, SCOPE, szenario } from '../../../tests/hilfe.ts';

// Schreibende Werkzeuge ueber das echte Protokoll — PLAN.md §12/G79 G83 N143 N145.

const K = katalog();
const PRUEFSTAND: Pruefstand = {
  katalog: K, scopeKey: SCOPE, meta: BTCUSDT, bars: bars(600), quelle: 'Kunstreihe (Test)', szenario: (s) => szenario(s),
};

const ordner: string[] = [];
afterEach(() => { while (ordner.length) rmSync(ordner.pop()!, { recursive: true, force: true }); });

function wurzel(): string {
  const d = mkdtempSync(join(tmpdir(), 'vp-schreiben-'));
  ordner.push(d);
  return d;
}

async function verbinde(stufe: McpFlaeche['stufe'], revisionenWurzel: string | undefined, id = 'ema-cross-v1') {
  const flaeche: McpFlaeche = {
    ...K.flaechen.get('ema-cross-v1')!, id, identitaet: `${id}@nw-predictor`, stufe,
    werkzeugMuster: ['vp_*'],
  };
  const { server } = baueServer({ flaeche, pruefstand: PRUEFSTAND, ...(revisionenWurzel ? { revisionenWurzel } : {}) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, identitaet: flaeche.identitaet };
}

async function rufe(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Array<{ text: string }>)[0]!.text;
  const daten = r.isError ? null : (JSON.parse(text) as { daten: Record<string, unknown> }).daten;
  return { fehler: r.isError === true, text, daten };
}

const ENTWURF = { urn: 'urn:vp:test:x', kind: 'indicator' };
const upsertArgs = { art: 'definition', schluessel: 'x', inhalt: ENTWURF };

describe('G79 — Stufe bestimmt, ob schreibende Werkzeuge existieren', () => {
  it('lesend: weder upsert noch activate in der Liste', async () => {
    const { client } = await verbinde('lesend', wurzel());
    const namen = (await client.listTools()).tools.map((t) => t.name);
    expect(namen).not.toContain('vp_registry_upsert');
    expect(namen).not.toContain('vp_registry_activate');
  });

  it('vorschlagend: upsert ja, activate nein', async () => {
    const { client } = await verbinde('vorschlagend', wurzel());
    const namen = (await client.listTools()).tools.map((t) => t.name);
    expect(namen).toContain('vp_registry_upsert');
    expect(namen).not.toContain('vp_registry_activate');
  });

  it('steuernd: beide, readOnlyHint false; lesende bleiben readOnlyHint true', async () => {
    const { client } = await verbinde('steuernd', wurzel());
    const t = (await client.listTools()).tools;
    for (const x of t) {
      const schreibend = x.name === 'vp_registry_upsert' || x.name === 'vp_registry_activate';
      expect(x.annotations?.readOnlyHint, x.name).toBe(!schreibend);
    }
    expect(t.map((x) => x.name)).toEqual(expect.arrayContaining(['vp_registry_upsert', 'vp_registry_activate']));
  });

  it('ohne Revisionen-Wurzel gibt es sie nicht, auch nicht auf steuernder Stufe', async () => {
    const { client } = await verbinde('steuernd', undefined);
    const namen = (await client.listTools()).tools.map((x) => x.name);
    expect(namen).not.toContain('vp_registry_upsert');
  });

  it('kein Order-Werkzeug', async () => {
    const { client } = await verbinde('steuernd', wurzel());
    for (const t of (await client.listTools()).tools) expect(t.name).not.toMatch(/order|trade|buy|sell|handel/i);
  });
});

describe('Entwurf und Aktivierung getrennt', () => {
  it('upsert schreibt nur einen Entwurf und liefert Vorschau und confirm', async () => {
    const w = wurzel();
    const { client } = await verbinde('steuernd', w);
    const r = await rufe(client, 'vp_registry_upsert', upsertArgs);
    expect(r.fehler, r.text).toBe(false);
    expect(r.daten).toMatchObject({ revision: 1, aktiviert: false, vorschau: { aktiv: null } });
    expect(r.daten!['confirm']).toMatch(/^[0-9a-f]{16,}$/);
    expect(journal(w, 'definition', 'x').map((e) => e.aktion)).toEqual(['entwurf']);
  });

  it('activate mit dem confirm aus der Vorschau setzt die Revision aktiv', async () => {
    const w = wurzel();
    const { client } = await verbinde('steuernd', w);
    const u = await rufe(client, 'vp_registry_upsert', upsertArgs);
    const a = await rufe(client, 'vp_registry_activate', { art: 'definition', schluessel: 'x', revision: 1, confirm: u.daten!['confirm'] });
    expect(a.fehler, a.text).toBe(false);
    expect(a.daten).toMatchObject({ aktiv: 1 });
    expect(journal(w, 'definition', 'x').map((e) => e.aktion)).toEqual(['entwurf', 'aktivierung']);
  });

  it('activate mit falschem confirm scheitert, nichts wird aktiviert', async () => {
    const w = wurzel();
    const { client } = await verbinde('steuernd', w);
    await rufe(client, 'vp_registry_upsert', upsertArgs);
    const r = await rufe(client, 'vp_registry_activate', { art: 'definition', schluessel: 'x', revision: 1, confirm: 'falsch' });
    expect(r.fehler).toBe(true);
    expect(r.text).toMatch(/VP-REG-0010/);
    expect(journal(w, 'definition', 'x').map((e) => e.aktion)).toEqual(['entwurf']);
  });

  it('activate ohne confirm wird vom Schema abgewiesen', async () => {
    const w = wurzel();
    const { client } = await verbinde('steuernd', w);
    await rufe(client, 'vp_registry_upsert', upsertArgs);
    const r = await rufe(client, 'vp_registry_activate', { art: 'definition', schluessel: 'x', revision: 1 });
    expect(r.fehler).toBe(true);
    expect(journal(w, 'definition', 'x').map((e) => e.aktion)).toEqual(['entwurf']);
  });
});

describe('G83 — zwei Agenten, der zweite scheitert am confirm-Hash', () => {
  it('A holt die Vorschau, B schreibt dazwischen: der confirm von A gilt nicht mehr', async () => {
    const w = wurzel();
    const a = await verbinde('steuernd', w, 'agent-a');
    const b = await verbinde('steuernd', w, 'agent-b');
    const ua = await rufe(a.client, 'vp_registry_upsert', upsertArgs);
    await rufe(b.client, 'vp_registry_upsert', { ...upsertArgs, inhalt: { ...ENTWURF, kind: 'decision' } });
    const r = await rufe(a.client, 'vp_registry_activate', { art: 'definition', schluessel: 'x', revision: 1, confirm: ua.daten!['confirm'] });
    expect(r.fehler).toBe(true);
    expect(r.text).toMatch(/VP-REG-0010/);
    expect(journal(w, 'definition', 'x').some((e) => e.aktion === 'aktivierung')).toBe(false);
  });
});

describe('N145 — Urheber ist die Identitaet der Flaeche', () => {
  it('steht in jedem Journal-Eintrag, auch wenn der Aufrufer einen anderen behauptet', async () => {
    const w = wurzel();
    const { client, identitaet } = await verbinde('steuernd', w, 'agent-a');
    const u = await rufe(client, 'vp_registry_upsert', { ...upsertArgs, urheber: 'jemand-anders' });
    await rufe(client, 'vp_registry_activate', { art: 'definition', schluessel: 'x', revision: 1, confirm: u.daten!['confirm'] });
    const eintraege = journal(w, 'definition', 'x');
    expect(eintraege).toHaveLength(2);
    for (const e of eintraege) expect(e.urheber).toBe(identitaet);
  });
});

describe('N143 — eine Flaeche aendert ihre eigene Definition nicht', () => {
  it('upsert der eigenen Flaechen-Definition wird abgewiesen und nichts geschrieben', async () => {
    const w = wurzel();
    const { client } = await verbinde('steuernd', w, 'agent-a');
    const eigene = { id: 'agent-a', identitaet: 'agent-a@nw-predictor', stufe: 'steuernd' };
    const r = await rufe(client, 'vp_registry_upsert', { art: 'flaeche', schluessel: 'agent-a', inhalt: eigene });
    expect(r.fehler).toBe(true);
    expect(r.text).toMatch(/VP-REG-0012/);
    expect(journal(w, 'flaeche', 'agent-a')).toHaveLength(0);
  });

  it('eine fremde Flaechen-Definition darf sie entwerfen', async () => {
    const w = wurzel();
    const { client } = await verbinde('steuernd', w, 'agent-a');
    const fremde = { id: 'agent-b', identitaet: 'agent-b@nw-predictor', stufe: 'lesend' };
    const r = await rufe(client, 'vp_registry_upsert', { art: 'flaeche', schluessel: 'agent-b', inhalt: fremde });
    expect(r.fehler, r.text).toBe(false);
  });
});
