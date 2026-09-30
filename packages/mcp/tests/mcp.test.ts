import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpFlaeche } from '@vp/registry';
import {
  baueServer, darfWerkzeug, pruefeFlaeche, siehtScope, werkzeugliste, datentext,
  type Pruefstand,
} from '@vp/mcp';
import { bars, BTCUSDT, katalog, SCOPE, szenario } from '../../../tests/hilfe.ts';

// ─────────────────────────────────────────────────────────────────────────────
// MCP ueber das echte Protokoll — PLAN.md §7.
//
// Client und Server sprechen ueber den In-Memory-Transport des SDK miteinander:
// dieselben JSON-RPC-Nachrichten wie ueber stdio, nur ohne Prozessgrenze. Was
// hier eine Flaeche nicht sieht, sieht auch Claude nicht.
// ─────────────────────────────────────────────────────────────────────────────

const K = katalog();
const PRUEFSTAND: Pruefstand = {
  katalog: K,
  scopeKey: SCOPE,
  meta: BTCUSDT,
  bars: bars(600),
  quelle: 'Kunstreihe (Test)',
  szenario: (s) => szenario(s),
};

async function verbinde(flaecheId: string, ueberschreibe: Partial<McpFlaeche> = {}, jetzt?: () => number) {
  const flaeche = { ...K.flaechen.get(flaecheId)!, ...ueberschreibe };
  const { server, werkzeuge } = baueServer({ flaeche, pruefstand: PRUEFSTAND, ...(jetzt ? { jetzt } : {}) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, werkzeuge };
}

type Antwort = { kopf: { flaeche: string; gefiltert: boolean; hinweis: string }; daten: unknown };

async function rufe(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Array<{ type: string; text: string }>)[0]!.text;
  return { fehler: r.isError === true, text, json: r.isError ? null : (JSON.parse(text) as Antwort) };
}

describe('Die Registry der Flaechen', () => {
  it('liegt in registry/flaechen.json — genau eine Wurzel, gebundene Flaechen je Strategie', () => {
    const f = [...K.flaechen.values()];
    expect(f.filter((x) => x.wurzel)).toHaveLength(1);
    expect(f.filter((x) => x.strategie !== null).map((x) => x.strategie).sort()).toEqual(['ema-cross-v1', 'ema-cross-v2']);
    for (const x of f) expect(() => pruefeFlaeche(x)).not.toThrow();
  });
});

describe('Ausschnitt und Stufe — was eine Flaeche sieht', () => {
  it('die Wurzel sieht Vergleich und Flaechenliste', async () => {
    const { client } = await verbinde('wurzel');
    const namen = (await client.listTools()).tools.map((t) => t.name);
    expect(namen).toContain('vp_flaechen_list');
    expect(namen).toContain('vp_strategie_vergleich');
    expect(namen).toContain('vp_strategie_list');
  });

  it('eine gebundene Flaeche hat KEIN Vergleichswerkzeug — es existiert fuer sie nicht', async () => {
    const { client } = await verbinde('ema-cross-v1');
    const namen = (await client.listTools()).tools.map((t) => t.name);
    expect(namen).not.toContain('vp_strategie_vergleich');
    expect(namen).not.toContain('vp_strategie_list');
    expect(namen).not.toContain('vp_flaechen_list');
    expect(namen).toContain('vp_sim_run');
  });

  it('kein schreibendes Werkzeug auf einer lesenden Flaeche, auch wenn die Allowlist `vp_*` sagt', async () => {
    const { client } = await verbinde('wurzel');
    const namen = (await client.listTools()).tools.map((t) => t.name);
    for (const w of ['vp_registry_upsert', 'vp_registry_activate', 'vp_machine_command']) {
      expect(namen).not.toContain(w);
    }
  });

  it('jedes Werkzeug ist als nur lesend markiert', async () => {
    const { client } = await verbinde('wurzel');
    for (const t of (await client.listTools()).tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    }
  });

  it('eine Flaeche, die den Pruefstand nicht sieht, startet gar nicht erst', () => {
    const flaeche = { ...K.flaechen.get('ema-cross-v1')!, scopeMuster: ['binance:ETHUSDT:1h:*'] };
    expect(() => baueServer({ flaeche, pruefstand: PRUEFSTAND })).toThrow(/sieht den Pruefstand/);
  });
});

describe('Bindung — eine gebundene Flaeche sieht nur ihre Strategie', () => {
  it('rechnet ohne Angabe die eigene Strategie', async () => {
    const { client } = await verbinde('ema-cross-v1');
    const r = await rufe(client, 'vp_sim_run');
    expect(r.fehler).toBe(false);
    expect((r.json!.daten as { szenario: string }).szenario).toBe('erstlauf-ema-cross-v1');
  });

  it('verweigert die fremde Strategie — mit Hinweis auf die Wurzel', async () => {
    const { client } = await verbinde('ema-cross-v1');
    const r = await rufe(client, 'vp_sim_run', { strategie: 'ema-cross-v2' });
    expect(r.fehler).toBe(true);
    expect(r.text).toMatch(/VP-MCP-0001.*ausserhalb dieser Flaeche.*Wurzel/s);
  });

  it('jede Antwort sagt, aus welchem Ausschnitt sie stammt', async () => {
    const { client } = await verbinde('ema-cross-v1');
    const r = await rufe(client, 'vp_strategie_get');
    expect(r.json!.kopf.flaeche).toBe('ema-cross-v1');
    expect(r.json!.kopf.hinweis).toMatch(/Daten, keine Anweisungen/);
  });
});

describe('Strategische Unterschiede feststellen', () => {
  let antwort: Antwort;

  beforeAll(async () => {
    const { client } = await verbinde('wurzel');
    const r = await rufe(client, 'vp_strategie_vergleich', { a: 'ema-cross-v1', b: 'ema-cross-v2' });
    expect(r.fehler, r.text).toBe(false);
    antwort = r.json!;
  });

  it('Ebene 1 nennt das Profil als Unterschied', () => {
    const d = antwort.daten as { ebene1_struktur: Array<{ pfad: string }> };
    expect(d.ebene1_struktur.map((x) => x.pfad)).toContain('profil');
  });

  it('Ebene 4 findet den ATR-Knoten — ueber das Protokoll, nicht nur im Code', () => {
    const d = antwort.daten as { ebene4_zuordnung: { knoten: string } | null };
    expect(d.ebene4_zuordnung?.knoten).toBe('atr');
  });

  it('nennt keinen Sieger', () => {
    expect(JSON.stringify(antwort.daten)).toMatch(/kein Sieger/);
    expect(JSON.stringify(antwort.daten)).not.toMatch(/empfehl(e|ung)\b.*kauf/i);
  });

  it('die Kette hinter einem Beleg ist ueber das Protokoll abrufbar', async () => {
    const { client } = await verbinde('ema-cross-v2');
    const liste = await rufe(client, 'vp_beleg_list', { limit: 1 });
    const erster = (liste.json!.daten as { belege: Array<{ belegId: string }> }).belege[0]!;
    const kette = await rufe(client, 'vp_kette_get', { belegId: erster.belegId });
    const glieder = (kette.json!.daten as { glieder: Array<{ knoten: string }> }).glieder;
    expect(glieder.some((g) => g.knoten === 'reihe')).toBe(true);
    expect(glieder.some((g) => g.knoten === 'atr')).toBe(true);
  });

  it('der Chart-Plan einer Strategie kommt aus der Registry-Bindung', async () => {
    const { client } = await verbinde('ema-cross-v1');
    const r = await rufe(client, 'vp_chart_spec');
    const layer = r.json!.daten as Array<{ knoten: string; art: string }>;
    expect(layer.map((l) => `${l.knoten}:${l.art}`)).toContain('atr:line');
  });
});

describe('Budgets und Grenzen', () => {
  it('das Simulationsbudget zaehlt echte Rechnungen, nicht Wiederholungen aus dem Speicher', async () => {
    let t = 0;
    const { client } = await verbinde('wurzel', { budget: { simLaeufeProStunde: 2, antwortBytes: 120_000 } }, () => t);
    expect((await rufe(client, 'vp_sim_run', { strategie: 'null-v1' })).fehler).toBe(false);
    expect((await rufe(client, 'vp_sim_run', { strategie: 'null-v1' })).fehler).toBe(false); // Speicher
    expect((await rufe(client, 'vp_sim_run', { strategie: 'buyhold-v1' })).fehler).toBe(false);
    const drittes = await rufe(client, 'vp_sim_run', { strategie: 'ema-cross-v1' });
    expect(drittes.fehler).toBe(true);
    expect(drittes.text).toMatch(/VP-MCP-0002/);

    t += 3_600_001; // eine Stunde spaeter
    expect((await rufe(client, 'vp_sim_run', { strategie: 'ema-cross-v1' })).fehler).toBe(false);
  });

  it('eine zu grosse Antwort wird verweigert, nicht abgeschnitten', async () => {
    const { client } = await verbinde('wurzel', { budget: { simLaeufeProStunde: 40, antwortBytes: 400 } });
    const r = await rufe(client, 'vp_registry_list');
    expect(r.fehler).toBe(true);
    expect(r.text).toMatch(/zu gross.*limit\/cursor/);
  });

  it('ohne dependency-map sagt das Werkzeug, woher man sie bekommt', async () => {
    const { client } = await verbinde('wurzel');
    const r = await rufe(client, 'vp_codemap_query', { name: 'resolve' });
    expect(r.fehler).toBe(true);
    expect(r.text).toMatch(/fetch-dep-map/);
  });
});

describe('Der Ausschnitt als Funktion', () => {
  const lesend = K.flaechen.get('ema-cross-v1')!;

  it('Allowlist mit Platzhaltern', () => {
    expect(siehtScope(lesend, 'binance:BTCUSDT:1h:default')).toBe(true);
    expect(siehtScope(lesend, 'binance:ETHUSDT:1h:default')).toBe(false);
  });

  it('Stufen', () => {
    const alle = { ...lesend, werkzeugMuster: ['vp_*'] };
    expect(darfWerkzeug(alle, 'vp_registry_upsert')).toBe(false);
    expect(darfWerkzeug({ ...alle, stufe: 'vorschlagend' }, 'vp_registry_upsert')).toBe(true);
    expect(darfWerkzeug({ ...alle, stufe: 'vorschlagend' }, 'vp_machine_command')).toBe(false);
    expect(darfWerkzeug({ ...alle, stufe: 'steuernd' }, 'vp_machine_command')).toBe(true);
    expect(werkzeugliste(alle, ['vp_sim_run', 'vp_machine_command'])).toEqual(['vp_sim_run']);
  });

  it('Netz ohne Auth, leere Allowlist, keine Werkzeuge — alles nicht startbar', () => {
    expect(() => pruefeFlaeche({ ...lesend, transport: { art: 'netz', auth: '' } })).toThrow();
    expect(() => pruefeFlaeche({ ...lesend, scopeMuster: [] })).toThrow();
    expect(() => pruefeFlaeche({ ...lesend, werkzeugMuster: [] })).toThrow();
  });

  it('Registry-Texte verlieren Steuer- und Richtungszeichen', () => {
    expect(datentext('ok‮gefaehrlich ')).toBe('okgefaehrlich');
  });
});
