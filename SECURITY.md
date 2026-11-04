# Sicherheit

## Eine Schwachstelle melden

**Nicht als Issue.** Ein öffentliches Issue verrät die Lücke allen, bevor sie
geschlossen ist.

Stattdessen: [**private Meldung über GitHub**](https://github.com/Netdoc64/nw-predictor/security/advisories/new)
(Reiter *Security* → *Report a vulnerability*). Der Weg ist für dieses Repo
eingeschaltet, geht direkt an den Betreiber und bleibt bis zur Veröffentlichung
unter Verschluss.

Hilfreich ist: was passiert, wie man es wieder herstellt, und was ein Angreifer
davon hätte. Eine Antwort kommt in der Regel innerhalb einer Woche; ein fester
Zeitplan wird nicht versprochen — dieses Projekt wird nebenher gepflegt, und
eine Zusage, die nicht gehalten wird, ist schlechter als keine.

## Was dieses Projekt tun kann — und was nicht

Das gehört zur Einschätzung jeder Meldung:

| | |
| --- | --- |
| **Keine Orderausführung** | Es gibt keinen Broker-Anschluss, keinen Order-Pfad, kein Handelskonto. Fills entstehen aus einem Modell, gegen Daten auf der Platte. Eine Lücke hier kostet kein Geld an einer Börse. |
| **Keine fremden Geheimnisse** | Das Repo führt keine Schlüssel. Venue-Zugänge, soweit überhaupt nötig, liegen außerhalb. |
| **Marktdaten sind öffentlich** | Der erste Lauf holt öffentliche Kerzen ohne Anmeldung. |
| **Was es rechnet, ist eine Behauptung über Vergangenes** | Kein Ergebnis dieses Projekts ist eine Zusage über künftige Erträge. |

Das heißt nicht, dass es hier nichts zu finden gäbe. Interessant sind
besonders:

- Wege, über die Fremdcode zur Ausführung kommt — etwa über eine PR, über
  `postinstall` einer Abhängigkeit oder über den MCP-Server
- Wege, auf denen die MCP-Flächen mehr zeigen, als ihr Ausschnitt erlaubt
- Eingaben, die den Prüfweg umgehen: Registry-Texte, die als Anweisung gelesen
  werden statt als Daten
- Alles, was dazu führt, dass ein Beleg etwas anderes sagt als die Rechnung

## Unterstützte Stände

Gepflegt wird der Hauptzweig. Ältere Stände bekommen keine Rückportierung.
