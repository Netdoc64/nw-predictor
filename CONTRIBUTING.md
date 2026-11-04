# Mitwirken

Danke, dass du hier bist. Dieses Dokument sagt, wie eine Änderung durchkommt —
und warum manches anders läuft, als man es gewohnt ist.

> **Die Sprache des Projekts ist Deutsch**, in Code-Kommentaren, Tests und
> Plan. Eine englische Beschreibung oder PR ist trotzdem willkommen; sie wird
> nicht abgewiesen, nur weil sie englisch ist.

## In einer Minute

```bash
pnpm install
pnpm test        # 169 Tests
pnpm run lint
pnpm run typecheck
```

Alle drei müssen grün sein. Node 24 oder neuer, pnpm 8.

## Was eine gute Änderung hier ausmacht

Dieses Projekt rechnet mit Geld und mit Entscheidungen, die auf Geld wirken.
Entsprechend gelten drei Dinge, die anderswo Geschmacksfragen sind:

| Regel | Warum |
| --- | --- |
| **Eine Regel kommt mit ihrem Wächter** | Ein Verbot im Plan, das kein Test prüft, ist eine Notiz. `tests/lint.drift.test.ts` ist das Muster: es prüft nicht die Konfiguration, sondern das Verhalten. |
| **Kein Fließkomma für Preise, Mengen, Geld** | `0.1 + 0.2 !== 0.3` fällt erst auf, wenn die Summe der Belege nicht mehr zum Kontostand passt — und dann weiß niemand mehr, welcher von 4.000 Fills es war. Festkomma liegt in `@vp/core-ids`. |
| **Keine Wanduhr, kein ungesäter Zufall im Rechenweg** | Die Simulation muss dieselbe Rechnung fahren wie der Live-Betrieb. ESLint verbietet `Date.now()` und `Math.random()` in `compute`, `trading`, `machine`, `sim`. Die Uhr wird hineingereicht. |

Kommentare erklären das **Warum**, nicht das Was. Am liebsten mit Beleg: „so ist
es am … schiefgegangen" ist mehr wert als „wichtig".

## Der Weg einer Änderung

1. **Zweig** von `main`, benannt nach der Sache: `fix/…`, `feat(bereich)/…`,
   `docs/…`.
2. **Test daneben.** Ein Fix ohne Test, der vorher rot war, ist eine Behauptung.
3. **PR öffnen.** Die Beschreibung nennt die Kante aus [PLAN.md](PLAN.md), wenn
   es eine gibt (`§12/L121` und so weiter).
4. **CI** läuft: Typecheck, Lint, Tests. Rot heißt rot.

## Warum dein PR vielleicht wartet

Dieses Repo hat ein **Merge-Gate**. Es entscheidet nach dem, was eine Änderung
berührt — nicht danach, wer sie geschrieben hat:

| Berührt | Folge |
| --- | --- |
| Geld- und Belegpfade, Prognosen, Verträge (Registry, Adressen), Zugänge | ein Mensch merged, auch bei grüner CI |
| `.github/` | ein Mensch merged |
| viele Zeilen auf einmal | zusätzliche Prüfung |
| alles andere mit grüner CI | kann autonom durchgehen |

Das ist keine Geringschätzung deiner Arbeit, sondern eine Eigenschaft des
Gegenstands: an diesen Stellen ist ein stiller Fehler teuer, und eine grüne
CI beweist nicht, dass eine Zahl stimmt.

Ein PR aus einem Fork läuft außerdem immer auf GitHub-Runnern, nie auf einer
privaten Maschine. Das ist Absicht.

## Was hier nicht hineingehört

- **Orderausführung.** Kein Broker-Anschluss, auch nicht „nur Paper" gegen eine
  echte Börse. Die Simulation rechnet Fills selbst, gegen ein Modell, ohne jede
  Verbindung nach draußen. Siehe [PLAN.md](PLAN.md) §13.
- **Anlageberatung** oder Strategien, die als Empfehlung auftreten.
- **Marktdaten im Repo.** Sie gehören dem Handelsplatz; `daten/` ist
  gitignoriert.
- **Geheimnisse.** Keine Schlüssel, Tokens oder Zugangsdaten, auch nicht als
  Beispiel.

## Fehler gefunden?

Ein Sicherheitsproblem **nicht** als Issue melden — der Weg steht in
[SECURITY.md](SECURITY.md).

Alles andere gern als Issue. Am meisten hilft: was du erwartet hast, was
passiert ist, und wie man es wieder herstellt.
