// Hilfsprozess des Doppellauf-Tests: liest die Datei, wartet auf den
// gemeinsamen Startzeitpunkt und schreibt dann seine Kennung hinein.
// Aufruf: node --experimental-strip-types schreiber.ts <pfad> <kennung> <startDatei>
// Ausgabe (eine Zeile JSON): { kennung, ergebnis: 'ok' | <Fehlercode> }
import { existsSync, writeFileSync } from 'node:fs';
import { lies, schreib } from '../../src/speicher.ts';

const [pfad, kennung, startDatei] = process.argv.slice(2) as [string, string, string];

const gelesen = lies<{ stand: string[] }>(pfad);
writeFileSync(`${startDatei}.bereit-${kennung}`, '');
while (!existsSync(startDatei)) {
  /* Spinwarten bis das Startsignal da ist: beide Prozesse schreiben im selben Augenblick */
}
let ergebnis = 'ok';
try {
  schreib(pfad, { stand: [...gelesen.wert.stand, kennung] }, gelesen.abdruck);
} catch (e) {
  ergebnis = (e as { code?: string }).code ?? 'unbekannt';
}
process.stdout.write(`${JSON.stringify({ kennung, ergebnis })}\n`);
