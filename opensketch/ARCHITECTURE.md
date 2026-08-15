# OpenSketch Studio - Architektur & Team-Handbuch

Browserbasierte 3D-Modellierung im Funktionsumfang von SketchUp: Häuser, Möbel,
Architektur. Reines Frontend, keine Server-Abhängigkeit.

Dieses Dokument ist **verbindlich** für alle Entwickler. Wer eine Änderung an
einem Contract braucht, meldet sie beim Lead - niemand ändert `src/shared/**`
oder `src/core/math/**` eigenmächtig.

---

## 1. Technischer Rahmen

| | |
|---|---|
| Build | Vite 7, TypeScript 5.9 (strict), React 19 |
| 3D | three.js 0.185 (WebGL2), eigener Szenengraph-Sync |
| State | zustand 5 |
| Styling | Tailwind 3 (Dark-First), lucide-react Icons |
| Tests | vitest |
| Pfad-Alias | `@/` → `src/` |

Befehle: `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`.

---

## 2. Koordinatensystem und Einheiten

**Z ist oben.** Rechtshändiges System wie in SketchUp:

- `+X` = rote Achse (nach rechts)
- `+Y` = grüne Achse (nach hinten / Norden)
- `+Z` = blaue Achse (nach oben)

Die **interne Arbeitseinheit ist genau 1 Meter**. Jede Koordinate, Länge,
Fläche und jedes Volumen im Code ist metrisch. Zoll/Fuß/Millimeter existieren
**ausschließlich** in der Anzeige, umgerechnet über `@/shared/units`.

Winkel sind intern immer **Radiant**.

Toleranzen kommen aus `@/core/math/constants`: `POINT_TOL = 1e-5 m` (0,01 mm)
für Punktverschmelzung, `PLANAR_TOL = 2e-5` für Koplanarität. Niemals eigene
Epsilon-Werte erfinden.

---

## 3. Datenmodell

Die zentrale Idee ist von SketchUp übernommen: Geometrie lebt in
**Kontexten**. Ein Kontext ist eine `Definition` (Modellwurzel, Gruppe oder
Komponente) mit einem eigenen Geometrie-Topf aus Vertices, Edges und Faces.

```
SketchDocument
├── definitions: Record<Id, Definition>
│   └── Definition { kind: 'model'|'group'|'component', geometry, children[] }
│       ├── geometry: { vertices, edges, faces }   ← Rohgeometrie dieses Kontexts
│       └── children: Id[]                          ← verschachtelte Entities
├── entities: Record<Id, Entity>                    ← Instanzen, Maße, Texte, ...
├── materials / textures / tags / styles / scenes
└── units, sun, fog
```

Regeln, die überall gelten:

1. **Geometrie verschmilzt automatisch innerhalb eines Kontexts.** Zwei Kanten,
   die sich kreuzen, werden geteilt. Zwei Vertices näher als `POINT_TOL`
   werden zu einem. Schließt sich eine planare Kantenschleife, entsteht
   automatisch eine Fläche. Genau das macht das Zeichnen in SketchUp aus.
2. **Gruppen isolieren Geometrie.** Nichts verschmilzt über Kontextgrenzen.
3. **Eine Gruppe ist eine Definition mit genau einer Instanz.** Komponenten
   teilen sich eine Definition über beliebig viele Instanzen; ändert man eine,
   ändern sich alle.
4. Alle Typen in `@/shared/types.ts` sind **reine Daten** - keine Klassen,
   keine Methoden, strukturell klonbar und JSON-serialisierbar.

---

## 4. Schichten und Eigentümerschaft

Import-Richtung ist **strikt von oben nach unten**. Eine untere Schicht darf
niemals eine obere importieren.

```
              ┌────────────────────────────────┐
   Schicht 5  │  ui/        React-Oberfläche   │  Dev UI
              └───────────────┬────────────────┘
                              │
              ┌───────────────┴────────────────┐
   Schicht 4  │  tools/     Werkzeuge+Inferenz │  Dev Tools
              └───────┬───────────────┬────────┘
                      │               │
      ┌───────────────┴──────┐ ┌──────┴─────────┐
Sch.3 │ render/  Viewport    │ │ io/  Import/Ex │  Dev Render / Dev IO
      └───────────────┬──────┘ └──────┬─────────┘
                      │               │
              ┌───────┴───────────────┴────────┐
   Schicht 2  │  model/   Dokument, Undo, Store│  Dev Model
              └───────────────┬────────────────┘
                              │
              ┌───────────────┴────────────────┐
   Schicht 1  │  core/   Geometriekern + Math  │  Dev Kernel
              └───────────────┬────────────────┘
                              │
              ┌───────────────┴────────────────┐
   Schicht 0  │  shared/  Typen & Contracts    │  LEAD (read-only)
              └────────────────────────────────┘
```

### Dateieigentum

| Verzeichnis | Eigentümer | Darf importieren |
|---|---|---|
| `src/shared/**` | **Lead** (read-only für alle) | - |
| `src/core/math/**` | **Lead** (read-only für alle) | shared |
| `src/core/{topology,ops,query}/**` | Kernel | shared, core/math |
| `src/model/**` | Model | shared, core |
| `src/render/**` | Render | shared, core, model (nur lesend) |
| `src/io/**` | IO | shared, core, model |
| `src/tools/**` | Tools | shared, core, model, render (nur `ViewportApi`) |
| `src/ui/**` | UI | shared, model, tools (nur `ToolManagerApi`), render (nur `ViewportApi`) |
| `src/main.tsx`, `src/app.css` | **Lead** | alles |

**Schreibe niemals in ein fremdes Verzeichnis.** Wenn du dort etwas brauchst,
melde es beim Lead.

---

## 5. Contracts

Alles Schichtübergreifende ist in `src/shared/` typisiert:

| Datei | Inhalt |
|---|---|
| `types.ts` | Geometrie-, Entity-, Style-, Pick-, Inference-, Tool-Datentypen |
| `store-api.ts` | `AppState` (der komplette Store), `ViewportApi`, `InferenceApi`, `Tool`, `ToolManagerApi` |
| `units.ts` | Parsen/Formatieren von Längen, Winkeln, Flächen, Volumen |
| `events.ts` | Typisierter Event-Bus `bus.on(...)` / `bus.emit(...)` |
| `ids.ts` | `newId('e')` - Id-Erzeugung |

`AppState` in `store-api.ts` ist die wichtigste Datei des Projekts. Tools und
UI programmieren **nur** gegen dieses Interface.

### Mathe-Bibliothek

```ts
import { V, M, P, R, B, V2, POINT_TOL } from '@/core/math'

V.add(a, b) V.sub V.cross V.dot V.normalize V.distance V.rotateAround ...
M.multiply(a, b) M.translation M.rotation M.invert M.transformPoint ...
P.fromPolygon(points) P.projectPoint P.intersectSegment P.frame ...
R.intersectTriangle(ray, a, b, c) R.closestPointOnSegment R.intersectBox ...
B.fromPoints(points) B.union B.transform B.corners ...
```

Vektoren sind einfache `{x, y, z}`-Objekte, Matrizen `number[16]` in
Spalten-Major-Reihenfolge (identisch zu `THREE.Matrix4.elements`).

---

## 6. Transaktionen und Undo

Jede Dokumentänderung läuft durch den Store und **muss** in eine Operation
verpackt sein:

```ts
store.getState().operation('Linie zeichnen', () => {
  store.getState().addEdge(a, b)
})
```

Verschachtelte `beginOperation`/`commitOperation` sind referenzgezählt.
`abortOperation()` stellt den Zustand vom äußersten `beginOperation` wieder her.
Werkzeuge dürfen den Store **niemals** direkt mutieren.

---

## 7. Rendering-Protokoll

Der Renderer diffed nicht das gesamte Dokument, sondern lauscht auf
Revisionszähler im Store (`geometryRevision`, `sceneRevision`,
`materialRevision`, `styleRevision`, `selectionRevision`) sowie auf
Bus-Events (`geometry:changed`, `scene:changed`, ...).

Gezeichnet wird **on demand**: `viewport.requestRender()` plant genau ein
Frame ein. Es läuft keine Dauerschleife, außer während Animationen.

Werkzeug-Feedback (Gummiband, Inferenzmarker, Vorschau-Meshes) geht
ausschließlich über die `OverlayApi` im Immediate-Mode - der Renderer leert
das Overlay vor jedem `draw()`.

---

## 8. Funktionsumfang (Zielbild)

**Zeichnen** Linie, Freihand, Rechteck, gedrehtes Rechteck, Kreis, Polygon,
Bogen (2-Punkt, 3-Punkt, Kreissegment, Torte), Bezier.

**Ändern** Verschieben (mit Kopie), Drehen (mit Kopie + Array), Skalieren
(Griffe, uniform/nicht-uniform), Drücken/Ziehen, Folge-mir, Versatz,
Radiergummi (mit Weichzeichnen/Verstecken), Boolesche Volumenoperationen.

**Inferenz** Endpunkt, Mittelpunkt, Zentrum, Schnittpunkt, auf Kante, auf
Fläche, auf Achse, parallel, senkrecht, tangential, von Punkt, Verlängerung,
Achsensperre per Pfeiltasten, Sperre per Shift, Maßeingabefeld (VCB).

**Organisation** Gruppen, Komponenten (mit gemeinsamer Definition),
Verschachtelung, Kontextnavigation per Doppelklick, Outliner, Tags/Ebenen,
Tag-Ordner, Szenen.

**Darstellung** Stile (schattiert, mit Texturen, verdeckte Linien, Drahtgitter,
monochrom, Röntgen), Profile/Verlängerungen/Endpunkte, Sonnenstand mit
Datum/Uhrzeit/Ort, Schatten, Nebel, Schnittebenen, Achsen, Raster, Himmel/Boden.

**Material** Farb- und Texturmaterialien, Vorder-/Rückseite, Material-Browser
mit Bibliothek, Pipette, Texturpositionierung.

**Annotation** Bemaßung (linear, Radius, Durchmesser, Winkel), Bildschirmtext,
3D-Text, Hilfslinien/-punkte, Maßband, Winkelmesser.

**Kamera** Orbit, Schwenken, Zoom, Zoomfenster, Alles einpassen, Standardviews,
Perspektive/Parallelprojektion, Zwei-Punkt-Perspektive, Gehen/Umsehen,
Kamera positionieren.

**Datei** Natives `.osk`-Format (JSON), Autosave in IndexedDB, Import (OBJ, STL,
glTF/GLB, SVG, Bild), Export (OBJ, STL, glTF/GLB, DAE, SVG, PNG),
Komponenten-Bibliothek (Möbel, Bau, Vegetation, Personen).

---

## 9. Konventionen

- TypeScript strict; keine `any` ohne Kommentar; `unknown` + Narrowing bevorzugt.
- Keine Klassen für Daten, Klassen nur für zustandsbehaftete Systeme
  (Werkzeuge, Renderer, Manager).
- Funktionen sind rein, wo es geht; Mutation nur in klar benannten
  `...Mut`-Funktionen oder im Store.
- Alle sichtbaren Texte auf **Deutsch** (die App ist deutschsprachig).
  Code, Bezeichner und Kommentare auf Deutsch oder Englisch - aber konsistent
  innerhalb einer Datei. Keine Umlaute in Bezeichnern.
- Icons ausschließlich aus `lucide-react`.
- Jede nicht triviale Kernel-Funktion braucht einen vitest-Test in
  `src/**/__tests__/`.
- Performance-Ziel: 60 fps bei 100 000 Dreiecken, flüssiges Arbeiten bei
  500 000.

---

## 10. Definition of Done (pro Entwickler)

1. `npm run typecheck` ist grün - **ohne Ausnahme**.
2. `npm test` ist grün.
3. Keine Datei außerhalb des eigenen Verzeichnisses angefasst.
4. Öffentliche API des eigenen Moduls exportiert über eine `index.ts`.
5. Kurzer Statusbericht an den Lead: was fertig ist, was bewusst offen blieb.
