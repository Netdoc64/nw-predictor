<!--
Die Überschriften gern löschen, wo sie nicht passen. Eine kurze, ehrliche
Beschreibung ist mehr wert als ein vollständig ausgefülltes Formular.
-->

## Worum geht es

<!-- Was ändert sich, und warum jetzt? Falls es eine Kante aus PLAN.md §12 gibt: nennen (z. B. §12/L121). -->

## Wie geprüft

<!--
Am wertvollsten: ein Test, der VOR der Änderung rot war. Wenn es keinen gibt,
sag warum — das ist eine Aussage, keine Lücke im Formular.
-->

- [ ] `pnpm test`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`

## Abgleich

<!--
Was hast du geprüft und ausgeschlossen? Gibt es einen zweiten Weg durch denselben
Code, der jetzt anders läuft? Ändern sich Hashes, Belege oder Kennzahlen?
-->

## Grenzen

- [ ] Keine Orderausführung, keine Anlageberatung (PLAN.md §13)
- [ ] Keine Geheimnisse, keine Marktdaten im Diff
- [ ] Preise, Mengen und Geld bleiben Festkomma — kein `number`
