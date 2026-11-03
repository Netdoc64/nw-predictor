# Abnahme der Meilensteine M3, M4, M8, M10

Diese Datei kartiert die offenen Meilensteine aus PLAN.md §10 auf ihre Kanten aus
§12. Eine Zeile ist nur dann `erledigt`, wenn es auf `main` einen Test dafür gibt.

**Regel:** Wer eine Zeile schließt, setzt Stand auf `erledigt`, trägt die PR-Nummer
und den Test als `Datei:Zeile` ein und nimmt die Kante in PLAN.md §14 „Gedeckt (mit
Test)" auf. Funde beim Bauen kommen zuerst als Zeile in §12, dann wird behoben.
Stand: `offen`, `erledigt` oder `Mensch` (nur mit Begründung in der Zeile).
`Bestand 5600274` heißt: schon im ersten Stand vorhanden, gegengeprüft.

Gegengeprüft gegen den Code, nicht aus §14 abgeschrieben: C34 und C37 stehen dort
als gedeckt, es gibt aber keinen Speicher-Test und keine Kollisionsmeldung.
Ein Schlüssel wird für keine Zeile gebraucht (Binance-Kerzen sind öffentlich);
es gibt daher keine Zeile mit Stand `Mensch`.

## M3

Registry horizontal.

| Kante | Was | PR | Stand |
| --- | --- | --- | --- |
| Scope-Matrix §3.2 | Scope-Matrix aus Registry-Zeilen (Venue × Symbol × Timeframe × Profil), je Zeile eigener Zustand | #5 | erledigt — packages/registry/tests/matrix.test.ts:41 |
| Fremdschreiber im Doppellauf | zwei Schreiber gegen dieselbe Datei: der zweite bricht laut ab (`VP-REG-0008`), nichts geht verloren — Code in `registry/speicher.ts`, aber kein Test |  | offen |
| C33 | `tmp` + `rename`, Hash-Prüfung beim Laden — Absturz-/Chaos-Test fehlt |  | offen |
| C34 | Inhalts-Hash vor dem Schreiben erneut prüfen, sonst laut abbrechen — §14 nennt es gedeckt; es gibt keinen Speicher-Test |  | offen |
| C37 | Normalisierung beim Eintrag, Kollision (`btcusdt` vs `BTCUSDT`) wird gemeldet — §14 nennt es gedeckt; Normalisierung getestet (kern.test.ts:68), Kollisionsmeldung jetzt gemeldet (`VP-REG-0014`) | #5 | erledigt — packages/registry/tests/matrix.test.ts:48 |
| D41 | Lease mit TTL je Scope, ohne Lease kein Schreiben | #5 | erledigt — packages/registry/tests/matrix.test.ts:80, :93 |
| D55 | Lease vor Ablauf erneuern; misslingt es, hält die Maschine selbst an |  | offen |

## M4

Feeds + `series`.

| Kante | Was | PR | Stand |
| --- | --- | --- | --- |
| A1 | intern nur `TimeMs`, Umrechnung nur im Treiber | Bestand 5600274 | erledigt — Test `tests/chart.test.ts:145` |
| A2 | alles UTC; Sessions aus `calendar` mit IANA-Zone |  | offen |
| A3 | Kalender kennt Nichthandelstage, dort ist Fehlen erwartet |  | offen |
| A4 | Whitespace statt Füllung über das FX-Wochenende |  | offen |
| A5 | Mikrosekunden auf ms abschneiden, nicht runden — Code in `feeds/normalisierung.ts`, kein Test mit Mikrosekunden |  | offen |
| A6 | Open-Zeit als Festlegung, jeder Feed-Treiber normalisiert darauf — Test je Treiber fehlt |  | offen |
| A7 | `anchor` gehört zur Timeframe-Definition und in den `nodeHash` |  | offen |
| A8 | Offset zur Venue-Uhr messen, Staleness gegen Venue-Zeit |  | offen |
| A9 | Zukunftsstempel ablehnen, `VP-FEED-0012` | Bestand 5600274 | erledigt — Test `tests/registry.test.ts:211` |
| A10 | Anzeige-Zeitzone nur im Adapter, Drift-Test: keine tz-Bibliothek in `compute` |  | offen |
| B11 | Duplikat: gleich ignorieren, abweichend ersetzen und zählen (`VP-FEED-0011`) | Bestand 5600274 | erledigt — Test `tests/registry.test.ts:187` |
| B12 | `reorderWindow`-Puffer, danach verwerfen + `VP-FEED-0021` — Einsortieren getestet (registry.test.ts:193), Fenster und Code 0021 fehlen |  | offen |
| B13 | `dataRevision` hochzählen, `replaceRange`, abhängige Knoten ab `t` invalidieren |  | offen |
| B14 | `adjust`-Transform, Adjust-Version im `nodeHash` |  | offen |
| B15 | `instrumentId` trägt die Identität, Alias-Historie |  | offen |
| B16 | `retire`, sichtbare Endkappe |  | offen |
| B17 | Lücke → `BACKFILL`, Lückenliste im Journal — Lückenerkennung getestet (registry.test.ts:199), `BACKFILL`-Anbindung im Feed offen |  | offen |
| B18 | Backoff + Jitter, Höchstzahl, dann `DEGRADED` |  | offen |
| B19 | ein Token-Bucket je Venue über alle Scopes |  | offen |
| B20 | `provisional: true`, nichts Provisorisches wird persistiert |  | offen |
| B21 | `volume: null` erlaubt, `needs-volume` wird nicht aufgelöst |  | offen |
| B22 | Preis ≤ 0 verwerfen bzw. Log-Skala auf linear — Code in `feeds/normalisierung.ts`, Test mit Preis 0 fehlt |  | offen |
| B23 | `precision`/`minMove` aus Instrument-Metadaten |  | offen |
| B24 | Ringpuffer `maxBars`, Historie nachladen |  | offen |
| B25 | Feed-Identität in `dataRevision`, Wechsel als Journal-Ereignis |  | offen |
| B26 | high/low/close unplausibel → Bar verwerfen, `VP-FEED-0031` | Bestand 5600274 | erledigt — Test `tests/registry.test.ts:205` |
| K119 | `redistribution`-Feld je `venue`, jeder Ausgabeweg prüft es |  | offen |
| Echter Venue (Kerzen) | öffentliche Marktdaten ohne Schlüssel (Binance-Kerzen), CSV-/Replay-Feed daneben; kein Schlüssel nötig |  | offen |

## M8

Modelle.

| Kante | Was | PR | Stand |
| --- | --- | --- | --- |
| D48 | Fallback-Kette in der Definition, ohne Fallback `DEGRADED` |  | offen |
| D49 | `NaN`/`Inf` am Modellausgang prüfen, Signal unterdrücken, `VP-MODEL-*` |  | offen |
| K112 | `artifactHash` steckt im `nodeHash` | Bestand 5600274 | erledigt — Test `tests/kern.test.ts:82` |
| K113 | Artefaktspeicher außerhalb, im Repo nur Hash und Herkunft |  | offen |
| K114 | jede `feature`-Definition deklariert ihren Zeitversatz, der Split prüft ihn |  | offen |
| K115 | nur zeitliche Splits, Regel im `model`-Vertrag |  | offen |
| K116 | Trainingsmanifest: Datensatz-Hash, Seed, Bibliotheksversionen, Commit |  | offen |
| K117 | `calibrated: bool` + Kalibrierungsbericht |  | offen |
| K118 | Abdeckungsbericht je Lauf, Mindestabdeckung als Guard |  | offen |
| K120 | Ausgabe = Wahrscheinlichkeit + Fehlerband, keine Handlungsempfehlung im Vertrag |  | offen |

## M10

MCP schreibend.

| Kante | Was | PR | Stand |
| --- | --- | --- | --- |
| G79 | schreibende Werkzeuge existieren nicht, wenn nicht freigeschaltet | Bestand 5600274 | erledigt — Test `packages/mcp/tests/mcp.test.ts:73` |
| Schreibpfad | schreibende Werkzeuge hinter Freischaltung: Entwurf und Aktivierung getrennt |  | offen |
| G83 | Fremdschreiber-Erkennung + `confirm`-Hash aus der Vorschau |  | offen |
| N143 | Flächen sind Registry-Definitionen: Entwurf, Aktivierung, Journal — nie Selbstbedienung |  | offen |
| N145 | `identitaet` in jedem Journal-Eintrag und an jedem Fehler |  | offen |
| N146 | Steuerbefehle über dieselbe Lease und denselben `confirm`-Hash; der zweite scheitert an der Version |  | offen |
