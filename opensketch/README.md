# OpenSketch Studio

Browserbasierte 3D-Modellierung für Architektur, Möbel und Konstruktion —
im Funktionsumfang von SketchUp, als reine Frontend-Anwendung ohne Server.

![Status](https://img.shields.io/badge/Status-in%20Entwicklung-blue)

---

## Was die Anwendung kann

**Zeichnen** — Linie, Freihand, Rechteck, gedrehtes Rechteck, Kreis, Vieleck,
Bogen (2-Punkt, 3-Punkt, Mittelpunkt), Kreissegment, Bezierkurve.

**Ändern** — Verschieben (mit Kopie und Reihen), Drehen, Skalieren,
Drücken/Ziehen, Folge-mir, Versatz, Radiergummi, boolesche Volumenoperationen.

**Inferenz** — das Herzstück: Endpunkt, Mittelpunkt, Zentrum, Schnittpunkt, auf
Kante, auf Fläche, auf Achse, parallel, senkrecht, tangential, Verlängerung und
„von Punkt". Achsensperre über die Pfeiltasten, Einfrieren mit Umschalt.

**Maßeingabe** — nach jedem Klick lässt sich ein exakter Wert tippen:
`2,5` für Längen, `3;2` für Rechteckmaße, `24s` für Segmentzahlen, `x3` für
Kopienreihen, `[2;3;1]` für absolute Koordinaten.

**Organisation** — Gruppen, Komponenten mit gemeinsamer Definition,
Verschachtelung, Kontextnavigation per Doppelklick, Outliner, Tags mit Ordnern,
Szenen.

**Darstellung** — schattiert, mit Texturen, verdeckte Linien, Drahtgitter,
monochrom, Röntgen. Profillinien, Kantenverlängerung, Endpunkte, Skizzen-Jitter.
Sonnenstand nach Datum, Uhrzeit und Ort mit Schatten, Nebel, Schnittebenen.

**Material** — rund 60 Materialien in zehn Kategorien mit prozedural erzeugten
Texturen, Vorder- und Rückseite getrennt, Pipette, Texturmaße.

**Bibliothek** — fertige Komponenten für Möbel, Bau, Sanitär, Außenanlagen und
Grundkörper, alle prozedural erzeugt und maßhaltig.

**Dateien** — natives `.osk`-Format, Autosave in IndexedDB, Import von OBJ, STL,
glTF/GLB, SVG und Bildern, Export nach OBJ, STL, glTF/GLB, COLLADA, SVG und PNG.

---

## Loslegen

```bash
npm install
npm run dev        # http://localhost:5173
```

Die Anwendung braucht kein Backend und keine Konfiguration - sie laeuft
vollstaendig im Browser. Ein WebGL2-faehiger Browser genuegt.

Weitere Befehle:

```bash
npm run build      # Typprüfung + Produktionsbündel
npm run typecheck  # nur Typprüfung
npm test           # vitest
```

---

## Bedienung in fünf Minuten

1. **Zeichnen** — `R` für das Rechteck, in die Fläche klicken, Maus bewegen,
   zweiter Klick. Oder nach dem ersten Klick `3;2` tippen und Enter drücken.
2. **Räumlich machen** — `P` für Drücken/Ziehen, auf die Fläche klicken, nach
   oben ziehen, oder eine Zahl tippen und Enter.
3. **Umsehen** — mittlere Maustaste zieht die Ansicht (Orbit), mit Umschalt
   schwenkt sie, das Mausrad zoomt. Das funktioniert in **jedem** Werkzeug.
4. **Auswählen** — Leertaste. Doppelklick auf eine Fläche nimmt ihre Kanten
   mit, Dreifachklick alles Zusammenhängende.
5. **Gruppieren** — Auswahl treffen, `G` drücken. Doppelklick betritt die
   Gruppe, Escape verlässt sie wieder.

### Wichtige Tasten

| Taste | Werkzeug | Taste | Werkzeug |
|---|---|---|---|
| Leertaste | Auswahl | `M` | Verschieben |
| `L` | Linie | `Q` | Drehen |
| `R` | Rechteck | `S` | Skalieren |
| `C` | Kreis | `F` | Versatz |
| `A` | Bogen | `E` | Radiergummi |
| `P` | Drücken/Ziehen | `B` | Farbeimer |
| `T` | Maßband | `G` | Gruppe erzeugen |
| `O` / `H` / `Z` | Orbit / Schwenken / Zoom | `Strg`+`Z` / `Y` | Rückgängig / Wiederholen |

Pfeiltasten sperren die Zeichenrichtung auf eine Achse: `→` rot, `←` grün,
`↑` blau. Escape bricht die laufende Aktion ab.

---

## Aufbau

Die Anwendung ist in Schichten geschnitten, die strikt von oben nach unten
importieren. Details und die Begründung stehen in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

```
ui/       React-Oberfläche: Menüs, Werkzeugkasten, Panels, Dialoge
tools/    Werkzeuge und Inferenzmaschine
render/   three.js-Viewport: Szenensync, Kanten, Stile, Schatten, Picking
io/       Import, Export, Komponenten- und Materialbibliothek
model/    Dokument, Store, Undo, Serialisierung, Persistenz
core/     Geometriekern: Topologie, Modellieroperationen, Abfragen, Mathematik
shared/   Datentypen und Schnittstellenverträge
```

Zwei Grundsätze prägen alles:

**Geometrie verschmilzt automatisch.** Zwei sich kreuzende Kanten werden
geteilt, zwei nahe Punkte zu einem verschmolzen, und eine geschlossene planare
Kantenschleife wird von selbst zu einer Fläche. Genau das macht das Zeichnen in
SketchUp aus — und genau das ist der schwierigste Teil des Kerns.

**Gruppen isolieren Geometrie.** Jede Gruppe und jede Komponente ist ein
eigener Kontext mit eigenem Geometrie-Topf. Nichts verschmilzt über
Kontextgrenzen hinweg.

Die interne Arbeitseinheit ist **ein Meter**, das Koordinatensystem ist
rechtshändig mit **Z nach oben** — wie in SketchUp. Winkel sind intern immer
Radiant. Einheiten existieren ausschließlich in der Anzeige.

---

## Skript-Zugriff

Die laufende Anwendung stellt `window.OpenSketch` bereit — vergleichbar mit
SketchUps Ruby-Konsole. Damit lässt sich das Modell aus der Browserkonsole
heraus lesen und verändern, für Automatisierung, eigene Erweiterungen und Tests:

```js
// Immer frisch lesen - ein festgehaltener Zustand veraltet nach jeder Änderung
const os = () => OpenSketch.store.getState()

// Grundriss zeichnen: geschlossener Kantenzug erzeugt automatisch eine Fläche
os().operation('Grundriss', () => {
  os().addPolyline([{x:0,y:0,z:0},{x:5,y:0,z:0},{x:5,y:4,z:0},{x:0,y:4,z:0}], true)
})

// Erste Fläche zwei Meter hochziehen
const flaeche = Object.keys(os().getActiveGeometry().faces)[0]
os().operation('Wände', () => os().pushPull(flaeche, 2))

// Nachmessen
OpenSketch.core.solidVolume(os().getActiveGeometry())   // 40
os().history.undoStack.map(e => e.name)                 // ['Grundriss', 'Wände']
OpenSketch.viewport().zoomExtents(true)
```

Verfügbar sind `store`, `bus`, `core`, `units`, `viewport()` und `tools()`.

Zwei Fallstricke: Jede Änderung gehört in eine `operation(name, fn)`, sonst
fehlt sie im Rückgängig-Verlauf. Und `store.getState()` liefert eine
**Momentaufnahme** — wer sie in einer Variablen festhält und später daraus
liest, bekommt veraltete Werte. Aktionen daraus aufzurufen funktioniert,
Zustand daraus zu lesen nicht.

---

## Wie dieses Projekt gebaut wurde

Entwickelt von einem Team aus eigenständigen Claude-Code-Sessions: ein Lead
(Senior) und sechs Entwickler-Sessions für Kern, Modell, Renderer, Werkzeuge,
Oberfläche und Import/Export, die über Cross-Session-Messaging miteinander
kommunizieren.

Die Arbeitsregeln des Teams stehen in **[CLAUDE.md](CLAUDE.md)**. Die wichtigste
lautet: Kommunikation zwischen Lead und Entwicklern ist wichtiger als der Code.
Eine Information, die 20 Minuten in einem Entwicklerkopf liegen bleibt, ist eine
verlorene Information.

---

## Mitarbeiten

Vor der ersten Zeile Code: `ARCHITECTURE.md` lesen, besonders Abschnitt 4
(Dateieigentum) und Abschnitt 9 (Konventionen).

- `src/shared/**` und `src/core/math/**` sind Verträge und werden nicht
  eigenmächtig geändert.
- Jede Dokumentänderung läuft über `store.getState().operation(name, fn)`,
  sonst funktioniert Rückgängig nicht.
- Punkte, die Werkzeuge an den Store geben, sind **Weltkoordinaten**; der Store
  rechnet in den aktiven Kontext um.
- Neue Kernfunktionen brauchen einen vitest-Test.
