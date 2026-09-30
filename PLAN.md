# nw-predictor — Plan

> **Was das hier ist.** Der Bauplan für einen Trading-Predictor, dessen Rechenwege
> nicht im Code verdrahtet, sondern in einer **Registry** stehen — vertikal
> (was baut auf was auf) und horizontal (für welche Märkte läuft es). Eine
> **Maschine** je Markt fährt den Lebenszyklus; dieselbe Maschine mit einem
> `replay`-Feed ist die **Simulation**, die aus Signalen eine **Entscheidung**
> macht, sie gegen ein Kostenmodell ausführt, den **Gewinn** rechnet und die
> ganze **Rechenkette zur Vermerkung** aufbewahrt. Ein **Adapter** verknüpft die
> Registry-Knoten mit den Charts, ein **zentraler Error-Tracker** ist die einzige
> Stelle, an der Fehler gezählt werden — und zugleich der Wächter, der eine
> Maschine anhält. Darüber liegt eine **Registry von MCP-Flächen**: mehrere
> Server aus einem Kern, je einer für eine Strategie, damit sich **strategische
> Unterschiede** nicht nur behaupten, sondern bis zur ersten abweichenden
> Entscheidung zurückverfolgen lassen. Dazu der Import der geteilten
> Werkzeuge aus einer gemeinsamen Quelle.
>
> Stand: 2026-09-16 · Status: Entwurf, noch kein Code

---

## 0. Entschiedenes und Angenommenes

| Frage | Entscheidung | Folge für den Plan |
| --- | --- | --- |
| Ort | **Neues Repo** `nw-predictor`, pnpm-Monorepo | eigene CI, eigener Eintrag in der Verteilliste |
| Stack | **Node/TypeScript**, ESM, strict | Modellkern optional als Python-Sidecar hinter HTTP |
| Maschine | **Zustandsmaschine je (Symbol × Timeframe)** | Lebenszyklus explizit, der Rechen-DAG steckt in `LIVE` |
| Charts | **chart-agnostisch, zwei Treiber** (Lightweight Charts + ECharts) | das neutrale Layer-Modell ist der Vertrag, nicht eine Bibliothek |
| Simulation | **dieselbe Maschine**, nur mit `replay`-Feed, Sim-Uhr und Fill-Modell | kein zweiter Code-Pfad; `decision`/`execution`/`position`/`pnl` sind reguläre Registry-Ebenen (§3.1) |
| Nachweis | jede Entscheidung trägt ihre **Rechenkette** | §4.8 — ohne sie ist eine Gewinnzahl eine Behauptung |
| MCP | **Registry von Flächen**, mehrere Server aus einem Kern | §7 — eine Fläche je Strategie, plus eine Wurzel, die sie auflistet |
| Dritte Achse | **Strategie** als eigenes Objekt mit eigenem Hash | §3.5 — ohne sie ist „Strategie" nur ein Profilname und kein Unterschied messbar |
| Offene Fragen | **keine** — alles Entscheidbare ist in §15 entschieden, mit Umkehrmerkmal | was offen bleibt, entscheidet beim Bauen der, der gerade tippt |
| Umfang | Vollplan **mit Kanten-Register** (§12) | die Kanten sind der Teil, der später Geld spart |

**Annahmen**, die kippen können und dann hier geändert werden:

| # | Annahme | Was bricht, wenn sie falsch ist |
| --- | --- | --- |
| V1 | Ein Node-Prozess trägt ~200 Maschinen | Scheduler (§4.5) müsste über mehrere Prozesse skalieren, Lease (§12/D41) wird zur Pflicht statt zur Vorsorge |
| V2 | Die Venues liefern OHLCV-Bars, nicht nur Ticks | `series` müsste aus Ticks selbst aggregieren — Knoten existiert, aber Warmup und Determinismus ändern sich |
| V3 | Der Predictor **sagt vorher, er handelt nicht** | siehe §13 — es gibt bewusst keinen Order-Pfad |
| V4 | Venue-Schlüssel kommen aus dem **Business Manager**, nie aus einer Datei im Repo | §9.4 |

---

## 1. Das Bild

```
                        ┌───────────────────────────────────────────┐
   VERTIKAL             │            R E G I S T R Y                 │        HORIZONTAL
   „was baut worauf"    │                                            │  „für welchen Markt, wie viele"
                        │  Definitionen (versioniert,                │
  venue                 │  inhaltsadressiert)       Profile          │  binance:BTCUSDT:1m:default
   └ feed               │        │                    │              │  binance:ETHUSDT:1m:default
      └ series          │        └── resolve(profil, scope) ─────────┼─► xetra:SAP:1d:swing
         └ transform    │                    │                       │  …
            └ indicator │                    ▼                       │
               └ feature│                P L A N  (DAG)              │  je Zeile eine
                  └ model│                   │                       │  M A S C H I N E
                     └ signal                │                       │  IDLE→WARMUP→LIVE→…
                      └ decision             │                       │
                       └ execution           │                       │  dieselbe Maschine mit
                        └ position           │                       │  replay-Feed + Sim-Uhr
                         └ pnl               │                       │  = S I M U L A T I O N
                          └ layer ───────────┼───────────────────────┘
                        └────────────────────┼──────────────────────┘
                                             ▼
                        ┌────────────────────────────────┐
                        │      C H A R T - A D A P T E R  │  neutrale LayerSpec + Patch-Protokoll
                        └───────┬────────────────┬───────┘
                                ▼                ▼
                        lightweight-Treiber   echarts-Treiber

         ╔════════════════════════════════════════════════════════════════╗
         ║  E R R O R - T R A C K E R  —  jede Kante meldet hierher,       ║
         ║  und nur von hier kommt das Signal, das eine Maschine anhält.   ║
         ╚════════════════════════════════════════════════════════════════╝
                                    ▲
   ┌────────────────────────────────┴───────────────────────────────────┐
   │   M C P — R E G I S T R Y   der Flächen (§7)                        │
   │   wurzel (listet auf) · scalp-lesend · swing-lesend · mensch-steuernd│
   │   je Fläche: eigener Ausschnitt, eigene Identität, eigenes Budget    │
   │   → Ebene 1 Struktur · 2 Verhalten · 3 Ergebnis · 4 ZUORDNUNG        │
   └─────────────────────────────────────────────────────────────────────┘
```

Die **eine Regel**, aus der alles Übrige folgt: *Eine Berechnung existiert genau
einmal — als Definition in der vertikalen Registry. Alles andere ist eine Instanz
davon in einem Scope.* Wer eine zweite EMA-Implementierung anlegt, statt die
vorhandene mit anderen Parametern zu binden, hat das System verlassen.

---

## 2. Namen, Adressen, Hashes

Ohne gemeinsame Adresse sprechen Registry, Maschine, Chart, Fehler und MCP über
verschiedene Dinge mit denselben Wörtern. Deshalb steht das **vor** allem anderen.

### 2.1 Scope — die horizontale Adresse

```
ScopeKey := <venue>:<symbol>:<timeframe>:<profile>
Beispiel:   binance:BTCUSDT:1m:default
```

| Feld | Normalform | Warum genau so |
| --- | --- | --- |
| `venue` | kleingeschrieben, `[a-z0-9_-]` | Venue-Namen sind unsere, nicht die des Marktes |
| `symbol` | **wie der Venue es schreibt**, unverändert | jede Umschrift ist eine Fehlerquelle; Aliase stehen in der Registry |
| `timeframe` | `1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d 1w 1M` | nie `60`, nie `1min` — eine Schreibweise, sonst zwei Caches für dieselbe Reihe |
| `profile` | kleingeschrieben | benannter Satz Definitionen: `default`, `scalp`, `swing` |

Dazu **`instrumentId`** — eine hausinterne, stabile Kennung, an der Umbenennungen
hängen. Der ScopeKey ist die Anzeige- und Cache-Adresse, `instrumentId` die
Wahrheit über „dasselbe Instrument" (§12/B15).

### 2.2 URN — die vertikale Adresse

```
Definition:  vp://<kind>/<ns>/<name>@<semver>
             vp://indicator/core/ema@2.1.0

Instanz:     vp://<kind>/<ns>/<name>@<semver>#<scopeKey>/<nodeHash8>
             vp://indicator/core/ema@2.1.0#binance:BTCUSDT:1m:default/9f3ac1b2
```

### 2.3 nodeHash — Identität einer Berechnung

```
nodeHash = blake3( defUrn ‖ canon(params) ‖ sort(inputNodeHashes)
                   ‖ dataRevision ‖ artifactHash ‖ codeGeneration )
```

Er ist zugleich **Cache-Schlüssel**, **Dedupe-Schlüssel** (zwei Layer mit
identischer EMA teilen eine Rechnung) und **Farbschlüssel** im Chart (§5.5).

Drei der sechs Bestandteile sind genau die, die man beim ersten Anlauf vergisst:

| Bestandteil | Was es abdeckt | Was ohne ihn passiert |
| --- | --- | --- |
| `dataRevision` | Bar-Korrekturen, Splits, Feed-Wechsel | der Cache zeigt ewig die alten Werte — der stille Fehler, der Wochen später als „das Backtest-Ergebnis war nie reproduzierbar" auffällt |
| `artifactHash` | Modellgewichte, Kalibrierungstabellen — alles, was **nicht** Parameter ist | ein ausgetauschtes Modell hat denselben Hash wie das alte (§12/K111) |
| `codeGeneration` | die Implementierung der Definition selbst | ein alter Cache liefert nach einem Update Werte, die kein Code mehr erzeugt (§12/I103) |

### 2.4 `canon()` — kanonische Parameter

Eine eigene, getestete Funktion. `JSON.stringify` genügt **nicht**.

| Fall | Regel |
| --- | --- |
| Objekt-Schlüssel | lexikografisch sortiert nach UTF-8-Codepoints |
| `undefined`-Wert | Schlüssel entfällt — identisch zu „nicht gesetzt" |
| fehlender Schlüssel mit Default | **Default wird materialisiert** (§12/C29) |
| `1.0` vs `1` | kürzeste Roundtrip-Darstellung (`Number.prototype.toString`) |
| `-0` | wird zu `0` |
| `NaN`, `±Infinity` | **verboten** als Parameter → `VP-REG-0007` |
| Arrays | Reihenfolge ist bedeutungstragend, nie sortiert |
| Strings | NFC-normalisiert |

---

## 3. Die Registry

### 3.1 Vertikal — die Ebenen

Jede Definition hat ein `kind`, jedes `kind` eine **Ordnungszahl**. Ein Knoten
darf nur auf Knoten **echt kleinerer** Ordnungszahl zeigen; gleiche Ordnungszahl
nur mit ausdrücklichem `sameRank: true` und dann mit Zyklusprüfung. Das erschlägt
Zyklen (§12/C25) mit einer Regel statt mit einem Algorithmus.

| Ord. | `kind` | Was es ist | Ausgang |
| --- | --- | --- | --- |
| 0 | `venue` | Verbindungsdefinition eines Marktes | Handle |
| 0 | `calendar` | Sessions, Feiertage, Halbtage, IANA-Zeitzone | Öffnungsfenster |
| 1 | `feed` | Roh-Strom eines Venue (WS/REST) | Ticks oder Bars |
| 2 | `series` | normalisierte OHLCV-Reihe je Timeframe | Bar-Fenster |
| 3 | `transform` | Resample, Adjust (Split/Dividende), Fill | Bar-Fenster |
| 4 | `indicator` | EMA, RSI, ATR, VWAP … | numerische Spalten |
| 5 | `feature` | Modell-Eingang (Normalisierung, Fensterung) | Feature-Vektor |
| 6 | `model` | der Predictor | Vorhersage + Konfidenz |
| 7 | `signal` | diskretes Ereignis aus Vorhersage/Indikator | Ereignisliste |
| 8 | `decision` | Signale + Regeln + Risikobudget → **Absicht** | Richtung, Größe, Gültigkeit |
| 9 | `execution` | simulierte Ausführung: Spread, Slippage, Gebühren, Teilfüllung | Fills |
| 10 | `position` | Bestandsführung: Menge, Einstand, Finanzierung, Margin | Positionsstand |
| 11 | `pnl` | realisiert, unrealisiert, Kosten, Kennzahlen | Geldbeträge + Kennzahlen |
| 12 | `layer` | was im Chart erscheint | LayerSpec (§5) |

```ts
type Definition = {
  urn: Urn                       // vp://indicator/core/ema@2.1.0
  kind: Kind
  title: string
  inputs: InputSlot[]            // { name, acceptsKind, acceptsSchema, optional }
  params: JSONSchema             // mit Defaults — beim Upsert materialisiert
  outputSchema: SchemaRef        // eigener Raum: vp://schema/ohlcv@1
  lookback: LookbackSpec         // { bars } | { bars, convergence: 'exponential', factor: 5 }
  purity: 'pure' | 'stateful'    // stateful braucht Replay-Zustand im Journal
  cost: { cpu: 'low' | 'mid' | 'high', io: boolean }
  capabilities?: string[]        // 'needs-volume', 'needs-session-calendar'
  deprecated?: { since: string, replacedBy?: Urn, removeAfter: string }
}
```

**`lookback` ist Pflicht**, weil daraus der Warmup der Maschine gerechnet wird:
entlang eines Pfades addiert, über Pfade das Maximum. Rekursive Indikatoren (EMA)
haben theoretisch unendlichen Lookback — dafür gibt es `convergence`, das eine
ehrliche endliche Zahl liefert (EMA ≈ 5 × Periode) statt einer stillen Lüge.

### 3.2 Horizontal — die Matrix

Die horizontale Registry hält **keine Rechenwege**, sondern Zeilen:

```ts
type ScopeRow = {
  scopeKey: ScopeKey
  instrumentId: string
  enabled: boolean
  profile: string
  planHash: string | null        // welcher aufgelöste Plan gerade gilt
  state: MachineState            // Projektion aus dem Journal, nie die Quelle
  since: number                  // ms, wann dieser Zustand begann
  health: { feedAgeMs, lastBarTime, gapCount, degradedReason? }
  budgets: Record<BudgetClass, { used: number, limit: number, windowMs: number }>
  lease: { owner: string, expiresAt: number } | null
  tags: string[]                 // 'krypto', 'pilot', 'nachtlauf'
}
```

Zwei Achsen, ein Kern — die Verbindung ist **eine** Funktion:

```ts
resolve(profile, scope) -> Plan { nodes[], topoOrder[], warmupBars, capabilities, planHash }
```

`resolve` ist **rein** und ohne I/O. Damit ist sie testbar, und damit kann MCP sie
als Trockenlauf anbieten (`vp_registry_validate`), ohne irgendetwas zu starten.

| Achse | Antwortet auf | Ändert sich, wenn … | Kosten einer Änderung |
| --- | --- | --- | --- |
| vertikal | „darf X auf Y aufbauen, und was kommt raus?" | wir eine neue Rechnung bauen | Code + Tests + Version |
| horizontal | „läuft es für BTCUSDT-1m, und wie geht es dem?" | wir einen Markt dazunehmen | **eine Zeile** |

Wer das vermischt, bekommt 3.000 Registry-Einträge, weil jede Symbol-Timeframe-
Kombination ihre eigene EMA-Definition trägt. Die Trennung ist der ganze Punkt.

### 3.3 Speicher, Revisionen, Aktivierung

| Eigenschaft | Umsetzung |
| --- | --- |
| Format | JSON-Dateien je `kind` unter `registry/`, ein Verzeichnis je Namensraum |
| Schreiben | `tmp`-Datei + `rename` (atomar), vorher Inhalts-Hash gegen den beim Laden gelesenen prüfen |
| Nebenläufigkeit | Fremdschreiber-Erkennung **wortgleich zum Muster der geteilten Verlaufsdatei** — gehasht wird der Inhalt, nicht mtime/Größe |
| Revisionen | jede Änderung erzeugt eine neue Revision; `active` zeigt auf genau eine |
| Aktivierung | getrennter Schritt: ein Upsert schreibt einen **Entwurf**, erst `activate` macht ihn wirksam |
| Löschen | gibt es nicht. Nur `deprecated` mit `removeAfter`; ein GC räumt erst danach und nie Referenziertes |

Warum Entwurf und Aktivierung getrennt sind: ein Agent über MCP darf vorschlagen
dürfen, ohne dass ein Tippfehler 200 laufende Maschinen in `RESOLVING` schickt.

**Zurücknehmen** ist deshalb billig: `activate` verschiebt einen Zeiger, es
überschreibt nichts. Die vorige Revision bleibt aktivierbar, und ein Rollback ist
derselbe Vorgang in die andere Richtung — inklusive Journal-Eintrag.

### 3.4 Wenn ein Knoten aus einem fremden Scope liest

Vergleichs-Layer („BTC gegen ETH", „SAP gegen DAX") und Korrelationsmerkmale
brauchen Daten aus einem **anderen** Scope. Das ist erlaubt, aber nur unter drei
Auflagen — sonst entsteht ein Netz aus Maschinen, das gemeinsam hängt:

| Auflage | Regel |
| --- | --- |
| Richtung | ein Knoten darf **lesen**, nie in einen fremden Scope schreiben |
| Kopplung | die fremde Quelle ist eine **Momentaufnahme mit Ausrichtung**, kein Live-Abonnement: `align: 'outer' \| 'inner' \| 'ffill'` ist Pflicht (§12/J110) |
| Ausfall | ist der fremde Scope nicht `LIVE`, wird der abhängige Knoten `DEGRADED` — die eigene Maschine hält **nicht** an, nur dieser Zweig |

Zyklen über Scope-Grenzen (A liest B, B liest A) werden beim `resolve()` erkannt,
über den gesamten Graphen aller aktiven Scopes hinweg.

### 3.5 Die dritte Achse — Strategie

Vertikal ist der **Aufbau**, horizontal die **Reichweite**. Was beiden fehlt, ist
die **Haltung**: dieselben Bausteine, dieselben Märkte, aber eine andere
Entscheidungsregel, ein anderes Risikobudget, eine andere Kostenannahme. Genau
darin liegt der Unterschied, den man messen will — und solange „Strategie" nur
ein Profilname ist, kann man ihn nicht benennen, sondern nur ahnen.

Deshalb ist eine Strategie ein eigenes Objekt:

```ts
type Strategie = {
  id: string                    // 'scalp-v3'
  profile: string               // welcher Definitionssatz (vertikale Achse)
  universum: string             // welche Scopes (horizontale Achse)
  entscheidung: Urn[]           // die decision-Knoten, die sie ausmachen
  risiko: {
    maxPositionsgroesse: Bruch  // Anteil des Kontos
    maxGleichzeitig: number
    maxRueckgang: Bruch         // ab hier hält die Strategie sich selbst an
    maxTagesverlust: Bruch
  }
  kosten: KostenModellRef       // Vorgabe, damit Vergleiche fair sind
  eltern?: string               // von welcher Strategie abgeleitet
  notiz: string                 // wozu sie da ist, in einem Satz
}
```

`eltern` ist kein Schmuck. Eine Strategie, die von `scalp-v2` abstammt, macht
den Vergleich lesbar: man sieht eine Kette statt einer Wolke, und die Frage
„was haben wir seit v1 eigentlich verändert" hat eine Antwort.

**`strategieHash`** deckt genau diese Felder ab — und **nichts** von Zeitraum,
Datenstand oder Marktmodell. Diese Trennung ist die Voraussetzung für §7.3:
vergleichbar sind zwei Läufe, die sich **nur** im `strategieHash` unterscheiden.

---

## 4. Die Maschine

Eine Instanz je `ScopeKey`. Sie besitzt Plan, Datenstrom und Zustand — und nichts
vom Chart.

### 4.1 Zustände

| Zustand | Bedeutung | Signale gültig |
| --- | --- | --- |
| `IDLE` | registriert, nicht gestartet | nein |
| `RESOLVING` | Plan wird gebaut und typgeprüft | nein |
| `WARMUP` | Historie wird geladen, bis `warmupBars` gedeckt sind | nein |
| `LIVE` | Strom läuft, Rechnung inkrementell | **ja** |
| `BACKFILL` | Lücke wird nachgeholt; Werte noch nicht maßgeblich | nein |
| `DEGRADED` | läuft mit reduzierter Zusage (stale Feed, Fallback-Modell) | ja, **markiert** |
| `HALTED` | angehalten durch Wächter oder Mensch | nein |
| `RETIRED` | endgültig, Ressourcen frei | nein |

### 4.2 Übergänge

| Von | Ereignis | Guard | Nach |
| --- | --- | --- | --- |
| `IDLE` | `start` | Lease erworben | `RESOLVING` |
| `RESOLVING` | `resolve_ok` | Topo-Sortierung frei von Zyklen, alle Schemata passen | `WARMUP` |
| `RESOLVING` | `resolve_failed` | — | `HALTED` (`VP-REG-*` im Journal) |
| `WARMUP` | `coverage_ok` | Abdeckung ≥ `warmupBars` **und** keine Lücke > `gapTolerance` | `LIVE` |
| `WARMUP` | `coverage_impossible` | Venue liefert weniger Historie als nötig | `DEGRADED` (`best-effort`) / `HALTED` (`strict`) |
| `LIVE` | `feed_stale` | `venueNow − lastBar > stalenessBudget` (§12/A8) | `DEGRADED` |
| `LIVE` | `gap_detected` | fehlende Bars zwischen zwei empfangenen | `BACKFILL` |
| `BACKFILL` | `gap_closed` | Lücke gedeckt, abhängige Knoten neu gerechnet | `LIVE` |
| `DEGRADED` | `feed_recovered` | 3 gesunde Bars in Folge (Hysterese) | `LIVE` oder `BACKFILL` |
| beliebig | `budget_exhausted` | Error-Budget einer Klasse überschritten (§6.2) | `HALTED` |
| beliebig | `definition_changed` | neuer `planHash` aktiviert | `RESOLVING` (blau/grün, §4.4) |
| `HALTED` | `resume` | Cooldown abgelaufen, Backoff eingehalten | `RESOLVING` |
| beliebig | `retire` | — | `RETIRED` |

Operator-erzwungene Übergänge ohne erfüllten Guard sind möglich — aber nur mit
`force: true` **und** einer Begründung, die im Journal landet. Ein Schalter ohne
Spur ist ein Schalter, den später niemand erklären kann.

### 4.3 Journal, Replay, Determinismus

Das Journal ist die **Quelle**, `ScopeRow.state` nur eine Projektion.

```
{ seq, ts, kind: 'intent'|'applied'|'failed', from, to, event, guardResults, cause?, force?, reason? }
```

`intent` **vor** und `applied` **nach** der Wirkung. Wer mitten im Übergang
abstürzt, findet beim Start ein `intent` ohne `applied` und weiß, wo er stand.

**Determinismus ist eine Anforderung, kein Zufall.** Vier Regeln tragen sie:

| Regel | Umsetzung | Prüfung |
| --- | --- | --- |
| Keine Wanduhr in der Rechnung | `Clock` wird injiziert; `Date.now()` ist in `packages/compute` per Lint-Regel verboten | ESLint + Drift-Test |
| Kein ungesäter Zufall | RNG je Knoten aus `nodeHash` gesät | Test |
| Stabile Knotenreihenfolge | gleichrangige Knoten nach `nodeHash` sortiert, nicht nach Einfügereihenfolge | Test |
| Preise als Ganzzahl-Ticks | intern `bigint`-Ticks + `minMove`; Fließkomma nur an der Oberfläche | Property-Test |

Und der Test, der das Ganze trägt: **Replay ≡ Live.** Derselbe Datensatz einmal
als Block eingespielt, einmal Bar für Bar — die Ausgabe muss gleich sein. Fällt
der Test, gibt es Look-ahead-Bias, und **jede** Backtest-Zahl aus dem System ist
wertlos. Er läuft in jeder CI.

### 4.4 Hot-Reload ohne Riss

Ändert sich eine Definition, wird der neue Plan **daneben** aufgebaut (eigener
`RESOLVING`/`WARMUP`). Erst wenn er `ready` meldet, wird umgeschaltet. Der alte
Plan drainiert: keine neuen Eingaben, laufende Berechnungen dürfen zu Ende
laufen, dann `dispose`. Der Chart-Adapter bekommt beim Umschalten ein
`reset(reason: 'plan-changed')` mit neuem `planHash` — kein Mischen zweier Pläne
in einer Serie.

### 4.5 Scheduler und Laufzeitbudgets

| Mittel | Regel |
| --- | --- |
| Zeitbudget je Knoten | aus `cost.cpu`; Überschreitung = `VP-CALC-0003` + `DEGRADED` |
| Abbruch | jeder Lauf trägt ein `AbortSignal`; `retire` und Hot-Reload nutzen es |
| Backpressure | Ticks werden auf Bar-Ebene zusammengefasst; verworfene Zwischenticks werden **gezählt**, nicht verschwiegen |
| Venue-Rate-Limit | **ein** Token-Bucket je `venue`, geteilt über alle Scopes — sonst schlagen 200 Maschinen gleichzeitig auf denselben Endpunkt |
| Parallelität | Worker-Pool; `cost.cpu: 'high'` läuft nie im Haupt-Thread |

### 4.6 Die Simulation ist keine zweite Maschine

Das ist die wichtigste Entscheidung dieses Abschnitts: **es gibt keinen
Simulations-Code neben dem Live-Code.** Eine Simulation ist dieselbe Maschine,
derselbe Plan, dieselben Knoten — nur mit

| ausgetauscht | statt | Folge |
| --- | --- | --- |
| `feed` | Live-Venue → `replay`-Feed über einen Zeitraum | Bars kommen aus der Platte statt aus dem Netz |
| `Clock` | Wanduhr → Simulationsuhr, die am Bar-Strom hängt | kein `sleep`, Läufe sind so schnell wie die CPU |
| `execution` | echte Order (**gibt es nicht**, §13) → Fill-Modell | Fills entstehen aus Regeln, nicht aus einem Broker |

Jede andere Bauweise erzeugt zwei Systeme, die auseinanderlaufen, und die
Backtest-Zahl beschreibt dann ein System, das nie live ging. Der Test, der das
festhält, ist der schon genannte: **Replay ≡ Live** (§4.3).

Ein **Szenario** ist die Ein-Datei-Beschreibung eines Laufs:

```ts
type Szenario = {
  id: string
  // ── Prüfstand: alles, was für einen fairen Vergleich gleich bleiben muss ──
  scopes: ScopeKey[]             // ein Markt oder ein ganzes Universum
  zeitraum: { von: TimeMs, bis: TimeMs }
  warmupVor: TimeMs              // liegt VOR `von` — nie im Bewertungszeitraum
  konto: KontoSpec               // Startkapital, Währung, Hebel, Margin-Regeln
  kosten: KostenModellRef        // Gebühren, Spread, Slippage, Finanzierung
  markt: MarktModellRef          // wie ein Fill zustande kommt
  seed: number
  datenRevision: string          // auf welchem Datenstand gerechnet wurde
  // ── Prüfling ──
  strategie: string              // → Strategie (§3.5)
  // ── nur Aufzeichnung, ohne Einfluss auf das Ergebnis ──
  trace: 'off' | 'entscheidungen' | 'voll'
}
```

Zwei Hashes statt einem, und das ist der Punkt:

```
datenHash      = blake3( scopes ‖ zeitraum ‖ warmupVor ‖ konto ‖ kosten ‖ markt ‖ seed ‖ datenRevision )
strategieHash  = blake3( Strategie-Objekt, §3.5 )
szenarioHash   = blake3( datenHash ‖ strategieHash )
```

Ein Vergleich ist **nur** zulässig, wenn der `datenHash` übereinstimmt. Dann ist
der Unterschied im Ergebnis der Unterschied der Strategie — und sonst nichts. Ein
Lauf mit anderem Kostenmodell danebenzustellen ist kein Vergleich, sondern eine
Verwechslung, und `vp_sim_diff` verweigert ihn (§12/L129).

`trace` steht bewusst außerhalb beider Hashes: eine Aufzeichnung, die das
Ergebnis verändert, wäre keine.

### 4.7 Entscheidung → Ausführung → Gewinn

Vier Ebenen, vier Verträge. Die Trennung ist nicht Bürokratie: an jedem der drei
Übergänge sitzt ein klassischer Fehler, und getrennt sind sie einzeln prüfbar.

```
signal ──► decision ──────► execution ─────► position ─────► pnl
           „ich will"        „so viel, zu     „das halte      „das hat es
                              diesem Preis,    ich jetzt"      gebracht"
                              das kostet es"
```

| Ebene | Ausgang | Der Fehler, der hier sitzt |
| --- | --- | --- |
| `decision` | `{ richtung, groesse, gueltigBis, grund[] }` | Größe als Prozent des Kontos macht den Lauf **pfadabhängig** — die Reihenfolge der Entscheidungen muss deterministisch sein (§12/L124) |
| `execution` | `Fill[]` | Fill zum **Close derselben Bar** ist Look-ahead. Regel: frühestens **Open der nächsten Bar**, plus Spread und Slippage |
| `position` | Bestand, Einstand, Margin, Finanzierung | Perpetual-Funding und Leihkosten beim Short werden vergessen und fehlen dann dauerhaft |
| `pnl` | Beträge in **Kontowährung**, Kennzahlen | Fremdwährung braucht einen FX-Kurs **mit Zeitstempel**, nicht den heutigen |

Geld wird **nie** als Fließkommazahl gerechnet: intern Ganzzahlen in der
kleinsten Einheit der Kontowährung, Anzeige deutsch (`1.234,50 €`). Die Summe
der Teile muss dem Ganzen entsprechen — geprüft als Invariante, nicht gehofft.

Kennzahlen aus `pnl`: Endkapital, realisierter und offener Gewinn, Gebühren
gesamt, maximaler Rückgang (Drawdown), Trefferquote, Anzahl Trades, Rendite je
Risiko. Jede Kennzahl trägt den `szenarioHash` — eine Kennzahl ohne ihn ist eine
Zahl ohne Frage.

### 4.8 Die Rechenkette — „zur Vermerkung"

Eine Gewinnzahl, die man nicht zurückverfolgen kann, ist eine Behauptung. Deshalb
führt jeder Lauf ein **Rechenband**: für jeden erzeugten Wert steht fest, aus
welchen Werten er entstand.

```ts
type Kettenglied = {
  wertId: string        // blake3(nodeHash ‖ t)
  node: NodeRef         // welcher Knoten, welche Version, welche Parameter
  t: TimeMs
  eingaenge: string[]   // wertIds — die Kette rückwärts
  wert: unknown
}
```

Weil ein volles Band bei Millionen Bars größer wird als die Kursdaten, gibt es
drei Stufen:

| `trace` | Was aufgezeichnet wird | Wofür |
| --- | --- | --- |
| `off` | nichts | Dauerbetrieb live |
| `entscheidungen` | **nur die Ketten, die in eine `decision` oder einen `pnl`-Eintrag münden** — rückwärts bis zur Rohbar | der Normalfall: jede Entscheidung ist belegt, die Größe bleibt tragbar |
| `voll` | jeder Wert jedes Knotens | Fehlersuche an einem kurzen Ausschnitt |

Daraus entsteht je Entscheidung ein **Beleg** — die Form, in der ein Lauf
vermerkt wird und in der er auch in einem halben Jahr noch erklärbar ist:

| Feld | Inhalt |
| --- | --- |
| `belegId`, `szenarioHash`, `planHash` | wer gerechnet hat, mit welchem Plan |
| `t`, `scope`, `richtung`, `groesse` | was entschieden wurde |
| `grund[]` | die auslösenden Signale mit ihren `wertId` |
| `kette` | das Rechenband dieser Entscheidung, rückwärts bis zur Rohbar |
| `fill` | Preis, Menge, Gebühr, Slippage, Modellversion |
| `positionVorher` / `positionNachher` | Bestandswirkung |
| `abschluss` | Verweis auf den Beleg, der die Position schließt — und der dort realisierte Betrag |
| `datenstand` | `dataRevision` **zum Zeitpunkt der Entscheidung** |

Zwei Eigenschaften machen den Beleg belastbar:

1. **Nachrechenbar.** Aus einem Beleg allein (plus Registry und Rohdaten) muss
   sich derselbe Wert ergeben. Ein Test zieht Stichproben aus jedem Lauf und
   rechnet sie nach; weicht einer ab, ist der Lauf ungültig.
2. **Unveränderlich.** Korrigiert der Venue später eine Bar, auf der eine
   Entscheidung stand, wird die Entscheidung **nicht** rückwirkend geändert. Sie
   bekommt einen Vermerk „beruht auf inzwischen korrigierten Daten" mit beiden
   Revisionen. Wer die Vergangenheit umschreibt, verliert genau die Spur, wegen
   der er sie aufgezeichnet hat.

Im Chart erscheint das als **eigene Layer** (§5): Entscheidungen als Marker,
Fills mit Preis, die Kapitalkurve und der Rückgang in Sub-Panes, offene
Positionen als Preislinien. Ein Klick auf einen Marker öffnet seinen Beleg — das
ist die Verknüpfung, für die der `layer` seinen `source`-Knoten kennt.

---

## 5. Der Chart-Adapter

Der Adapter ist die **einzige** Stelle, an der Registry-Knoten zu Bildern werden.
Die Maschine kennt kein Chart, der Chart keine Maschine.

### 5.1 Das neutrale Layer-Modell

```ts
type LayerSpec = {
  id: LayerId                    // vp://layer/...#scope/nodeHash8
  kind: 'candles' | 'line' | 'area' | 'histogram' | 'band' | 'markers'
      | 'priceLines' | 'boxes' | 'heatmap'
  pane: 'price' | `sub:${string}`
  scale: { id: string, mode: 'normal' | 'log' | 'percent', autoFit: boolean }
  source: NodeRef                // welcher Registry-Knoten liefert
  encoding: Record<string, string>  // { time:'t', open:'o', high:'h', low:'l', close:'c' }
  style: StyleTokenRef           // semantisches Token, NIE ein Hex-Wert
  format: { precision: number, minMove: number }  // aus Instrument-Metadaten
  order: number                  // Zeichenreihenfolge innerhalb der Pane
  visible: boolean
  degradable: boolean            // darf ein Treiber es vereinfacht zeichnen?
}
```

### 5.2 Das Patch-Protokoll

```ts
type ChartOp =
  | { op:'snapshot',     layer: LayerId, rev: number, range: TimeRange, points: Point[] }
  | { op:'append',       layer: LayerId, rev: number, points: Point[] }
  | { op:'updateLast',   layer: LayerId, rev: number, point: Point, provisional: boolean }
  | { op:'replaceRange', layer: LayerId, rev: number, range: TimeRange, points: Point[] }
  | { op:'removeRange',  layer: LayerId, rev: number, range: TimeRange }
  | { op:'setMarkers',   layer: LayerId, rev: number, markers: Marker[] }
  | { op:'setStyle',     layer: LayerId, rev: number, style: StyleTokenRef }
  | { op:'setVisible',   layer: LayerId, rev: number, visible: boolean }
  | { op:'reset',        layer: LayerId, rev: number, reason: ResetReason }
```

`rev` ist je Layer streng monoton. Empfängt ein Treiber `rev = n+2` nach `n`,
**fordert er einen Snapshot an**, statt eine Lücke zu zeichnen. Ein Chart, der
still ein Loch zeichnet, ist schlimmer als einer, der neu lädt.

### 5.3 Treiber und Fähigkeiten

```ts
interface RendererDriver {
  readonly name: 'lightweight' | 'echarts'
  readonly capabilities: Set<LayerKind>
  mount(container, theme): Handle
  apply(ops: ChartOp[]): void
  readback(layer: LayerId): ReadbackState   // NUR für Tests
  destroy(): void
}
```

Kann ein Treiber ein `kind` nicht (Lightweight Charts kennt keine echten Boxen),
gilt: **sichtbar vereinfachen, nie still weglassen.** Ist `degradable: true`,
zeichnet er die nächstbeste Form und meldet `VP-CHART-0021` als `info`; ist es
`false`, bleibt der Layer leer **mit Hinweis in der Legende**.

### 5.4 Die Konformitätssuite

Dieselben Golden-Op-Folgen laufen gegen **beide** Treiber, verglichen wird
`readback()` — nicht das Pixelbild. Damit läuft die Suite headless in CI, und
ein dritter Treiber später muss nur diese Suite bestehen.

| Fall | Was geprüft wird |
| --- | --- |
| Snapshot → 100× append | identische Punktmenge in beiden Treibern |
| append mit Zeitsprung rückwärts | beide lehnen ab, beide melden denselben Code |
| updateLast(provisional) → updateLast(final) | genau ein Punkt, nicht zwei |
| replaceRange über Lückenbereich | Whitespace bleibt Whitespace |
| reset → snapshot | kein Rest des alten Layers |
| destroy → apply | sauberer Fehler, kein Absturz |

### 5.5 Zeit, Skalen, Farben

| Thema | Regel |
| --- | --- |
| Zeit intern | **`TimeMs` = Epoch-Millisekunden UTC**, überall. Lightweight will UTC-Sekunden, ECharts will ms — beides rechnet **der Treiber** um, nicht der Adapter |
| Anzeige-Zeitzone | reine Adapter-Sache, ändert nie einen Datenwert |
| Farben | aus `nodeHash` deterministisch aus der Palette gezogen → derselbe Indikator hat nach einem Neustart dieselbe Farbe |
| Theme | Style-Tokens, Wechsel per `setStyle` — ohne Datenverlust, ohne Remount |
| Autoscroll | nur wenn die Ansicht am rechten Rand steht (`followMode`); hat der Mensch gescrollt, bleibt die Ansicht stehen |

### 5.6 Bindung und Transport — der Weg vom Knoten zum Bild

Das ist die eigentliche **Verknüpfung**, und sie ist der Teil, den ein Entwurf
gern überspringt, weil er im selben Prozess trivial aussieht und über eine
Prozessgrenze nicht mehr.

```ts
bind(scope: ScopeKey, layerIds: LayerId[], transport: Transport) -> Subscription
```

| Eigenschaft | Regel |
| --- | --- |
| Fan-out | **eine** Maschine, n Abonnenten. Zwei offene Charts auf `binance:BTCUSDT:1m` rechnen einmal, nicht zweimal |
| Lebensdauer | die Maschine lebt **unabhängig** vom Chart. Der letzte Abonnent, der geht, hält sie nicht an — und hält sie auch nicht am Leben |
| Abmelden | ausdrücklich, plus **Heartbeat mit TTL**: ein geschlossener Tab meldet sich nicht ab (§12/J105) |
| Transport | in-process (Funktionsaufruf) oder WebSocket — derselbe `ChartOp`-Strom, ein Wire-Format |
| Wire-Format | eigenes, **nicht** blankes JSON: Ganzzahl-Ticks sind `bigint` und überleben `JSON.stringify` nicht (§12/J108) |
| Rückstau | Puffer je Abonnent ist begrenzt; bei Überlauf `reset('overflow')` statt unbegrenzt zu wachsen |
| Verbindungsabriss | `rev`-Lücke wird erkannt → Snapshot; bis dahin trägt der Handle `staleSince`, und die Oberfläche sagt „getrennt", statt einen eingefrorenen Stand als aktuell zu zeigen |

Der Abriss ist die wichtigste Zeile der Tabelle. Ein Chart, der nach einem
Netzfehler einfach stehenbleibt, sieht exakt aus wie ein ruhiger Markt.

---

## 6. Der zentrale Error-Tracker

Kein Logger. Ein Logger schreibt; dieser hier **zählt und entscheidet** — die
Guards der Maschine lesen ihn.

### 6.1 Das Fehlerobjekt

```ts
type TrackedError = {
  code: ErrorCode                // 'VP-FEED-0012'
  severity: 'info' | 'warn' | 'error' | 'fatal'
  budgetClass: 'feed' | 'calc' | 'model' | 'render' | 'io' | 'global'
  retryable: boolean
  scope: ScopeKey | null         // null bei Bootstrap-Fehlern
  node: NodeRef | null
  phase: MachineState | null
  traceId: string                // ein Rechenlauf
  urheber: string | null         // MCP-Flächen-Identität, falls von außen ausgelöst (§7.1)
  fingerprint: string            // hash(code + defUrn + Form der Meldung)
  message: string                // redigiert
  cause?: TrackedError | SerializedError
  count: number                  // bei Dedupe
  firstSeen: number; lastSeen: number   // monotone Uhr, nicht Wanduhr
}
```

### 6.2 Codes und Budgets

`VP-<BEREICH>-<NNNN>`, Bereiche: `REG`, `MCH`, `FEED`, `CALC`, `MODEL`, `CHART`,
`MCP`, `SYNC`, `STORE`.

Die Code-Tabelle liegt in **einer** Datei, und ein Drift-Test hält sie sauber:
kein doppelter Code, jeder Code trägt `severity`, `budgetClass` und `retryable`.
Wer einen Code hinzufügt, ohne die Klasse zu setzen, bekommt einen roten Lauf —
nicht eine stille Voreinstellung.

| Klasse | Fenster | Schwelle | Wirkung bei Überschreitung |
| --- | --- | --- | --- |
| `feed` | 5 min | 20 | `DEGRADED` → bei Verdopplung `HALTED` |
| `calc` | 5 min | 10 | `HALTED` |
| `model` | 15 min | 5 | Fallback-Modell, dann `DEGRADED` |
| `render` | 1 min | 50 | Layer aus, Maschine unberührt |
| `io` | 5 min | 30 | `DEGRADED` |
| `global` | 15 min | 20 | Prozess meldet `unhealthy`, keine Maschine wird angehalten |

Budgets laufen auf der **monotonen** Uhr. Springt die Systemzeit (NTP, Suspend),
darf das kein Budget leeren und keines füllen.

### 6.3 Senken und Härte

| Eigenschaft | Umsetzung |
| --- | --- |
| Senken | Ringpuffer im Speicher (immer), NDJSON-Datei (rotiert, Größenbudget), MCP-Ressource, optional Webhook |
| Nichtrekursion | jede Senke ist in `try/catch`; ein Fehler **in** der Senke landet in `lastSinkError`, nie zurück im Tracker |
| Dedupe | nach `fingerprint`; ab der N-ten Wiederholung nur noch jede M-te gespeichert — der **Zähler bleibt exakt** |
| Redaktion | Allowlist je Feld. Ein Kanarienvogel-Token im Test beweist, dass es nicht durchkommt |
| Prozessrand | `unhandledRejection` und `uncaughtException` gehen hier hinein, mit `scope: null` |
| Worker-Rand | `toWire()` / `fromWire()`, `cause`-Kette bleibt erhalten, Stacks gekürzt |

### 6.4 Was der Tracker **nicht** ist

Er zählt Fehler, nicht Ereignisse. Durchsatz, Rechenzeit je Knoten, Feed-Latenz
und Speicherverbrauch sind **Kennzahlen** und gehören nicht in den Fehlertopf —
sonst füllt ein langsamer Tag ein Error-Budget und hält eine gesunde Maschine an.
Kennzahlen bekommen einen eigenen, schlichten Zähler-Sammler mit `/health`; er
darf nie einen Guard auslösen.

---

## 7. MCP — die Registry der Flächen

### 7.1 Warum mehrere Flächen

Ein einziger MCP-Server, der alles sieht, kann eine Frage nicht beantworten:
**worin unterscheiden sich zwei Strategien?** Er kann beide auflisten — aber er
vermischt sie in jeder Antwort, jede Abfrage muss gefiltert werden, und ein
Agent, der über `scalp` nachdenkt, stolpert ständig über `swing`.

Deshalb ist die MCP-Fläche selbst ein **Registry-Eintrag**, und es darf mehrere
davon geben. Jede Fläche ist ein Ausschnitt mit eigener Identität:

```ts
type McpFlaeche = {
  id: string                     // 'scalp-lesend'
  strategie: string | null       // an welche Strategie gebunden; null = übergreifend
  scopeFilter: ScopeMuster[]     // welche Märkte sie überhaupt sieht
  werkzeuge: WerkzeugMuster[]    // Allowlist, kein Blocklist
  stufe: 'lesend' | 'vorschlagend' | 'steuernd'
  transport: { art: 'stdio' } | { art: 'netz', auth: AuthRef }
  budget: { simLaeufeProStunde: number, antwortBytes: number }
  identitaet: string             // steht in Journal und Fehlern — wer war das
}
```

| Stufe | Darf | Darf nicht |
| --- | --- | --- |
| `lesend` | alles lesen, was der Filter zulässt; `vp_sim_run` im Budget | schreiben |
| `vorschlagend` | zusätzlich Entwürfe anlegen (`vp_registry_upsert`) | aktivieren, Maschinen steuern |
| `steuernd` | zusätzlich aktivieren und Maschinen kommandieren | den eigenen Filter erweitern |

Fünf Eigenschaften, die aus der Vervielfachung erst einen Gewinn machen:

| Eigenschaft | Regel |
| --- | --- |
| **Abschottung** | eine Fläche sieht nur ihre Scopes und ihre Belege. Ein Filter ist eine Allowlist; was nicht genannt ist, existiert für sie nicht |
| **Zurechenbarkeit** | `identitaet` steht in jedem Journal-Eintrag und an jedem Fehler. „Wer hat die Maschine angehalten" ist eine Abfrage, keine Rekonstruktion |
| **Eigene Budgets** | jede Fläche hat ihr eigenes Kontingent für Simulationen. Sonst hungert ein Agent, der Parameter sucht, alle anderen aus |
| **Selbstbeschreibung** | jede Fläche sagt in ihrer Server-Beschreibung, **welchen Ausschnitt** sie ist — sonst hält ein Agent seinen Teil für das Ganze |
| **Eine Wurzel** | genau eine Fläche (`stufe: lesend`, ohne Strategie) listet die anderen auf: `vp_flaechen_list`. Sie ist die Registry der Registries und darf selbst keine Strategie führen |

Die Flächen liegen als Definitionen in der Registry, werden also versioniert,
als Entwurf angelegt und ausdrücklich aktiviert — dieselbe Ordnung wie bei allem
anderen (§3.3). Eine Fläche, die sich selbst erweitern könnte, wäre keine Grenze.

### 7.2 Die Werkzeuge

Standard: **lesend**. Schreibende Werkzeuge existieren nur, wenn die Stufe der
Fläche sie trägt — dann fehlen sie in der Werkzeugliste ganz, statt mit einem
Fehler zu antworten. Ein Agent, der ein Werkzeug sieht, versucht es auch.

| Werkzeug | Klasse | Was es tut | Grenze |
| --- | --- | --- | --- |
| `vp_registry_list` | lesend | Definitionen nach `kind`/Namensraum | paginiert, harte Byte-Obergrenze |
| `vp_registry_get` | lesend | eine Definition samt Revisionen | — |
| `vp_registry_validate` | lesend | Trockenlauf `resolve()` auf einen Vorschlag | schreibt nichts |
| `vp_registry_upsert` | **schreibend** | legt einen **Entwurf** an | nie Aktivierung; Vorschau + `confirm`-Hash |
| `vp_registry_activate` | **schreibend** | aktiviert eine Revision | `confirm`-Hash aus der Vorschau |
| `vp_scope_list` | lesend | horizontale Matrix mit Zustand und Gesundheit | Filter, paginiert |
| `vp_machine_status` | lesend | Zustand, Dauer, Budgets, letzte Übergänge | — |
| `vp_machine_journal` | lesend | Journal-Ausschnitt | Zeitfenster Pflicht |
| `vp_machine_command` | **schreibend** | `start`/`halt`/`resume`/`retire` | `confirm`-Hash; `force` nur mit Begründung |
| `vp_chart_spec` | lesend | die LayerSpecs, die der Adapter erzeugen würde | erlaubt Chart-Analyse ohne Browser |
| `vp_errors_query` | lesend | Fehler nach Code/Scope/Fenster | Fenster Pflicht |
| `vp_errors_top` | lesend | häufigste Fingerprints im Fenster | — |
| `vp_szenario_list` / `_get` | lesend | Szenarien und ihre `szenarioHash` | — |
| `vp_sim_run` | lesend* | Simulation über ein Szenario | `maxBars`, Timeout, `maxParallel`; \*rechnet, schreibt nur in den Lauf-Ordner |
| `vp_pnl_report` | lesend | Kennzahlen eines Laufs, Beträge in Kontowährung | trägt immer den `szenarioHash` |
| `vp_beleg_get` | lesend | ein Entscheidungsbeleg samt Fill und Positionswirkung | — |
| `vp_kette_get` | lesend | die Rechenkette hinter einem Wert, rückwärts | Tiefe begrenzt, paginiert |
| `vp_sim_diff` | lesend | zwei Läufe gegeneinander | **verweigert** bei abweichendem `datenHash` (§12/L129) |
| `vp_flaechen_list` | lesend | welche MCP-Flächen es gibt, mit Ausschnitt und Stufe | nur auf der Wurzelfläche |
| `vp_strategie_list` / `_get` | lesend | Strategien mit `strategieHash` und Abstammung | — |
| `vp_strategie_diff` | lesend | **struktureller** Unterschied zweier Strategien | rechnet nicht, liest nur die Registry |
| `vp_strategie_vergleich` | lesend | Verhalten, Ergebnis und **Zuordnung** über denselben Prüfstand | `datenHash` muss gleich sein |
| `vp_codemap_query` | lesend | Aufrufer/Aufgerufene aus der dep-map | Antwort trägt `age_hours` + `commit_match` |

### 7.3 Strategische Unterschiede feststellen

Der eigentliche Zweck der Vervielfachung. „Strategie A ist besser als B" ist
keine Erkenntnis, solange niemand sagen kann **woran es liegt**. Deshalb vier
Ebenen, aufsteigend im Aufwand und im Wert:

| Ebene | Frage | Woher die Antwort kommt | Kosten |
| --- | --- | --- | --- |
| 1 · **Struktur** | Worin unterscheiden sich die Baupläne? | Registry allein: welche Knoten, welche Parameter, welche Entscheidungsregeln, welches Risikobudget | keine Rechnung |
| 2 · **Verhalten** | Wo haben sie sich zum ersten Mal anders entschieden? | Belege beider Läufe: die erste abweichende Entscheidung mit Zeitstempel | ein Lauf je Strategie |
| 3 · **Ergebnis** | Was kam heraus? | Kennzahlen, Beträge in Kontowährung | dieselben Läufe |
| 4 · **Zuordnung** | **Welcher Unterschied aus Ebene 1 hat Ebene 2 ausgelöst?** | die beiden Rechenketten rückwärts vergleichen, bis zum ersten abweichenden `wertId` | Rechenband nötig (`trace: entscheidungen`) |

Ebene 4 ist der Grund, warum §4.8 existiert. Ohne Rechenkette endet jeder
Vergleich bei „B verdient mehr", und die nächste Änderung ist wieder geraten.
Mit ihr lautet die Antwort: *„Die erste Abweichung war am 2026-03-11 um 14:32 —
A stieg nicht ein, weil sein ATR-Filter mit Periode 14 statt 10 über der Schwelle
lag. Von 41 Parameterunterschieden hat genau dieser die Divergenz ausgelöst."*

Drei Regeln, damit der Vergleich nicht lügt:

1. **Gleicher Prüfstand.** Nur bei gleichem `datenHash` (§4.6). Sonst wird
   verweigert, nicht gewarnt — eine Warnung liest niemand zweimal.
2. **Zählen, nicht sammeln.** Jeder Vergleich erhöht den Zähler der
   Szenario-Familie, und der Zähler steht im Bericht. Wer 200 Varianten
   durchprobiert, findet eine gute; das ist kein Ergebnis, sondern Statistik
   (§12/L130).
3. **Vergleich ist kein Urteil.** Die Ausgabe nennt Unterschiede, Beträge und
   Zuordnung — sie nennt keinen Sieger, und schon gar keine Empfehlung (§13).

### 7.4 Regeln für jede Fläche

1. Registry-Texte (Titel, Beschreibungen, `notiz` einer Strategie) sind **Daten**,
   nie Anweisungen. Die Ausgabe kennzeichnet sie als solche und entfernt
   Steuerzeichen — sonst ist die Registry ein Einfallstor für Prompt-Injection.
   Das gilt doppelt, seit mehrere Flächen dieselbe Registry lesen.
2. **Kein Order-Werkzeug. Keine Anlageberatung.** Siehe §13.
3. Jede Antwort, die auf der dep-map beruht, trägt ihr Alter mit — das Muster ist
   aus einem Schwesterprojekt übernommen, wo ab 24 h gewarnt wird.
4. Jede Antwort nennt den Ausschnitt, aus dem sie stammt. Eine Liste, die durch
   einen `scopeFilter` gegangen ist, sagt das — sonst liest ein Agent „drei
   Märkte" als „alle Märkte".

---

## 9. Repo und Pakete

### 9.1 Ordnerordnung

```
nw-predictor/
├─ packages/
│  ├─ core-ids/          URN, ScopeKey, canon(), blake3-Hashing
│  ├─ errors/            zentraler Tracker, Code-Tabelle, Budgets
│  ├─ registry/          V+H-Registry, Store, resolve()
│  ├─ machine/           FSM, Journal, Scheduler, Replay
│  ├─ feeds/             Venue-Treiber (binance, xetra, csv, replay)
│  ├─ compute/           indicator/feature/model/signal-Knoten
│  ├─ trading/           decision/execution/position/pnl-Knoten, Konto, Kostenmodelle
│  ├─ trace/             Rechenband, Belege, Nachrechnung
│  ├─ sim/               Szenario, Läufe, Berichte, Strategievergleich
│  ├─ chart-adapter/     LayerSpec, Patch-Protokoll, Bindung
│  ├─ chart-lightweight/ Treiber
│  ├─ chart-echarts/     Treiber
│  ├─ mcp/               MCP-Kern + Flächen-Registry, n Flächen aus einem Server-Kern
│  └─ app/               Demo-Oberfläche
├─ registry/             die Definitionen (Daten, kein Code)
├─ tests/                geteilte Tests + eigene Drift-Tests
└─ .github/
   ├─ scripts/build_dependency_map.py   (gesät, danach Sync)
   └─ workflows/dependency-map.yml
```

### 9.2 Abhängigkeitsrichtung — als Test verankert

| Paket | darf sehen | darf **nie** sehen |
| --- | --- | --- |
| `core-ids` | — | alles andere |
| `errors` | `core-ids` | registry, machine, chart |
| `registry` | `core-ids`, `errors` | **machine**, chart |
| `trading` | `core-ids`, `errors`, `compute` | machine, feeds, chart-\* |
| `trace` | `core-ids` | alles andere — das Rechenband kennt nur Werte und Kanten |
| `machine` | `core-ids`, `errors`, `registry`, `feeds`, `compute`, `trading`, `trace` | **chart-\*** |
| `sim` | `machine`, `trading`, `trace`, `registry` | chart-\* |
| `chart-adapter` | `core-ids`, `errors` | machine, registry, feeds |
| `chart-bindung` | `core-ids`, `registry`, `chart-adapter` | machine, sim, feeds — die Werte kommen per Rückruf herein |
| `mcp` | alles | — |

Ein Drift-Test liest die `package.json`-Abhängigkeiten und die Importe und wird
rot, sobald eine Kante entsteht, die hier nicht steht. Ohne ihn wandert innerhalb
von Wochen ein `import` aus `machine` in `chart-lightweight`, und der zweite
Treiber ist nicht mehr austauschbar.

### 9.3 Werkzeuge

| Zweck | Wahl |
| --- | --- |
| Paketmanager | pnpm-Workspaces |
| Tests | vitest ^3.2.4 (Vorgabe aus dem geteilten Bündel) |
| Module | ESM, `"type": "module"` |
| Typecheck | `tsc --noEmit` **pro Paket** (siehe `paketFuer`) |
| Lint | ESLint mit eigenen Regeln: kein `Date.now()`/`Math.random()` in `compute` |

### 9.4 Geheimnisse

Venue-Schlüssel kommen vom **Business Manager** (Repo `whatsapp-manager`, Reiter
„Schlüssel"). Nichts davon wird von Hand in eine Datei geschrieben, erfunden oder
aus einer Datei zurückgelesen. Ist der MCP-Zugang aus, ist er aus — dann sagen wir
das, statt einen Umweg zu bauen. Im Repo steht nur der **Name** einer Variablen,
nie ihr Wert.

### 9.5 Prozess-Lebenszyklus

| Phase | Reihenfolge | Warum die Reihenfolge zählt |
| --- | --- | --- |
| Start | `errors` → `registry` laden → Journale lesen und **Recovery** → Leases erwerben → Maschinen starten | der Tracker muss stehen, **bevor** etwas schiefgehen kann; sonst geht der erste Fehler des Laufs verloren |
| Betrieb | Maschinen nach Priorität (`tags`) gestaffelt hochfahren | 200 Maschinen gleichzeitig in `WARMUP` erschlagen jedes Rate-Limit |
| Stopp | neue Eingaben aus → laufende Knoten abbrechen → Journal **flushen** → Fehlersenken flushen → Leases freigeben | ein `SIGTERM`, das das Journal nicht flusht, erzeugt beim nächsten Start ein `intent` ohne `applied` für jede Maschine |
| Notfall | Timeout beim geordneten Stopp → hart beenden, aber erst **nach** dem Journal-Flush | |

Konfiguration liegt in einer Datei (Pfade, Budgets, Grenzwerte, Feature-Schalter)
— Geheimnisse **nicht** (§9.4). Jeder Wert hat einen Default im Code; die Datei
überschreibt, Umgebungsvariablen überschreiben die Datei. Der gültige Satz wird
beim Start **einmal geloggt**, redigiert — sonst rätselt später jeder, mit welcher
Konfiguration ein Lauf gelaufen ist.

---

## 10. Meilensteine

| M | Ergebnis | Fertig, wenn … | Deckt Kanten |
| --- | --- | --- | --- |
| **M0** | Gerüst: pnpm, vitest, `core-ids`, `errors` | `canon()` und die Code-Tabelle sind getestet; Kanarienvogel-Test für Redaktion grün | C28, F69–F78 |
| **M1** | Werkzeug-Anschluss | `build_dependency_map.py` gesät, Eintrag in der Verteilliste gemergt, Map-Workflow hat **nachweislich einmal gelaufen**, `repo.mjs` steht | H86–H97 |
| **M2** | Registry vertikal | Definitionen ladbar, `resolve()` rein und getestet, Zyklus- und Schema-Fehler sind Fehler | C25–C32, C35, C36, C38–C40 |
| **M3** | Registry horizontal | Scope-Matrix, atomares Schreiben, Fremdschreiber-Erkennung greift im Doppellauf | C33, C34, C37, D41, D55 |
| **M4** | Feeds + `series` | CSV-/Replay-Feed und ein echter Venue; Zeit-, Lücken- und Duplikat-Regeln getestet | A1–A10, B11–B26, K119 |
| **M5** | Die Maschine | alle Übergänge mit Guards, Journal + Recovery, **Replay ≡ Live grün**, geordneter Stopp | D38–D47, D50–D55, I103 |
| **M6** | Chart-Adapter + zwei Treiber | Konformitätssuite grün gegen beide, Leak-Test grün, Abriss-Test grün | E53–E68, J104–J111 |
| **M7** | MCP lesend, **eine** Fläche | alle lesenden Werkzeuge, Paginierung, Altersangabe der Map, stdio | G79–G86, N141, N142, N155 |
| **M8** | Modelle | ein echtes Modell, Fallback-Kette, Trainingsmanifest, Kalibrierung ausgewiesen | D48, D49, K112–K118, K120 |
| **M9** | **Simulation, Entscheidung, Gewinn, Beleg** | Szenario läuft über die **Live**-Maschine mit `replay`-Feed; Fill-, Kosten- und Positionsmodell getestet; Geld als Ganzzahl; Stichproben aus dem Rechenband rechnen nach | L121–L140, G82 |
| **M10** | MCP schreibend | Entwurf/Aktivierung getrennt, `confirm`-Hash, Journal jeder Änderung mit Urheber | G79, G83, N143, N145, N146 |
| **M11** | **Flächen-Registry + Strategievergleich** | mehrere Flächen aus einem Kern, Allowlist-Filter greift, Wurzelfläche listet; Vergleich auf allen vier Ebenen, Zuordnung findet die erste Divergenz | N144, N147–N154 |

M5 ist der Punkt, ab dem das System etwas **behauptet**. Vorher ist jede Zahl
Deko. Deshalb steht „Replay ≡ Live" in seiner Abnahme und nicht später.

---

## 11. Teststrategie

| Art | Was sie prüft | Beispiel |
| --- | --- | --- |
| Einheit | reine Funktionen | `canon()`, `resolve()`, Lookback-Propagation |
| Property | Invarianten über zufällige Eingaben | Ticks↔Preis-Rundreise verliert nie einen Tick |
| Golden | feste Ein-/Ausgabe | EMA über einen fixen Datensatz, byteweise |
| **Äquivalenz** | **Replay ≡ Live** | der Test, der Look-ahead-Bias findet |
| Konformität | zwei Treiber, ein Ergebnis | dieselben Ops → dasselbe `readback()` |
| Nachrechnung | ein Beleg ergibt denselben Wert | Stichproben aus jedem Simulationslauf werden aus Registry + Rohdaten neu gerechnet |
| Invariante | Geld geht nicht verloren | Summe aller Belege + offene Positionen = Kontostand, in kleinster Einheit |
| Drift | Architektur hält | Abhängigkeitsrichtung, Code-Tabelle, `Date.now()`-Verbot, **kein `if (sim)`**, Portabilität von `lib.mjs` |
| Chaos | Verhalten unter Ausfall | Feed bricht mitten in `WARMUP` ab, Registry-Datei halb geschrieben, Uhr springt |
| Last | Grenzen | 200 Maschinen, 50 Layer, 1 Mio. Bars |

Windows ist der Arbeitsplatz: die Tests laufen dort, Pfade gehen über `path`,
keine POSIX-Annahmen (§12/I100).

---

## 12. Kanten-Register

Die Spalte **Wo** nennt den Ort, an dem die Gegenmaßnahme verankert ist — Test,
Regel oder Abschnitt. Eine Kante ohne Verankerung ist eine Notiz, keine Deckung.

Die Nummer ist eine **stabile Kennung**, keine Reihenfolge: sie besteht aus
Gruppenbuchstabe und Zahl und wird nie neu vergeben. Wächst eine Gruppe, bekommt
die neue Zeile die nächste freie Zahl **ihrer** Gruppe — deshalb gibt es sowohl
`D53` als auch `E53`, und beide sind eindeutig. Drei Buchstaben sind belegt und
kommen hier nicht vor: `M` für Meilensteine (§10), `V` für Annahmen (§0) und `W`
für Entscheidungen (§15).

| Gruppe | Thema | Zeilen | Fällig in |
| --- | --- | --- | --- |
| A | Zeit und Kalender | 11 | M4 |
| B | Marktdaten | 16 | M4 |
| C | Registry und Versionen | 17 | M2, M3 |
| D | Die Maschine | 18 | M5 |
| E | Chart-Adapter | 21 | M6 |
| F | Error-Tracker | 10 | M0 |
| G | MCP | 8 | M7, M10 |
| H | Werkzeug-Import | 12 | M1 |
| I | Zahlen, Betrieb, Arbeitsplatz | 6 | M0, M2, M5 |
| J | Bindung, Transport, Oberfläche | 8 | M6 |
| K | Modelle, Training, Datenrecht | 9 | M8 |
| L | Simulation, Entscheidung, Gewinn | 21 | M9 |
| N | MCP-Flächen und Strategievergleich | 16 | M7, M11 |
| | **Summe** | **173** | |

Jede Zeile hat eine Verankerung und einen Meilenstein. Das ist die Bedingung,
unter der dieser Plan „fertig" heißt — nicht, dass die Liste vollständig wäre.
Vollständig wird sie nie; sie wird nur **verlässlich gepflegt**: wer eine neue
Kante findet, trägt sie hier ein, bevor er sie behebt.

### A · Zeit und Kalender

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| A1 | Lightweight rechnet in UTC-Sekunden, ECharts in ms | Charts sind um Faktor 1000 verschoben oder leer | intern **nur `TimeMs`**; Umrechnung ausschließlich im Treiber | §5.5, Konformitätssuite |
| A2 | Sommerzeit bei Session-Instrumenten | Bars springen zweimal im Jahr um eine Stunde | alles UTC; Sessions aus `calendar` mit IANA-Zone, nie Lokalzeit-Arithmetik | `calendar`-Knoten |
| A3 | Feiertage und Halbtage | „Lücke" löst Backfill aus, der nie etwas findet | Kalender kennt Nichthandelstage; dort ist Fehlen **erwartet** | Guard `gap_detected` |
| A4 | FX-Wochenende (Sonntag 22:00 UTC) | Interpolation über 48 h erzeugt erfundene Bars | Whitespace statt Füllung | §5, Konformitätssuite |
| A5 | Venue liefert Mikrosekunden | Kollisionen nach dem Runden | auf ms **abschneiden** (nicht runden), dokumentiert | `feed`-Normalisierung |
| A6 | Bar-Zeitstempel: Open- oder Close-Zeit? | zwei Feeds verschieben sich um eine Bar gegeneinander | Festlegung: **Open-Zeit**; jeder Feed-Treiber normalisiert darauf | `feed`-Vertrag + Test je Treiber |
| A7 | 4h-Bars: Venue-Anker vs. Session-Anker | Resample liefert andere Bars als der Venue | `anchor` gehört zur Timeframe-Definition und in den `nodeHash` | §2.3 |
| A8 | Lokale Uhr weicht von Venue-Uhr ab | „stale" wird falsch erkannt, in beide Richtungen | Offset messen; Staleness gegen **Venue-Zeit** | Guard `feed_stale` |
| A9 | Feed liefert Zeitstempel in der Zukunft | Bar landet rechts vom Chartrand und blockiert Appends | Ablehnen + `VP-FEED-0012` | `feed`-Normalisierung |
| A10 | Anzeige-Zeitzone wird zur Rechenzeitzone | Indikatoren rechnen je Betrachter anders | Anzeige-tz existiert **nur** im Adapter | Drift-Test: keine tz-Bibliothek in `compute` |
| A11 | `1w`/`1M` haben ungleiche Länge | „200 Bars Lookback" wird als Zeitspanne gerechnet und ist im Februar zu kurz | Lookback zählt **immer Bars**, nie Zeit; Zeitspannen gibt es nur in der Anzeige | §3.1 |

### B · Marktdaten

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| B11 | Zwei Bars mit gleicher Zeit | stille Verdopplung im Indikator | gleicher Inhalt → ignorieren; anderer Inhalt → ersetzen + zählen | `series`-Test |
| B12 | Ticks kommen vertauscht an | Indikator rechnet rückwärts | `reorderWindow`-Puffer; danach verwerfen + `VP-FEED-0021` | `series`-Test |
| B13 | Venue korrigiert eine alte Bar | Chart und Modell rechnen ewig mit dem falschen Wert | `dataRevision` hochzählen → `replaceRange` + Invalidierung **aller** abhängigen Knoten ab `t` | §2.3, M4 |
| B14 | Split oder Dividende | Kurssprung wird als Signal gelesen | `adjust`-Transform; Adjust-Version steckt im `nodeHash` | §2.3 |
| B15 | Ticker wird umbenannt | Historie reißt, Cache verwaist | `instrumentId` trägt die Identität, Alias-Historie in der Registry | §2.1 |
| B16 | Delisting | Maschine wartet ewig auf Bars | `retire`; Chart bekommt eine sichtbare Endkappe | FSM |
| B17 | Feed-Ausfall erzeugt Lücke | Indikatoren rechnen über das Loch hinweg | `BACKFILL`; Lückenliste im Journal; Bereich im Layer als unvollständig markiert | M5 |
| B18 | Reconnect-Sturm | Venue sperrt die IP | exponentielles Backoff + Jitter, Höchstzahl, dann `DEGRADED` | `feed`-Treiber |
| B19 | Rate-Limit (429) | 200 Maschinen erschlagen einen Endpunkt | **ein** Token-Bucket je Venue über alle Scopes | §4.5 |
| B20 | Die laufende Bar ist unfertig | Signale aus einer halben Bar, die es nie gab | `provisional: true`; kein Signal wird aus provisorischen Bars persistiert | FSM + §5.2 |
| B21 | Kein Volumen (Index, manche FX) | Histogramm zeichnet überall 0 | `volume: null` erlaubt; Layer mit `needs-volume` wird **nicht aufgelöst**, mit Begründung | `resolve()` |
| B22 | Preis 0 oder negativ (CL im April 2020) | Log-Skala und Divisionen explodieren | Guard: Log-Skala fällt auf linear zurück mit Hinweis; keine ungeprüfte Division | §5.5, E59 |
| B23 | Sehr kleine Ticks (z. B. `0.00000001`) | Rundung frisst die Bewegung | `precision`/`minMove` aus Instrument-Metadaten, nie geraten | `LayerSpec.format` |
| B24 | Reihen wachsen unbegrenzt | Speicher läuft voll, Chart wird zäh | Ringpuffer `maxBars`; Historie wird beim Scrollen nachgeladen | M4, M6 |
| B25 | Zwei Feeds für dasselbe Instrument (primär/sekundär) | Failover liefert leicht andere Kurse, niemand sieht den Wechsel | Feed-Identität steckt in `dataRevision`; der Wechsel ist ein Journal-Ereignis und im Chart markiert | B13, M4 |
| B26 | Venue liefert eine Bar mit `high < low` oder `close` außerhalb `[low, high]` | Indikatoren rechnen mit Unsinn weiter | Plausibilitätsprüfung in der `feed`-Normalisierung, Bar verwerfen + `VP-FEED-0031` | M4 |

### C · Registry und Versionen

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| C25 | Zyklus im Graphen | `resolve()` läuft endlos | Ordnungszahl-Regel + Topo-Prüfung | §3.1 |
| C26 | Gleicher Name in zwei Namensräumen | falsche Definition wird gebunden | URN erzwingt Namensraum | §2.2 |
| C27 | Breaking Change an einer laufenden Definition | 200 Maschinen rechnen mitten im Tag anders | neue Major-Version; die alte bleibt aktiv bis zum Drain; nie „in place" | §3.3, §4.4 |
| C28 | Parameter-Kanonisierung (`1.0` vs `1`, `-0`, Schlüsselreihenfolge) | zwei Cache-Einträge für dieselbe Rechnung — oder einer für zwei verschiedene | `canon()` mit Tabelle und Tests | §2.4 |
| C29 | Ein Default ändert sich in einer neuen Version | alte Instanzen rechnen still anders | Defaults werden beim Upsert **in die gespeicherte Definition materialisiert** | §3.3 |
| C30 | Ausgabeschema eines Knotens driftet | Konsument liest ein Feld, das es nicht mehr gibt | `outputSchema` versioniert; Konsument deklariert die erwartete Version; Mismatch = Resolve-Fehler | §3.1 |
| C31 | Verwaiste Definition | Registry wächst zu, niemand traut sich zu löschen | GC nach Karenzzeit, nie was in einem Journal referenziert ist | §3.3 |
| C32 | Löschen einer benutzten Definition | laufende Maschine verliert ihren Plan | Löschen gibt es nicht — `deprecated` + `removeAfter` | §3.3 |
| C33 | Halb geschriebene Registry-Datei (Absturz, volle Platte) | ungültiges JSON, Start scheitert | `tmp` + `rename`, Hash-Prüfung beim Laden | Chaos-Test |
| C34 | Zwei Prozesse schreiben gleichzeitig | wer zuletzt schreibt, gewinnt; der andere Fortschritt ist **still** weg | Inhalts-Hash vor dem Schreiben erneut prüfen, sonst **laut** abbrechen — Muster aus `stand.mjs` | §3.3 |
| C35 | Profil-Vererbung mit Diamant (`extends`) | „letzter gewinnt" erzeugt zufällige Pläne | feste Merge-Reihenfolge; echter Konflikt ist ein **Fehler**, keine Auflösung | `resolve()`-Test |
| C36 | 500 Symbole × 6 Timeframes | 3.000 Registry-Einträge, unpflegbar | Definitionen sind vertikal, Instanzen horizontal und faul | §3.2 |
| C37 | `btcusdt` vs `BTCUSDT` | zwei Scopes für einen Markt, zwei Caches, zwei Maschinen | Normalisierung beim Eintrag; Kollision wird gemeldet | §2.1 |
| C38 | Eine Aktivierung war falsch | Rückweg ist ein Nachbau aus dem Gedächtnis | `activate` ist ein Zeigerwechsel, kein Überschreiben — Rollback ist derselbe Vorgang rückwärts, mit Journal-Eintrag | §3.3 |
| C39 | Knoten liest aus einem fremden Scope | Maschinen hängen gemeinsam; ein toter Scope legt zehn lahm | lesen ja, schreiben nie; `align` ist Pflicht; fremder Ausfall trifft nur den Zweig | §3.4 |
| C40 | Zyklus **über** Scope-Grenzen (A liest B, B liest A) | `resolve()` je Scope sieht keinen Zyklus — beide warten | Zyklusprüfung über den Graphen **aller** aktiven Scopes | §3.4 |
| C41 | `lookback` steht als feste Zahl in der Definition | eine EMA(50) rechnet ihren Warmup mit dem Default 20: der Plan meldet `LIVE`, während der Indikator noch anläuft — und dem Ergebnis sieht man es nicht an | `lookback.barsAus` zeigt auf den **Parameter**, nicht auf eine Konstante | §3.1, beim Bauen gefunden |

### D · Die Maschine

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| D38 | Venue hat weniger Historie als `warmupBars` | Maschine hängt für immer in `WARMUP` | `warmupPolicy: strict\|best-effort`; `best-effort` geht mit Begründung nach `DEGRADED` | FSM |
| D39 | Definition ändert sich, während es läuft | Riss mitten in der Serie | blau/grün: neuer Plan wird daneben warm, dann umgeschaltet; alter drainiert | §4.4 |
| D40 | Absturz mitten im Zustandswechsel | Zustand auf der Platte ist weder A noch B | Journal mit `intent`/`applied`; Recovery beim Start | §4.3 |
| D41 | Zwei Prozesse fahren denselben Scope | doppelte Signale, doppelte Venue-Last | Lease mit TTL; ohne Lease kein Schreiben | `ScopeRow.lease` |
| D42 | `bar_close` hängt an einem Timer | Timer-Drift erzeugt Bars, die es nicht gibt | Ereignisse kommen **aus dem Datenstrom**, nie aus einem Wecker | FSM-Test |
| D43 | Ein langsamer Knoten blockiert den ganzen Plan | alle Scopes stehen | Zeitbudget je Knoten, Abbruch, `DEGRADED`; `cost: high` im Worker | §4.5 |
| D44 | Ticks kommen schneller als die Rechnung | Warteschlange wächst bis zum Speicherende | Coalescing auf Bar-Ebene, Drop-Politik dokumentiert, Verworfenes **gezählt** | §4.5 |
| D45 | Journal wächst unbegrenzt | Platte voll, Recovery dauert Minuten | Rotation + Kompaktierung auf Snapshots | M5 |
| D46 | `retire` mitten in der Berechnung | halb freigegebene Ressourcen, Zombie-Worker | `AbortSignal`; Freigabe ist idempotent | M5 |
| D47 | `HALTED` ↔ `LIVE` flattert | Alarmlawine, Venue-Sperre | Cooldown + Hysterese (3 gesunde Bars), Backoff beim Wiederanlauf | FSM |
| D48 | Modell fehlt oder lädt nicht | Absturz statt Betrieb | Fallback-Kette in der Definition; ohne Fallback `DEGRADED` | M8 |
| D49 | Modell liefert `NaN`/`Inf` | `NaN` wandert durch alle Folgeknoten bis in den Chart | am Modellausgang prüfen, Signal unterdrücken, `VP-MODEL-*` melden | M8 |
| D50 | **Look-ahead-Bias** | Backtest glänzt, Live verliert Geld | **Replay ≡ Live** als Pflichttest in jeder CI | §4.3, M5 |
| D51 | Zwei gleichrangige Knoten, unbestimmte Reihenfolge | Ergebnisse schwanken zwischen Läufen | stabile Sortierung nach `nodeHash` | §4.3 |
| D52 | Mensch erzwingt einen Übergang | niemand kann später erklären, warum | `force` nur mit Begründung, beides im Journal | §4.2 |
| D53 | `SIGTERM` mitten im Betrieb | Journal nicht geflusht → beim Start hat **jede** Maschine ein `intent` ohne `applied` | geordneter Stopp mit fester Reihenfolge, Journal-Flush vor allem anderen | §9.5 |
| D54 | 200 Maschinen starten gleichzeitig | jedes Venue-Rate-Limit reißt in der ersten Minute | gestaffelter Start nach `tags` | §9.5 |
| D55 | Lease läuft ab, während die Maschine rechnet | zwei Prozesse halten sich beide für zuständig | Lease wird **vor** Ablauf erneuert; misslingt das, hält die Maschine selbst an, statt weiterzuschreiben | §4.2, D41 |

### E · Chart-Adapter

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| E53 | Ein Treiber kann ein `kind` nicht | Layer fehlt **still**, niemand merkt es | Fähigkeitsmatrix; `degradable` → vereinfacht zeichnen + `info`; sonst leer **mit Hinweis in der Legende** | §5.3 |
| E54 | Patch trifft vor Snapshot ein | Chart zeigt ein Loch | `rev` je Layer; Lücke → Snapshot anfordern | §5.2 |
| E55 | Autoscroll reißt den Nutzer zurück | Chart ist nicht bedienbar | `followMode` nur am rechten Rand | §5.5 |
| E56 | Theme-Wechsel | Remount, alle Daten neu geladen | Style-Tokens + `setStyle` | §5.5 |
| E57 | Handle wird nicht freigegeben | Speicher wächst bei jedem Scope-Wechsel | `destroy()`; Test bindet/löst 100× und prüft den Heap | M6 |
| E58 | 50 Layer, 1 Mio. Punkte | Chart friert ein | Höchstzahl je Pane + Warnung; LTTB-Downsampling **nur für Linien**, nie für Kerzen | M6 |
| E59 | Log-Skala mit Werten ≤ 0 | leerer oder kaputter Chart | Guard → linear, mit sichtbarem Hinweis | §5.5 |
| E60 | Prozent-Skala braucht einen Bezugspunkt | Werte springen beim Scrollen | Bezug = erste sichtbare Bar, bei Bereichswechsel neu gerechnet | Konformitätssuite |
| E61 | Tausende Marker | Chart wird unlesbar und langsam | Clustern ab Dichte, Limit je Sichtbereich | M6 |
| E62 | Layer wechselt von Overlay zu Sub-Pane | leere Panes bleiben zurück | Pane-Lebenszyklus; leere Panes werden entfernt | §5.1 |
| E63 | Zwei Layer bekommen dieselbe Farbe | im Chart nicht unterscheidbar | Farbe deterministisch aus `nodeHash`, Kollisionsprüfung je Pane | §5.5 |
| E64 | Tooltip bei einer Reihe mit Lücken | Tooltip zeigt nichts oder rät | definierte Semantik „letzter gültiger Wert vor `t`" | Konformitätssuite |
| E65 | Chart zeigt Scope A, Registry wechselt zu B | zwei Märkte in einer Serie | Handle ist scope-gebunden; Wechsel = `destroy` + `bind` | §5.1 |
| E66 | Provisorische Bar | Betrachter hält einen Zwischenstand für final | gestrichelt/halbtransparent; bei Close `updateLast` | §5.2 |
| E67 | Zeitachse links ohne Daten | Chart springt beim Nachladen | Whitespace statt Sprung | Konformitätssuite |
| E68 | Tests brauchen einen Browser | Chart-Fehler fallen erst manuell auf | `readback()` statt Pixelvergleich, headless in CI | §5.4 |
| E69 | Instrument-Metadaten ändern sich im laufenden Strom | der Chart rundet ab einer Bar plötzlich anders | Änderung an `precision`/`minMove` = `reset` des Layers + neuer Snapshot | §5.2 |
| E70 | Ein Treiber-Fehler in einem Layer | die ganze Oberfläche fällt aus | Fehlergrenze je Layer: der kaputte wird deaktiviert und gemeldet, der Rest zeichnet weiter | M6 |
| E71 | Kapitalkurve ändert sich nur bei Trades | Linie mit Löchern über einer lückenlosen Preisachse | Kapitalkurve wird je Bar fortgeschrieben (`ffill`), nicht nur bei Fills | §4.8, §3.4 |
| E72 | Die Test-Attrappe verhält sich anders als die Bibliothek | die Konformitätssuite ist grün, der Browser nicht: Lightweight gibt Whitespace über `series.data()` nicht zurück, die Attrappe tat es — EMA(50) hielt im Browser 49 Punkte weniger als in ECharts | Vertrag auf das Beobachtbare beschränkt (Rückschau ohne Whitespace); Attrappe an die Bibliothek angeglichen; **Sichtprobe** vergleicht `__VP_RUECKSCHAU__` beider Treiber im echten Browser | §5.4, beim Bauen gefunden |
| E73 | Bibliotheksvorgabe begrenzt die Dichte | Lightweight hält Bars mindestens 0,5 px auseinander; 4.329 Stundenbars passen nicht in einen halben Bildschirm, `fitContent()` zeigt still nur das letzte Sechstel | `minBarSpacing` ausdrücklich gesetzt; Sichtprobe vergleicht den sichtbaren Zeitraum beider Treiber | §5.5, beim Bauen gefunden |

### F · Error-Tracker

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| F69 | Fehlerlawine (1.000/s) | Log läuft voll, echtes Problem geht unter | Dedupe per `fingerprint` + Sampling; **Zähler bleibt exakt** | §6.3 |
| F70 | Fehler in der Fehlersenke | Endlosschleife, Prozess stirbt | jede Senke gekapselt, `lastSinkError`, kein Rückweg in den Tracker | §6.3 |
| F71 | Fehler über die Worker-Grenze | `cause`-Kette geht verloren, Meldung wird `[object Object]` | `toWire()`/`fromWire()` | M0 |
| F72 | Geheimnis im Fehlertext | API-Key steht in einer Logdatei | Allowlist-Redaktion + Kanarienvogel-Test | §6.3, §9.4 |
| F73 | Systemzeit springt (NTP, Suspend) | Budget leert oder füllt sich sprunghaft | Budgets auf der monotonen Uhr | §6.2 |
| F74 | `unhandledRejection` | Prozess stirbt ohne Spur | an den Tracker gebunden, `scope: null` | §6.3 |
| F75 | Fehler vor dem ersten Scope (Bootstrap) | Fehler ohne Zuordnung wird verworfen | `scope: null` erlaubt, eigener Topf `global` | §6.1 |
| F76 | Zwei Codes mit gleicher Nummer | Budgets mischen sich, Auswertung lügt | Code-Tabelle in **einer** Datei + Drift-Test | §6.2 |
| F77 | NDJSON wächst unbegrenzt | Platte voll — und der Tracker ist die letzte Stelle, die das melden könnte | Rotation, Größenbudget, ältestes zuerst | §6.3 |
| F78 | `retryable` falsch gesetzt | endlose Wiederholung eines terminalen Fehlers | Klasse steht an jedem Code; Vollständigkeitstest | §6.2 |

### G · MCP

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| G79 | Schreibende Werkzeuge stehen offen | ein Agent aktiviert versehentlich eine halbe Definition | Standard lesend; schreibende Werkzeuge **existieren nicht**, wenn nicht freigeschaltet | §7 |
| G80 | Antwort mit 50.000 Zeilen | Kontextfenster ist weg, Antwort unbrauchbar | Paginierung + harte Byte-Obergrenze + Cursor | §7 |
| G81 | Prompt-Injection über Registry-Texte | ein Beschreibungstext wird zur Anweisung | Ausgabe als Daten gekennzeichnet, Steuerzeichen entfernt | §7 |
| G82 | Backtest als Dauerlast | ein Werkzeugaufruf legt die Maschine lahm | `maxBars`, Timeout, `maxParallel`; klare Ablehnung statt stiller Drosselung | §7 |
| G83 | Zwei Agenten schreiben gleichzeitig | einer überschreibt den anderen | Fremdschreiber-Erkennung + `confirm`-Hash aus der Vorschau | §3.3, §7 |
| G84 | Jemand wünscht sich ein Order-Werkzeug | ein Agent löst einen Handel aus | **gibt es nicht** — §13, als Architekturentscheidung, nicht als Einstellung | §13 |

| G86 | MCP-Server lauscht auf einem Port | jeder im Netz liest Registry, Belege und Kontostände | Standard ist **stdio, lokal**; ein Netz-Modus ist ohne Authentifizierung nicht startbar | M7 |

### I · Zahlen, Betrieb, Arbeitsplatz

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| I98 | Fließkomma-Vergleiche auf Preisen | `0.1 + 0.2 !== 0.3`, Signale kippen zufällig | intern Ganzzahl-Ticks + `minMove`; Fließkomma nur an der Oberfläche | §4.3 |
| I99 | Cache-Schlüssel ohne Datenrevision | nach einer Korrektur zeigt alles weiter alte Werte | `dataRevision` steckt im `nodeHash` | §2.3, B13 |
| I100 | POSIX-Annahmen auf Windows | Pfade brechen auf dem Arbeitsplatz, auf dem entwickelt wird | `path` überall, Tests laufen auf Windows | §11 |
| I101 | Befehle in der Doku mit `&&` | PowerShell 5.1 wirft einen Parser-Fehler, der Befehl ist nicht klickbar | `;` oder `if ($?) { … }`, Blöcke als ```powershell | dieses Dokument |
| I102 | Geheimnis von Hand in eine `.env` geschrieben | ein Schlüssel liegt im Klartext und niemand weiß, welcher Stand gilt | Business Manager ist die Quelle; im Repo nur der **Name** | §9.4 |
| I103 | Zeitreihen-Cache über Neustart hinweg | ein alter Cache mit neuem Code liefert Werte, die kein Code mehr erzeugt | `codeGeneration` steckt im `nodeHash`; Mismatch = kalt starten | §2.3, M2 |

### J · Bindung, Transport, Oberfläche

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| J104 | Zwei Charts auf demselben Scope | doppelte Rechnung, doppelte Venue-Last | Fan-out: eine Maschine, n Abonnenten | §5.6 |
| J105 | Tab wird geschlossen, ohne abzumelden | Abonnenten-Leck, Ops werden ins Leere geschickt | Heartbeat mit TTL; das Abo läuft aus | §5.6 |
| J106 | Verbindung bricht ab | der eingefrorene Chart sieht aus wie ein ruhiger Markt | `staleSince` im Handle, Oberfläche sagt „getrennt"; Wiederverbindung fordert Snapshot | §5.6 |
| J107 | Langsamer Client, schneller Strom | Server puffert bis zum Speicherende | begrenzter Puffer je Abonnent; Überlauf = `reset('overflow')` | §5.6 |
| J108 | `bigint`-Ticks über JSON | `TypeError` oder stiller Präzisionsverlust | eigenes Wire-Format, Ticks als String, Roundtrip-Test | §5.6 |
| J109 | Blick in die Vergangenheit, während es live läuft | Appends mischen sich in einen historischen Ausschnitt | Leseansicht ist eingefroren; Appends außerhalb des sichtbaren Bereichs werden gepuffert, nicht gezeichnet | §5.6 |
| J110 | Vergleichs-Layer über zwei Kalender | Punkte liegen auf verschiedenen Zeitachsen, der Vergleich lügt | `align: 'outer'\|'inner'\|'ffill'` ist Pflicht, nie stillschweigend | §3.4 |
| J111 | Maschine ist `DEGRADED`, Chart zeigt es nicht | der Betrachter hält reduzierte Werte für volle | Zustand gehört in den Handle und sichtbar an den Chart | §4.1, §5.6 |

### K · Modelle, Training, Datenrecht

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| K112 | Modellgewichte sind kein Parameter | ein ausgetauschtes Modell hat denselben `nodeHash` wie das alte — Cache liefert die alten Vorhersagen | `artifactHash` steckt im `nodeHash` | §2.3 |
| K113 | Gewichte im Git | Repo bläht auf, Diffs sind wertlos, Klone dauern Minuten | Artefaktspeicher außerhalb; im Repo nur Hash und Herkunft | M8 |
| K114 | Feature enthält den Vorhersagezeitpunkt (Leakage) | Backtest ist perfekt, Live verliert | jede `feature`-Definition deklariert ihren Zeitversatz; der Split prüft ihn; **Replay ≡ Live** deckt den Rest | D50, M8 |
| K115 | Train/Test zufällig statt zeitlich geteilt | Zukunft im Training, unbemerkt | nur zeitliche Splits, als Regel im `model`-Vertrag | M8 |
| K116 | Trainingslauf ohne Manifest | Ergebnis nicht wiederholbar, Ursache nicht auffindbar | Manifest: Datensatz-Hash, Seed, Bibliotheksversionen, Commit | M8 |
| K117 | Unkalibrierte Konfidenz wird als Wahrscheinlichkeit gelesen | „80 %" heißt nichts, wird aber geglaubt | Ausgabe trägt `calibrated: bool` + Kalibrierungsbericht | M8 |
| K118 | Datenlücke im Trainingssatz | das Modell lernt die Lücke als Muster | Abdeckungsbericht je Lauf, Mindestabdeckung als Guard | M8 |
| K119 | Marktdaten dürfen nicht weitergegeben werden | ein Export oder ein geteilter Chart verletzt die Lizenz | `redistribution`-Feld je `venue`; jeder Ausgabeweg prüft es | M4 |
| K120 | Modell wird zur Empfehlung umgedeutet | aus einer Wahrscheinlichkeit wird ein „kauf" | Ausgabe ist Wahrscheinlichkeit + Fehlerband; keine Handlungsempfehlung im Vertrag | §13 |

### L · Simulation, Entscheidung, Gewinnrechnung

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| L121 | Fill zum Close derselben Bar | Look-ahead: der Backtest kauft zum Preis, den er gerade erst erfahren hat | frühestens **Open der nächsten Bar**, plus Spread und Slippage | §4.7 |
| L122 | Gebühren, Spread, Slippage fehlen | eine Strategie mit vielen Trades sieht profitabel aus und ist es nie | Kostenmodell ist **Pflichtfeld** des Szenarios; ein Lauf ohne wird abgelehnt | §4.6 |
| L123 | Geld als Fließkommazahl | Cent-Differenzen summieren sich; die Summe der Teile ist nicht das Ganze | Ganzzahlen in der kleinsten Einheit, Invariantentest auf die Summe | §4.7 |
| L124 | Positionsgröße als Prozent des Kontos | pfadabhängig — eine andere Reihenfolge ergibt ein anderes Endkapital | deterministische Reihenfolge über alle Scopes (nach `scopeKey`), im Beleg vermerkt | §4.7 |
| L125 | Mehrere Scopes teilen ein Konto | Gesamtrisiko prüft niemand, Margin reißt „überraschend" | Konto ist eine eigene Instanz über Scopes; Risikobudget wird zentral geführt | §4.7 |
| L126 | Teilfüllung, Ablehnung, `minQty`, Tick-Rundung | Simulation füllt immer voll, live passiert das nie | Fill-Modell kennt `minQty`, `stepSize`, `minNotional` und Ablehnung; was mit dem Rest geschieht, ist **definiert**, nicht implizit | §4.7 |
| L127 | Funding bei Perpetuals, Leihkosten beim Short, Übernachtzinsen | Ergebnis systematisch zu gut, und zwar dauerhaft | `position` führt Finanzierung je Periode aus dem Kalender | §4.7 |
| L128 | Margin und Liquidation | die simulierte Position überlebt, was live liquidiert worden wäre | Margin-Prüfung je Bar; Liquidation ist ein Ereignis **im Beleg** | §4.7 |
| L129 | Zwei Läufe mit verschiedenen Kosten- oder Marktmodellen verglichen | Verwechslung statt Vergleich, mit einer Zahl untermauert | `szenarioHash`; `vp_sim_diff` verweigert bei Abweichung | §4.6, §7 |
| L130 | Parametersuche über hunderte Läufe | Überanpassung — irgendein Satz sieht immer gut aus | Anzahl der Läufe je Szenario-Familie wird mitgeführt und **im Bericht genannt** | §4.6 |
| L131 | Universum enthält nur Überlebende | Survivorship-Bias schönt jedes Ergebnis | Universum aus einem historischen Stand inklusive delisteter Instrumente; sonst steht die Einschränkung im Bericht | §4.6 |
| L132 | Warmup liegt im Bewertungszeitraum | die ersten Entscheidungen beruhen auf halb gefüllten Indikatoren | `warmupVor` liegt **vor** `von`, geprüft beim Start des Laufs | §4.6 |
| L133 | Volles Rechenband bei Millionen Bars | Platte voll, Lauf bricht nach Stunden ab | Stufen `off \| entscheidungen \| voll`; `voll` nur mit Zeitraum-Obergrenze | §4.8 |
| L134 | Bar wird korrigiert, eine Entscheidung stand darauf | entweder stille Geschichtsfälschung oder zwei Wahrheiten nebeneinander | Beleg bleibt **unverändert** und bekommt einen Vermerk mit beiden Revisionen | §4.8 |
| L135 | Backfill verarbeitet einen Zeitraum erneut | derselbe Gewinn wird zweimal gezählt | Idempotenz über `belegId`: Wiederholung **ersetzt**, addiert nicht | §4.8 |
| L136 | Fremdwährung mit dem heutigen Kurs bewertet | eine Entscheidung von 2024 wird mit dem Kurs von heute verrechnet | FX ist ein eigener `series`-Knoten; Umrechnung mit Kurs **zum Zeitpunkt** | §4.7 |
| L137 | Jemand baut eine Abkürzung `if (sim) …` | Simulation und Live laufen auseinander, die Backtest-Zahl beschreibt ein System, das nie live ging | Drift-Test: kein Simulations-Zweig in `compute`/`machine`; Unterschiede **nur** über Feed, Clock und `execution` | §4.6 |
| L138 | Zwei Simulationen parallel | gemeinsamer Cache lässt Läufe sich gegenseitig beeinflussen | `szenarioHash` steckt im Cache-Schlüssel, jeder Lauf hat seinen Namensraum | §4.6 |
| L139 | Simulationsuhr steht an handelsfreien Tagen still | Finanzierungskosten über ein langes Wochenende fallen aus | die Simulationsuhr folgt dem **Kalender**, nicht nur dem Bar-Strom | §4.6, A3 |
| L140 | Ein Beleg ohne `planHash` und `datenstand` | in einem halben Jahr ist nicht mehr feststellbar, womit gerechnet wurde | beide Felder sind Pflicht; Stichprobentest rechnet Belege nach | §4.8 |
| L141 | Einstand je Stück wird zurückmultipliziert | die Geld-Invariante bricht um Bruchteile eines Cents — sichtbar erst als „10.006,43 ≠ 10.006,43" | das Konto führt eine **exakte Kostenbasis**; der Einstand je Stück ist abgeleitet und nur Anzeige | §4.7, beim Bauen gefunden |

### N · MCP-Flächen und Strategievergleich

*(Der Buchstabe `M` ist für die Meilensteine vergeben — deshalb `N`.)*

| # | Kante | Ohne Gegenmaßnahme | Gegenmaßnahme | Wo |
| --- | --- | --- | --- | --- |
| N141 | Eine Fläche hält ihren Ausschnitt für das Ganze | ein Agent schließt aus drei Märkten auf alle und irrt mit Nachdruck | jede Fläche beschreibt ihren Ausschnitt; jede gefilterte Antwort sagt, dass sie gefiltert ist | §7.1, §7.4 |
| N142 | `scopeFilter` als Blocklist gebaut | jeder neue Markt ist versehentlich sichtbar | **Allowlist**, ausnahmslos — was nicht genannt ist, existiert für die Fläche nicht | §7.1 |
| N143 | Fläche darf ihren eigenen Filter ändern | die Grenze ist keine | Flächen sind Registry-Definitionen: Entwurf, Aktivierung, Journal — nie Selbstbedienung | §7.1, §3.3 |
| N144 | Alle Flächen teilen ein Simulationskontingent | ein Agent bei der Parametersuche legt alle anderen lahm | Budget je Fläche (`simLaeufeProStunde`) | §7.1 |
| N145 | Journal-Eintrag ohne Urheber | „wer hat die Maschine angehalten" ist nicht beantwortbar | `identitaet` steht in jedem Journal-Eintrag und an jedem Fehler | §7.1, §6.1 |
| N146 | Zwei Flächen kommandieren dieselbe Maschine | widersprüchliche Befehle in Sekundenabstand | Steuerbefehle laufen über dieselbe Lease und denselben `confirm`-Hash; der zweite scheitert an der Version | D41, G83 |
| N147 | Belege einer fremden Strategie sichtbar | eine Strategie liest die Entscheidungen der anderen — Vergleich wird zur Abschrift | Belege sind an `strategieHash` gebunden; nur die Wurzelfläche und ein ausdrücklicher Vergleich sehen beide | §7.1, §7.3 |
| N148 | Vergleich über verschiedene Prüfstände | eine Zahl, die zwei Dinge gleichzeitig misst | `datenHash` muss gleich sein; sonst **Verweigerung**, keine Warnung | §4.6, §7.3 |
| N149 | Ergebnisunterschied ohne Ursache | „B verdient mehr" — und die nächste Änderung ist wieder geraten | Ebene 4: Rechenketten rückwärts bis zum ersten abweichenden `wertId` | §7.3 |
| N150 | 200 Varianten durchprobiert, die beste berichtet | Überanpassung mit Beleg-Charakter | Zähler je Szenario-Familie, im Bericht genannt | §7.3, L130 |
| N151 | Vergleich nennt einen Sieger | aus einer Messung wird eine Empfehlung | Ausgabe nennt Unterschiede und Beträge, kein Urteil | §13 |
| N152 | Zwei Strategien ohne gemeinsame Abstammung verglichen | 41 Unterschiede, keiner davon erklärbar | `eltern` macht die Kette lesbar; ohne gemeinsamen Vorfahren warnt der Vergleich vor seiner eigenen Aussagekraft | §3.5 |
| N153 | Strategie wird geändert, statt eine neue anzulegen | alte Läufe verweisen auf einen `strategieHash`, den es so nie gab | Strategien sind unveränderlich; eine Änderung ist ein neues Kind mit `eltern` | §3.5, §3.3 |
| N154 | Flächen teilen sich einen Prozess und einen Absturz | eine kaputte Fläche nimmt alle mit | ein Server-Kern, aber Fehlergrenze und Budget je Fläche; eine Fläche kann nur sich selbst anhalten | §7.1 |
| N155 | Netz-Transport ohne Authentifizierung | Registry, Belege und Kontostände liegen offen | `transport: netz` ist ohne `auth` **nicht startbar**; Standard bleibt stdio | G86, §7.1 |
| N156 | Verhaltensvergleich sieht nur die Richtung | „beide entscheiden gleich" bei 160,26 USDT Unterschied — gleiche Richtung, andere Positionsgröße | die **Menge** gehört zur Entscheidungskennung; ein Ergebnisunterschied ohne Verhaltensunterschied ist ein Widerspruch und als solcher getestet | §7.3, beim Bauen gefunden |

---

## 13. Bewusst nicht im Umfang

| Nicht drin | Warum |
| --- | --- |
| **Orderausführung** — kein Broker-Anschluss, kein Order-Werkzeug, auch nicht „nur Paper" gegen eine echte Börse | Ein Predictor, der handeln kann, ist ein Handelssystem mit anderen Haftungs- und Sicherheitsanforderungen. Die Grenze zieht man am Anfang oder gar nicht. Die Simulation (§4.6) rechnet Fills **selbst**, gegen ein Modell, ohne jede Verbindung nach draußen |
| **Steuern** in der Gewinnrechnung | Haltefristen, Verrechnungstöpfe und Länderrecht sind ein eigenes System. `pnl` rechnet vor Steuern, und das steht an jeder Kennzahl |
| **Anlageberatung** — keine Empfehlung „kaufen/verkaufen" an einen Menschen | Ausgabe ist Wahrscheinlichkeit und Konfidenz, mit Fehlerband |
| Multi-Tenant-Rechteverwaltung | ein Betreiber; kommt erst mit dem zweiten |
| Verteilter Betrieb über mehrere Maschinen | Lease ist vorgesehen (§D41), die Umsetzung wartet auf V1 |
| Eigene Zeitreihen-Datenbank | Parquet/CSV auf der Platte genügt, bis es nicht mehr genügt |

---

## 14. Stand der Kanten-Abarbeitung

### Gedeckt (mit Test)

| Kanten | Wo verankert |
| --- | --- |
| A5, A6, A9, A11 | `feeds/normalisierung.ts`, `core-ids/zeit.ts` — Millisekunden-Abschnitt, Öffnungszeit, Zukunftsabweisung, Lookback in Bars |
| B11, B12, B22, B26 | `feeds/normalisierung.ts` — Duplikate, Umsortierung, nicht-positive Preise, unplausible Bars |
| B17 | Lückenerkennung + `BACKFILL` mit Hysterese |
| C25, C28, C29, C30, C34, C37 | `registry/resolve.ts`, `core-ids/kanon.ts`, `registry/speicher.ts` |
| D38, D42, D50, D51, D52 | `machine/` — Warmup-Politik, Ereignisse aus dem Strom, **Replay ≡ Live**, stabile Sortierung, `erzwungen` mit Begründung |
| E53, E54, E55, E56, E61, E63, E64, E66, E68 | `chart-adapter/`, `chart-bindung/` — sichtbares Vereinfachen, `rev`-Lücke, Marker-Flut, Farbe aus nodeHash, Whitespace, Rückschau statt Pixel, **zwei echte Treiber** |
| F69, F70, F72, F73, F76, F78 | `errors/` — Dedupe mit exaktem Zähler, gekapselte Senken, Kanarienvogel, monotone Uhr, Code-Tabelle |
| G79, G80, G81, G82, G85, G86 | `mcp/` — Werkzeuge existieren nur mit Stufe, Byte-Grenze + Cursor, Registry-Texte entschärft, Simulationsbudget, Alter der Code-Karte, nur stdio |
| N141–N148, N150, N151, N154, N155 | Flächen als Registry-Einträge, Allowlist, Budget je Fläche, Urheber an jedem Fehler, Bindung an eine Strategie, Vergleich nur über die Wurzel, kein Sieger, ein Prozess je Fläche |
| H86 | `build_dependency_map.py` von Hand gesät |
| I98, I99, I103 | `core-ids/zahlen.ts`, `nodeHash` mit `dataRevision` und `codeGeneration` |
| L121, L122, L123, L126, L132, L133, L135, L140 | `trading/`, `sim/`, `trace/` |
| L129, N148 | `vergleiche()` verweigert bei abweichendem `datenHash` |
| L130, N150 | Lauf-Zähler je Prüfstand, im Bericht genannt |
| N149 | Zuordnung Ebene 4 — findet den ATR-Knoten |

### Beim Bauen gefunden, nicht im Register vorhergesehen

| Fund | Was schiefging | Gegenmaßnahme |
| --- | --- | --- |
| **Abgeleiteter Einstand** | Die Geld-Invariante brach um Bruchteile eines Cents, weil der Einstand je Stück zurückmultipliziert wurde | Das Konto führt eine **exakte Kostenbasis**; der Einstand je Stück ist nur noch Anzeige. Neu als L141 |
| **Warmup aus der Definition** | `lookback: { bars: 20 }` galt auch für eine EMA(50) — der Plan meldete `LIVE`, während der Indikator noch anlief | `lookback.barsAus` zeigt auf den **Parameter**. Neu als C41 |
| **Vergleich ohne Menge** | Ebene 2 meldete „entscheiden gleich" bei 160,26 USDT Ergebnisunterschied — gleiche Richtung, andere Positionsgröße | Die Menge gehört zur Entscheidungskennung. Neu als N156 |
| **Attrappe lügt** | Konformitätssuite grün, Browser nicht: echte Lightweight-Bibliothek liefert keinen Whitespace zurück | Vertrag auf das Beobachtbare beschränkt, Attrappe angeglichen, Sichtprobe vergleicht beide Treiber. Neu als E72 |
| **Stille Dichtegrenze** | Lightweight zeigte Mai–Juli, ECharts das Halbjahr — `minBarSpacing` 0,5 px | ausdrücklich gesetzt. Neu als E73 |
| **SDK im falschen Paket** | `scripts/mcp.ts` importierte das MCP-SDK selbst — es hängt aber nur an `packages/mcp`; zur Laufzeit nicht auffindbar | Stdio-Start ins Paket (`starteStdio`), das Skript reicht nur noch Fläche und Prüfstand hinein |
| **Deckung nur behauptet** | C30 stand hier als gedeckt, aber `resolve()` verglich nur die Art. `ausgabeSchema` stand an der Quelle, kein Eingang deklarierte, was er liest — eine Quelle auf `@2` wäre still in jeden `@1`-Leser gelaufen | `EingangsSchacht.schema` ist Pflicht; `resolve()` lehnt fehlende Deklaration und Mismatch mit `VP-REG-0003` ab. Gefunden beim Ersetzen der Saat-Belege, nicht beim Bauen |
| **Beschriftungen und Fensternamen** | 74 Marker-Texte überdeckten die Kerzen; ECharts-Fensternamen stießen an die Preisachse | ab 40 Markern nur Pfeile, sichtbar vermerkt (E61); Lücke zwischen den Gittern vergrößert |

Diese stehen als Zeilen in §12 (L141, C41, N156, E72, E73). Die Regel aus §12 gilt
auch für den, der sie geschrieben hat: erst eintragen, dann beheben.

---

## 15. Entschieden — mit Rückweg

Eine offene Frage, die niemand stellt, wird beim Bauen stillschweigend
beantwortet — meist von dem, der gerade tippt, und dann steht sie an dreißig
Stellen verschieden im Code. Deshalb ist hier alles entschieden, was sich mit
den bekannten Randbedingungen entscheiden **lässt**.

Die dritte Spalte ist die wichtige: **woran man merkt, dass die Entscheidung
falsch war.** Eine Entscheidung ohne Umkehrmerkmal ist eine Wette.

| # | Entschieden | Warum | Rückweg — wenn das eintritt, neu entscheiden |
| --- | --- | --- | --- |
| W1 | **Krypto zuerst** (Binance Spot), Aktien ab M4b | 24/7, kein Handelskalender, keine Kapitalmaßnahmen, freie Historie — Gruppe A und die halbe Gruppe B fallen im ersten Durchgang weg | ein Szenario, das Aktien wirklich braucht. Dann `calendar` + `adjust` vorziehen, beides ist im Plan schon vorgesehen |
| W2 | **Modellkern in TypeScript**, im selben Prozess | ein Prozess, eine Uhr, keine IPC-Grenze — Determinismus (§4.3) ist damit billig. Der `model`-Vertrag ist trotzdem so geschnitten, dass er über HTTP laufen kann | das erste Modell, das eine Bibliothek braucht, die es in TS nicht gibt. Dann Python-Sidecar hinter demselben Vertrag, Uhr bleibt hier |

| W4 | **Registry als Dateien** + atomares Schreiben | 5.000 Definitionen sind ein paar Megabyte; eine Datenbank für Daten, die man lesen und im Diff sehen will, ist Aufwand ohne Gegenwert | `resolve()` über alle Scopes braucht > 200 ms, oder die Registry überschreitet 5.000 Definitionen. Dann SQLite hinter derselben Schnittstelle |
| W5 | **dep-map nur als Artefakt**, kein D1 | kein Cloudflare-Konto an diesem Repo; das Artefakt erfüllt den Zweck, und `fetch-dep-map` erwartet genau diesen Namen | ein Dienst braucht die Karte zur Laufzeit statt beim Nachschlagen |
| W6 | **Kontowährung EUR**, FX als eigener `series`-Knoten, je Szenario überschreibbar. **Der erste Lauf rechnet in USDT** und sagt das an jeder Kennzahl | der Arbeitsplatz rechnet in Euro; Beträge deutsch (`1.234,50 €`). Eine EUR-Zahl ohne EURUSD-Reihe wäre aber erfunden — `KontoSpec.fx` trägt deshalb `{ art: 'keine' }`, bis die Reihe da ist | sobald eine FX-Reihe vorliegt: `fx: { art: 'serie' }` setzen, Vorgabewährung auf EUR. Am Vertrag ändert sich nichts |
| W7 | **Schlichtes Marktmodell**: Fill zum nächsten Open, fester Spread je Venue, volumenabhängige Slippage | hinter dem `execution`-Vertrag; ein Ordertiefenmodell braucht Tiefendaten, die wir nicht haben | eine Positionsgröße überschreitet 1 % des Bar-Volumens. Ab dort lügt das schlichte Modell systematisch zu gut (§12/L126) |
| W8 | **Belege**: je Lauf ein Ordner; die letzten **50 Läufe** je Szenario-Familie bleiben, plus jeder ausdrücklich **vermerkte** Lauf unbefristet. Rechenband `voll` wird nach 7 Tagen verworfen, `entscheidungen` nie | „zur Vermerkung" heißt länger als der Lauf — aber nicht jeder Probelauf ist ein Vermerk | die Platte. Dann sinkt die Zahl der behaltenen Läufe, **nie** die der vermerkten |
| W9 | **Parallele Szenarien erlaubt**, aber gezählt | die Suche zu verbieten hilft nichts; sie unsichtbar zu lassen schadet. Der Zähler steht im Bericht (§7.3) | nie — das ist die ehrliche Form. Nur die Höchstzahl gleichzeitiger Läufe wird nachjustiert, und die steht im Flächen-Budget |
| W10 | **Drei MCP-Flächen zum Start**: `wurzel` (lesend, übergreifend), je Strategie eine lesende, eine `steuernd` für den Menschen — letztere **nur stdio** | genug, um Unterschiede zu sehen; wenig genug, um den Überblick zu behalten | eine vierte Rolle entsteht (z. B. ein Dienst, der nur Kennzahlen abholt). Flächen sind Registry-Einträge, das ist dann ein Entwurf, keine Umbauaktion |
| W11 | **Zeitreihen**: komprimiertes NDJSON als Rohstand, daneben ein kompakter Binär-Cache (`Float64Array`/`BigInt64Array`) je (scope, timeframe, Tag) | der Rohstand bleibt lesbar und prüfbar, die Rechnung schnell. Parquet in Node ist ein Abhängigkeitsrisiko ohne erkennbaren Gewinn bei dieser Größe | eine Reihe wird so groß, dass der Binär-Cache nicht mehr in den Speicher passt |
| W12 | **Node 24**, ESM, pnpm; Repo **privat** | die Workflows im Haus stehen schon auf Node 24; die Inhalte sind Strategien und Kontostände | — |
| W13 | ~~blake3~~ → **sha256 aus `node:crypto`**, 8 Stellen in der Anzeige | blake3 braucht eine Abhängigkeit; sha256 liegt bereit, und für die Rolle (Inhaltsadresse, Cache-Schlüssel, Dedupe) sind beide gleich geeignet. Ein Repo, das am ersten Tag wegen eines Hashes nicht läuft, ist teurer als der Unterschied | Messung zeigt, dass Hashing die Rechnung bremst. Der Wechsel betrifft **eine** Datei (`core-ids/hash.ts`); alle gespeicherten nodeHashes werden dabei ungültig — genau dafür gibt es `codeGeneration` |

Was **du** entscheiden musst, ist nur noch der erste Lauf: Markt, Startkapital,
erste Strategie. §16 macht dafür einen Vorschlag — begründet, aber unverbindlich,
bis du ihn bestätigst.

---

## 16. Der erste Lauf — Vorschlag

> **Status: Vorschlag.** Diese drei Werte sind deine Entscheidung (§15). Was hier
> steht, ist begründet und sofort umsetzbar, aber nicht abgenommen.

Ein Leitsatz vorweg, weil er die drei Entscheidungen zusammenhält: **der erste
Lauf soll nicht Geld verdienen, sondern die Maschine beweisen.** Jede Wahl unten
ist danach getroffen, wie gut sie einen Fehler sichtbar macht — nicht danach, wie
gut die Zahl am Ende aussieht.

### 16.1 Markt

| | Vorschlag | Warum |
| --- | --- | --- |
| Venue | **Binance Spot** | öffentliche, kostenlose Historie als Monatsarchive (`data.binance.vision`) — genau die Form, die ein `replay`-Feed will, ohne API-Schlüssel und ohne Rate-Limit |
| Instrument | **BTCUSDT**, dazu **ETHUSDT** als zweiter Scope | tief liquide, damit das schlichte Fill-Modell (W7) trägt; `tickSize`, `stepSize`, `minNotional` und Gebühren sind veröffentlicht und schlicht |
| Timeframes | **`1h` zuerst, `1m` danach** | `1h` für die Richtigkeit: wenige Bars, schnelle Runden, Warmup von Hand nachrechenbar. `1m` danach für die Last — dieselbe Registry, dieselben Knoten, nur mehr davon |
| Scopes | `binance:BTCUSDT:1h:default`, `binance:ETHUSDT:1h:default` | zwei Zeilen in der horizontalen Achse. Der zweite Scope kostet **keinen neuen Code** — und beweist damit genau das, wofür die Achse da ist |

**Bewusst nicht** am Anfang: ein illiquider Altcoin (dann bestimmt das
Slippage-Modell das Ergebnis, nicht die Strategie), FX (Wochenendlücken ohne
zentrale Volumendaten), Aktien (Kalender, Kapitalmaßnahmen, Datenlizenz — drei
Baustellen auf einmal, siehe W1).

### 16.2 Zeitraum — und der Teil, den du nicht anfasst

| Abschnitt | Zeitraum | Wofür |
| --- | --- | --- |
| Warmup | 2018-07 – 2018-12 | liegt **vor** dem Bewertungszeitraum (§12/L132) |
| Entwicklung | 2019-01 – 2022-12 | hier wird gebaut, verglichen, verworfen. Enthält Aufschwung, Absturz 03/2020, Seitwärtsphase |
| Prüfung | 2023-01 – 2024-12 | erst anfassen, wenn eine Strategie in der Entwicklung fertig ist |
| **Unangetastet** | 2025-01 – heute | **einmal**, ganz am Ende. Wer hier zweimal hinschaut, hat keinen Prüfabschnitt mehr, sondern einen dritten Entwicklungsabschnitt |

Der dritte Abschnitt ist die einzige Verteidigung gegen die Kante, die man selbst
nie bemerkt (§12/L130): Bei genug Versuchen sieht irgendeine Variante immer gut
aus. Der Zähler im Bericht sagt, wie viele es waren — der unangetastete Zeitraum
sagt, ob es etwas wert war.

### 16.3 Startkapital

| | Vorschlag |
| --- | --- |
| Konto | **10.000,00 €**, simuliert, ohne Hebel |
| Intern | 1.000.000 Cent als Ganzzahl (§4.7) |

Drei Gründe, und alle drei sind technisch:

1. **Groß genug**, dass `minNotional` (10 USDT bei Binance) nicht jede Entscheidung
   erschlägt — sonst testet man die Mindestgröße statt der Strategie.
2. **Klein genug**, dass eine 1-%-Position (100,00 €) noch **knapp** über der
   Mindestgröße liegt. Genau dort werden Teilfüllung, Rundung auf `stepSize` und
   Ablehnung wirklich ausgelöst (§12/L126) statt nur mitgedacht.
3. **Runde Zahl**, an der die Geld-Invariante mit bloßem Auge prüfbar ist: Summe
   aller Belege plus offene Positionen muss exakt den Kontostand ergeben.

Dazu ein Härtetest, der nichts kostet: **derselbe Lauf mit 1.000,00 € und mit
100.000,00 €**. Unterscheidet sich das Ergebnis nicht nur in der Höhe, sondern im
*Verhalten*, ist die Pfadabhängigkeit aus §12/L124 aktiv — und dann will man das
wissen, bevor eine Kennzahl berichtet wird.

### 16.4 Die ersten vier Strategien

Keine davon ist zum Geldverdienen gedacht. Sie sind eine **Leiter**: jede Sprosse
prüft einen Teil der Maschine, den die vorige nicht erreicht hat.

| # | Strategie | Was sie tut | Was sie beweist |
| --- | --- | --- | --- |
| 1 | `null-v1` | entscheidet nie, handelt nie | Gewinn ist **exakt 0**, Gebühren 0, die Geld-Invariante hält trivial. Findet jeden Verdrahtungsfehler, bevor eine echte Regel ihn verdeckt |
| 2 | `buyhold-v1` | kauft auf der ersten Bar, hält bis zum Ende | Positionsführung, Bewertung, Gebühren und FX über Jahre. **Und zugleich die Messlatte**: eine Strategie, die Kaufen-und-Halten nicht schlägt, hat nichts hervorgebracht |
| 3 | `ema-cross-v1` | EMA(20/50)-Kreuzung, ATR(14)-Stopp, 1 % Risiko je Position | die erste echte Kette `indicator → signal → decision → execution → position → pnl`. Von Hand nachrechenbar — wenn sie falsch liegt, sieht man **warum** |
| 4 | `ema-cross-v2` | wortgleich zu v1, **nur ATR(10) statt ATR(14)** | das erste Vergleichspaar. Genau **ein** Unterschied, also gibt es für die Zuordnung (§7.3, Ebene 4) genau einen Kandidaten — damit prüft man das Vergleichswerkzeug gegen eine bekannte Antwort |

Sprosse 4 ist der Punkt, an dem sich der ganze Aufwand aus §3.5 und §4.8
bezahlt macht: Findet die Zuordnung den ATR-Parameter **nicht**, ist nicht die
Strategie kaputt, sondern der Vergleich. Das merkt man nur, wenn die Antwort
vorher feststeht.

`ema-cross` ist bewusst gewählt, **weil** es als Handelsregel mittelmäßig ist:
gut verstanden, vollständig durchschaubar, in jeder Literatur belegt. Eine erste
Strategie, die überraschend gut abschneidet, ist meist ein Fehler im Prüfstand —
und dann sucht man wochenlang nach dem Falschen.

Das Modell aus M8 tritt später an genau dieselbe Stelle wie Sprosse 3: es ersetzt
die Kreuzungsregel, und `buyhold-v1` bleibt die Latte, über die es muss.

### 16.5 Abnahme des ersten Laufs

Erst wenn alle fünf Punkte stehen, ist der erste Lauf etwas wert:

| # | Bedingung |
| --- | --- |
| 1 | `null-v1` liefert **exakt** 0,00 € — nicht „ungefähr null" |
| 2 | Summe aller Belege + offene Positionen = Kontostand, in Cent, ohne Rest |
| 3 | Zehn Stichproben aus dem Rechenband ergeben beim Nachrechnen denselben Wert |
| 4 | Replay ≡ Live über denselben Ausschnitt |
| 5 | Die Zuordnung zwischen `ema-cross-v1` und `-v2` nennt den ATR-Parameter als Ursache der ersten Divergenz — mit Zeitstempel |
