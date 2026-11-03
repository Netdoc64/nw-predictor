// Hilfsprozess des Doppellauf-Tests: liest die Datei, wartet auf den
// gemeinsamen Startzeitpunkt und schreibt dann seine Kennung hinein.
// Aufruf: node --experimental-strip-types schreiber.ts <pfad> <kennung> <startMs>
// Ausgabe (eine Zeile JSON): { kennung, ergebnis: 'ok' | <Fehlercode> }
import { lies, schreib } from '../../src/speicher.ts';

const [pfad, kennung, startMs] = process.argv.slice(2) as [string, string, string];

const gelesen = lies<{ stand: string[] }>(pfad);
while (Date.now() < Number(startMs)) {
  /* Spinwarten: beide Prozesse sollen im selben Augenblick schreiben */
}
let ergebnis = 'ok';
try {
  schreib(pfad, { stand: [...gelesen.wert.stand, kennung] }, gelesen.abdruck);
} catch (e) {
  ergebnis = (e as { code?: string }).code ?? 'unbekannt';
}
process.stdout.write(`${JSON.stringify({ kennung, ergebnis })}\n`);
