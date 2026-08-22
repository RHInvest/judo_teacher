# OpenSketch Studio — Arbeitsweise des Teams

## Grundregel: Kommunikation ist das Wichtigste

Dieses Projekt wird von einem Lead (Senior Developer) und mehreren eigenständigen
Entwickler-Sessions (Junior Developer) gebaut, die über Cross-Session-Messaging
(`ListAgents` / `SendMessage`) miteinander reden.

**Die Kommunikation zwischen Lead und Entwicklern ist der Kern des Ganzen — nicht
der Code.** Wie in einer echten Firma: Der Senior lebt davon, dass seine Junioren
ihm system- und programmierrelevante Informationen zutragen. Nur dann kann er
schnell reagieren, Entscheidungen treffen und andere Entwickler sofort nachziehen
lassen, damit das System sich anpasst. Eine Information, die 20 Minuten in einem
Entwicklerkopf liegen bleibt, ist eine verlorene Information.

Deshalb gilt: **lieber einmal zu viel melden als einmal zu wenig.**

## Protokoll für Entwickler-Sessions

**Sofort melden — nicht bis zum Abschlussbericht warten:**

1. **Contract-Problem** — ein Typ, ein Feld oder eine Funktion fehlt in
   `src/shared/**` oder `src/core/math/**`, oder ein Contract ist widersprüchlich.
   Diese Dateien gehören dem Lead; niemand ändert sie selbst.
2. **Fremdmodul betroffen** — du brauchst etwas von einem anderen Modul, oder ein
   anderes Modul liefert etwas Falsches. Melde es, statt zu umgehen oder zu warten.
3. **Annahme getroffen** — etwas ist unterspezifiziert und du entscheidest dich für
   eine Auslegung. Melden, damit der Lead sie bestätigen oder korrigieren kann,
   bevor andere darauf aufbauen.
4. **Entblockung** — du hast etwas fertig, auf das jemand anderes wartet. Sofort
   melden, damit der Lead die Kollegen nachziehen kann.
5. **Zeitrisiko** — dein Teil dauert deutlich länger als gedacht.

**Takt:** mindestens alle 15–20 Minuten Arbeit ein Zweizeiler zum Stand.

**Form:** kurz, faktisch, mit Datei und Zeile. Keine Romane, keine Höflichkeitsfloskeln.

**Untereinander reden ist erwünscht.** Wenn zwei Module an einer Schnittstelle
klemmen, klärt das direkt und haltet den Lead in Kopie.

**Nie blockieren.** Wartest du auf eine Antwort, arbeite am nächsten Punkt weiter.

## Protokoll für den Lead

- Antworte schnell und entscheide, statt zu vertagen.
- Was ein Entwickler meldet und andere betrifft, sofort an die Betroffenen
  weitergeben — das ist die eigentliche Aufgabe.
- Contract-Änderungen macht ausschließlich der Lead und kündigt sie allen an, die
  betroffen sind.
- Prioritäten aktiv setzen, damit der kritische Pfad nie stillsteht.

## Projektstandards, die aus Befunden entstanden sind

Diese Regeln stehen hier, weil ihre Verletzung uns bereits Zeit gekostet hat.
Sie gelten für alle Module.

**Kein stilles Scheitern.** Bricht eine Operation ab, weil die Eingabe entartet
ist, muss der Nutzer es erfahren — Statuszeile **und** Toast. Ein `reset(); return`
ohne Rückmeldung ist ein Fehler, kein Schutz. Gefunden am Rechteckwerkzeug: Die
Inferenz rastete den zweiten Eckpunkt auf eine Achse durch den ersten, die Breite
wurde 0, das Werkzeug setzte wortlos zurück. Für den Nutzer sah es aus, als sei
die Anwendung kaputt. In der Werkzeugschicht heisst der Weg dorthin
`BaseTool.abortDegenerate(grund)`.

**Echte Geometrie schlägt gedachte Hilfslinien.** Eine Inferenz auf etwas
Sichtbarem (Kante, Endpunkt, Hilfslinie) muss gegen eine unsichtbare
Achsengerade gewinnen, wenn sie näher am Cursor liegt. Ausnahme sind `onFace`
und `onPlane`, sonst wäre Achsenzeichnen auf einer Fläche unmöglich. Die
Reihenfolge in `inference/engine.ts:compute` ist deshalb bewusst gewählt und
kommentiert — nicht „aufräumen".

**Zähler und Anzeigen brauchen einen nachlaufenden Push.** Gerendert wird nur
bei Bedarf. Wer eine Aktualisierung drosselt und den letzten Aufruf verwirft,
friert die Anzeige dauerhaft ein, weil kein weiterer Frame kommt. Gefunden an
der Modellstatistik in der Statuszeile.

**Was der Nutzer sieht, muss heissen, was es heisst.** Dieselbe Statistik zeigte
die Dreieckszahl der Triangulierung unter der Beschriftung „Flächen".

**Voreinstellungen sind Teil der Bedienbarkeit.** Millimeter als Grundeinheit
liess „2" im Massfeld zu einer unsichtbaren 2-mm-Extrusion werden. Eine
Voreinstellung, die den ersten Versuch scheitern lässt, ist falsch gewählt.

**Der Kern erfindet keine Werte.** Kann eine Operation oder ein Generator die
Anfrage nicht sinnvoll beantworten, liefert er ein leeres Ergebnis — niemals
eine plausibel aussehende Ersatzantwort. `buildCircle` mit Radius 0 gab
24 identische Punkte zurück, `buildPolygon` mit 2 Seiten ein Dreieck: Antworten,
die wie Erfolg aussehen und keiner Schicht darüber erlauben, dem Nutzer zu
sagen, dass nichts entstanden ist. Das ist die Fortsetzung von „Kein stilles
Scheitern" nach unten.

**NaN kommt durch jede Toleranzprüfung.** Jeder Vergleich mit NaN ist falsch,
also besteht NaN jede Prüfung der Form „ist der Betrag kleiner als die
Toleranz?". Ein einziger NaN-Vertex macht die Hüllbox NaN, damit den
räumlichen Index, damit jeden Strahltest, und Volumen wird NaN — für den
Nutzer sieht das aus, als sei die Anwendung kaputt. Entartungsprüfungen
fragen deshalb **zuerst** auf Endlichkeit, dann auf Kleinheit.

**Zwei Wege zur selben Antwort müssen dieselbe Antwort geben.** Gefunden am
Picking: Kernel und Renderer benutzten denselben Dreieckstest, aber der Kernel
weitete die Kandidatensuche für Kanten um eine Toleranz auf und für Flächen um
null. Wo zwei Pfade existieren, gehört ein Test dazu, der sie gegeneinander
prüft — jeder für sich war grün.

## Dateieigentum

Siehe `ARCHITECTURE.md`, Abschnitt 4. Kurz: `src/shared/**`, `src/core/math/**`,
`src/app/**`, `src/main.tsx`, `src/app.css` und alle Konfigurationsdateien gehören
dem Lead. Jedes Modulverzeichnis gehört genau einem Entwickler. Niemand schreibt
in fremde Verzeichnisse, niemand nutzt git — der Lead committet.
