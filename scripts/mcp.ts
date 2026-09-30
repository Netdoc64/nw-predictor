import { join } from 'node:path';
import { starteStdio } from '@vp/mcp';
import { ladePruefstand, WURZEL } from './pruefstand.ts';

// ─────────────────────────────────────────────────────────────────────────────
// MCP-Einstieg — eine Flaeche je Prozess.
//
//   node --experimental-strip-types scripts/mcp.ts --flaeche wurzel
//   node --experimental-strip-types scripts/mcp.ts --flaeche ema-cross-v1
//
// Mehrere Flaechen sind mehrere Prozesse. Das ist Absicht: jede hat ihr eigenes
// Budget, ihren eigenen Absturz und ihre eigene Identitaet — eine kaputte
// Flaeche nimmt die anderen nicht mit (PLAN.md §12/N154).
//
// ACHTUNG: stdout gehoert dem Protokoll. Jede Ausgabe dorthin zerbricht die
// Verbindung — Meldungen gehen nach stderr.
// ─────────────────────────────────────────────────────────────────────────────

const i = process.argv.indexOf('--flaeche');
const id = i >= 0 ? process.argv[i + 1] : undefined;

const pruefstand = ladePruefstand();

if (!id) {
  const vorhanden = [...pruefstand.katalog.flaechen.keys()].join(', ');
  process.stderr.write(`--flaeche fehlt. Vorhanden: ${vorhanden}\n`);
  process.exit(2);
}

const flaeche = pruefstand.katalog.flaechen.get(id);
if (!flaeche) {
  process.stderr.write(`Flaeche unbekannt: ${id}. Vorhanden: ${[...pruefstand.katalog.flaechen.keys()].join(', ')}\n`);
  process.exit(2);
}
const { werkzeuge } = await starteStdio({
  flaeche,
  pruefstand,
  dependencyMap: join(WURZEL, 'dependency-map.json'),
});

process.stderr.write(`nw-predictor MCP · Flaeche ${id} · ${werkzeuge.length} Werkzeuge · ${pruefstand.quelle}\n`);
