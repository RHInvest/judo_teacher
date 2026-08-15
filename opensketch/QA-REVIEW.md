# QA-Review Runde 1 - Contracts, Mathematik-Kern, Einheiten

**Prüfer:** QA-Entwickler
**Umfang:** `ARCHITECTURE.md`, `src/shared/{types,store-api,units,events,ids}.ts`,
`src/core/math/**`, `src/core/index.ts`, `src/app/**`
**Stand:** Commit `48a94bd`, Branch `claude/sketchup-3d-web-app-7bkvz5`
**Nicht geprüft:** `src/model`, `src/render`, `src/tools`, `src/ui`, `src/io` (im Bau)

## Kurzfassung

| Schweregrad | Anzahl |
|---|---|
| Blocker | 7 |
| Wichtig | 19 |
| Kosmetisch | 13 |
| **Summe** | **39** |

Der Mathematik-Kern ist überraschend solide: Matrixreihenfolge (Spalten-Major),
Rechtshändigkeit von `M.rotation`/`V.rotateAround`/`V.cross`, `M.invert` (identisch
zur three.js-Referenz), Möller-Trumbore, Newell-Normale bei konkaven Polygonen und
der Ebenenschnitt sind allesamt korrekt und durch Tests belegt. Die drei echten
Rechenfehler stecken in Randfällen (paralleler Strahl, Rundungsübertrag,
Vorzeichen bei `-0`).

Das eigentliche Risiko liegt **nicht** in der Mathematik, sondern in drei Lücken
der Contracts, an denen sich sechs parallel arbeitende Entwickler garantiert in
die Quere kommen: der unspezifizierte Übergang Welt-/Kontextkoordinaten (B-1), die
nirgends typisierten Modul-Fabriken (B-5, B-6) und die fehlenden Store-Aktionen für
Tag und Sichtbarkeit von Kanten/Flächen (B-4).

**Teststatus:** 240 Tests, alle grün. 4 davon sind bewusst als `it.fails`
markiert - sie beschreiben das SOLL-Verhalten der Befunde B-2, B-3 und W-1 und
werden grün, sobald der jeweilige Bug behoben ist. Zu jedem `it.fails` gibt es
einen normalen Test, der den aktuellen IST-Zustand festnagelt, damit die Behebung
nicht unbemerkt bleibt.

---

# Blocker

Ohne Klärung dieser Punkte entstehen entweder falsche Ergebnisse oder mehrere
Entwickler bauen unvereinbare Annahmen ein.

## B-1 - Der Übergang Weltkoordinaten ↔ Kontextkoordinaten ist nirgends festgelegt

**Dateien:** `ARCHITECTURE.md` (fehlt komplett), `src/shared/store-api.ts:250-262, 435-447, 472-488`,
`src/shared/types.ts:499-508, 583-603, 645-668`

Das Datenmodell lebt in Kontexten (`Definition.geometry`), die Interaktion aber in
Weltkoordinaten. Der Contract sagt an keiner Stelle, wer umrechnet:

| Stelle | Raum | Quelle |
|---|---|---|
| `ViewportApi.screenToRay` (`store-api.ts:435`) | Welt | implizit |
| `PickHit.point` / `.normal` (`types.ts:585,590`) | Welt | dokumentiert |
| `PickHit.worldTransform` (`types.ts:598`) | Definition → Welt | dokumentiert |
| `AppState.addEdge(a, b)` (`store-api.ts:250`) | „ACTIVE context" | dokumentiert |
| `InferenceResult.point` (`types.ts:646`) | **unspezifiziert** | - |
| `InferenceApi.infer({ from, plane, references })` (`store-api.ts:472-487`) | **unspezifiziert** | - |
| `OverlayApi.line/polyline/circle/...` (`types.ts:768-776`) | **unspezifiziert** (nur `ghost` sagt „world space") | - |
| `SectionPlaneEntity.plane`, `GuideLineEntity.origin` (`types.ts:238,253`) | **unspezifiziert** | - |
| `DimensionEntity.start/end` (`types.ts:206-208`) | Definition | dokumentiert |
| `AppState.transformPrimitives(sel, matrix, …)` (`store-api.ts:260`) | **unspezifiziert** | - |

Konkretes Kollisionsszenario: Dev Tools baut das Linienwerkzeug so, dass es den
Weltpunkt aus `PickHit` direkt an `addEdge` weiterreicht. Dev Model implementiert
`addEdge` erwartungsgemäß in Kontextkoordinaten. Solange niemand in eine Gruppe
hineinnavigiert, funktioniert beides; sobald jemand eine verschobene Gruppe
editiert, landet die Linie am falschen Ort - und der Fehler ist für beide
Entwickler „im jeweils anderen Modul".

**Vorschlag:** einen Abschnitt „2b. Räume" in `ARCHITECTURE.md` aufnehmen mit der
Regel *„Alles, was durch `ViewportApi`, `InferenceApi` oder `OverlayApi` geht, ist
Weltraum. Alles, was in `Geometry`, `Definition` oder einer `Entity` gespeichert
wird, ist Kontextraum. Die Umrechnung ist Aufgabe des Werkzeugs und läuft über
`M.transformPoint(M.invert(ctx.worldTransform), p)`."* Zusätzlich zwei Bequem-
lichkeitsfelder in `EditContext` (`types.ts:499`) ergänzen, damit nicht jedes
Werkzeug selbst invertiert und dabei potenziell einen anderen Weg wählt:

```ts
export interface EditContext {
  // ...
  worldTransform: Mat4Like
  /** Welt -> Kontext, immer M.invert(worldTransform) */
  inverseWorldTransform: Mat4Like
}
```

und die betroffenen Kommentare in `types.ts` / `store-api.ts` explizit machen
(`/** WELTRAUM */` bzw. `/** KONTEXTRAUM */` an jedem Vec3-Feld).

## B-2 - `R.rayToSegment` misst bei achsparallelen Kanten den Abstand zum Strahl*ursprung*

**Datei:** `src/core/math/ray.ts:102-119` (Folgefehler in `intersectCapsule`, `ray.ts:194-198`)
**Test:** `src/core/math/__tests__/ray.test.ts` - `B-2 (IST-Zustand)` / zwei `it.fails`

`closestPointsBetweenLines` liefert für parallele Geraden `null` (`ray.ts:62`).
Der Fallback in Zeile 109-112 misst dann aber vom **Strahlursprung** aus:

```ts
const c = closestPointOnSegment(a, b, r.origin)
return { distance: V.distance(c.point, r.origin), ... }
```

Richtig wäre der Lotabstand von der Strahl*geraden*. Belegt:

| Eingabe | erwartet | IST |
|---|---|---|
| Strahl `(0,0,0)`→`+X`, Kante `(5,0,1)`–`(9,0,1)` | `1` | `5.0990…` |

**Auswirkung:** Kantenpicking versagt genau dann, wenn man eine Kante *entlang*
anvisiert - also bei jeder Wand, jedem Balken und jeder Sockelleiste, die man in
der Fluchtrichtung betrachtet. Dasselbe gilt für `intersectCapsule`, das die Kante
nicht mehr trifft, obwohl sie innerhalb des Radius liegt. Das trifft Dev Kernel
(`raycast`, `core/index.ts:317`), Dev Render (`ViewportApi.pick`) und Dev Tools
(Inferenz „auf Kante") gleichzeitig.

**Vorschlag:** im Fallback den Abstand Punkt↔Gerade verwenden:

```ts
if (!res) {
  // parallel: beliebiger Segmentpunkt genügt, der Abstand ist überall gleich
  const rt = Math.max(0, V.dot(V.sub(a, r.origin), r.dir))
  const c = closestPointOnSegment(a, b, at(r, rt))
  const t2 = Math.max(0, V.dot(V.sub(c.point, r.origin), r.dir))
  return { distance: V.distance(at(r, t2), c.point), pointOnSegment: c.point, t: c.t, rayT: t2 }
}
```

## B-3 - `formatArchitectural`: der Rundungsübertrag erreicht die Fuß-Stelle nicht

**Datei:** `src/shared/units.ts:239-252`, Ursache in `toFraction` `units.ts:228-231`
**Test:** `src/shared/__tests__/units.test.ts` - `B-3 (IST-Zustand)` / `it.fails`

`toFraction` fängt den Übertrag `num >= den` korrekt ab und erhöht `whole` - aber
`formatArchitectural` hat `feet` zu diesem Zeitpunkt bereits berechnet (Zeile 243)
und prüft danach nie, ob `whole` auf 12 gesprungen ist.

| metrisch | erwartet | IST |
|---|---|---|
| `11.99 in` (0,304546 m) | `1'` | `12"` |
| `23.99 in` (0,609346 m) | `2'` | `1' 12"` |

**Auswirkung:** In einem imperialen Dokument (`IMPERIAL_UNITS`, `units.ts:82`) zeigt
jede Bemaßung, jedes Entity-Info-Feld und das Maßeingabefeld für ein knapp
1/64 Zoll zu kurzes Maß `12"` statt `1'` an. Weil `parseLength("12\"")` das korrekt
zurückliest, fällt es beim Rundlauf nicht auf - nur der Nutzer sieht Unsinn.

**Vorschlag:** den Übertrag nach `toFraction` behandeln:

```ts
const feet0 = Math.floor(abs / 12)
let { whole, num, den } = toFraction(abs - feet0 * 12, units.fractionDenominator)
let feet = feet0
if (whole >= 12) { feet += Math.floor(whole / 12); whole %= 12 }
```

## B-4 - Keine Store-Aktion, um Tag oder Sichtbarkeit von Kanten und Flächen zu setzen

**Dateien:** `src/shared/store-api.ts:272-279, 296-303`, `src/shared/types.ts:76-81, 102-103`

`Edge.tagId`, `Edge.hidden`, `Face.tagId` und `Face.hidden` existieren im Datenmodell,
aber `AppState` bietet keinen Weg, sie zu ändern:

- `setEntityTag(ids, tagId)` (`store-api.ts:299`) nimmt nur **Entity**-Ids.
- `setEntityHidden(ids, hidden)` (`store-api.ts:300`) ebenso.
- `setEdgeFlags(edgeIds, flags)` (`store-api.ts:277`) deckt `hidden` für Kanten ab -
  aber es gibt kein Gegenstück für Flächen und keines für `tagId`.

**Auswirkung:** Drei Features aus dem Zielbild (`ARCHITECTURE.md:208-210`) sind so
nicht baubar: „Tags/Ebenen" (Geometrie einem Tag zuweisen), der Radiergummi mit
„Verstecken" für Flächen, und `StyleSettings.showHiddenGeometry`
(`types.ts:395`) hat nichts zum Anzeigen. Dev UI (Tags-Panel), Dev Tools
(Radiergummi) und Dev Model werden sich hier jeweils eigene Wege bauen - oder in
`src/shared` schreiben, was laut `ARCHITECTURE.md:7-8` verboten ist.

**Vorschlag:** zwei Aktionen ergänzen, die Selection-förmig arbeiten wie
`applyMaterial`:

```ts
/** setzt den Tag von Kanten, Flaechen UND Entities der Auswahl */
setTag(target: Partial<Selection>, tagId: Id | null): void
/** versteckt/zeigt Kanten, Flaechen und Entities der Auswahl */
setHidden(target: Partial<Selection>, hidden: boolean): void
```

und `setEntityTag` / `setEntityHidden` als Spezialfälle darauf zurückführen oder
streichen.

## B-5 - Die Fabrikfunktionen der Module sind nirgends typisiert

**Dateien:** `src/app/ViewportHost.tsx:13-14, 53, 58-59`

```ts
import { createViewport } from '@/render'
import { createInferenceEngine, createToolManager } from '@/tools'
// ...
vp = createViewport(canvas, { store })
const inf = createInferenceEngine({ store, viewport: vp })
const tm = createToolManager({ store, viewport: vp, inference: inf })
```

`store-api.ts` typisiert `ViewportApi`, `InferenceApi` und `ToolManagerApi` -
aber nicht, **wie man sie erzeugt**. Dev Render und Dev Tools müssen die Signaturen
aus dem Aufrufcode in einer Datei ableiten, die ihnen laut Eigentümertabelle nicht
gehört. Ein Positionsargument (`canvas`) plus Options-Objekt ist nicht selbst-
erklärend: Warum bekommt `createViewport` den Canvas positional, aber
`createToolManager` alles im Objekt? Braucht der Viewport `bus` oder holt er ihn
sich selbst?

**Vorschlag:** in `store-api.ts` aufnehmen:

```ts
export interface ViewportDeps { store: StoreHandle }
export type CreateViewport = (canvas: HTMLCanvasElement, deps: ViewportDeps) => ViewportApi

export interface InferenceDeps { store: StoreHandle; viewport: ViewportApi }
export type CreateInferenceEngine = (deps: InferenceDeps) => InferenceApi

export interface ToolManagerDeps { store: StoreHandle; viewport: ViewportApi; inference: InferenceApi }
export type CreateToolManager = (deps: ToolManagerDeps) => ToolManagerApi
```

Dann kann jedes Modul seinen Export mit `satisfies CreateViewport` absichern und
der Compiler fängt Abweichungen sofort.

## B-6 - `ImportResult` und die Autosave-API sind nicht typisiert, Autosave hat zwei Eigentümer

**Dateien:** `src/app/bootstrap.ts:16, 85-95`

```ts
import { loadAutosave, saveAutosave } from '@/model'
// ...
const io = await import('@/io')
const result = await io.importFile(file)
for (const def of result.definitions) state.upsertDefinition(def)
for (const material of result.materials) state.addMaterial(material)
for (const texture of result.textures) state.addTexture(texture)
state.placeInstance(result.rootDefinitionId, identity)
for (const warning of result.warnings) state.toast(warning, 'warn')
```

Zwei Probleme:

1. **`ImportResult` steht in keinem Contract.** Dev IO muss aus dem Verbrauchercode
   raten, dass ein Objekt mit `definitions`, `materials`, `textures`,
   `rootDefinitionId` und `warnings` erwartet wird - inklusive der Frage, ob
   `materials` `Material[]` oder `Omit<Material,'id'>[]` ist (`addMaterial` nimmt
   beides, `store-api.ts:338`). Wenn Dev IO stattdessen `{ document, warnings }`
   liefert, bricht `bootstrap.ts` erst zur Laufzeit.
2. **Autosave gehört laut `ARCHITECTURE.md:226` zum Bereich „Datei" (= IO), wird hier
   aber aus `@/model` importiert.** Dev IO und Dev Model werden beide anfangen,
   IndexedDB anzubinden, oder keiner von beiden.

**Vorschlag:** eine Datei `src/shared/io-api.ts` (Eigentum Lead) mit

```ts
export interface ImportResult {
  rootDefinitionId: Id
  definitions: Definition[]
  materials: Material[]
  textures: Texture[]
  warnings: string[]
}
export interface IoApi {
  importFile(file: File): Promise<ImportResult>
  exportDocument(doc: SketchDocument, format: ExportFormat, opts?: ExportOptions): Promise<Blob>
  loadAutosave(): Promise<SketchDocument | null>
  saveAutosave(doc: SketchDocument): Promise<void>
}
```

und in `ARCHITECTURE.md` Abschnitt 4 festhalten, dass Autosave zu `io/` gehört.

## B-7 - `as unknown as never` schaltet die Typprüfung an einer Contract-Aufrufstelle ab

**Datei:** `src/app/bootstrap.ts:91, 113`

```ts
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as unknown as never
state.placeInstance(result.rootDefinitionId, identity)
```

`never` ist auf **jeden** Parametertyp zuweisbar. Der Aufruf
`placeInstance(id, identity)` würde also auch dann noch kompilieren, wenn die
Signatur von `placeInstance` sich in etwas völlig anderes ändert. Das ist
ausgerechnet an der Stelle eingebaut, an der der Lead ein Verhalten vorgibt, das
alle anderen kopieren werden - und es widerspricht `ARCHITECTURE.md:233`
(„keine `any` ohne Kommentar; `unknown` + Narrowing bevorzugt").

**Vorschlag:** `M.identity()` aus `@/core/math` verwenden - liefert bereits `Mat4`:

```ts
import { M } from '@/core/math'
state.placeInstance(result.rootDefinitionId, M.identity())
```

Damit entfällt der Cast an beiden Stellen ersatzlos. Siehe auch W-2.

---

# Wichtig

## W-1 - `formatLength` verliert das Vorzeichen bei reinen Brüchen

**Datei:** `src/shared/units.ts:263-266`, Ursache `units.ts:236`
**Test:** `src/shared/__tests__/units.test.ts` - `W-1 (IST-Zustand)` / `it.fails`

`toFraction` gibt `whole = whole * sign` zurück. Für Werte zwischen -1 und 0 ist
`whole === 0`, also wird `whole` zu `-0`. Der Test in Zeile 265
(`whole !== 0 ? … : \`${num}/${den}\``) greift nicht, weil in JavaScript
`-0 === 0` gilt:

| Eingabe (format `fractional`) | erwartet | IST |
|---|---|---|
| `-0.5"` | `-1/2"` | `1/2"` |
| `-0.25"` | `-1/4"` | `1/4"` |

Ein Versatz von -1/2 Zoll sieht damit aus wie +1/2 Zoll. `formatArchitectural`
ist nicht betroffen, weil es das Vorzeichen separat als String führt
(`units.ts:241`).

**Vorschlag:** `toFraction` ein eigenes `negative: boolean` zurückgeben lassen
oder in `formatLength` gegen `Object.is(whole, -0)` prüfen.

## W-2 - `Mat4Like` ist aus berechneten Arrays nicht konstruierbar

**Datei:** `src/shared/types.ts:32-33`

```ts
export type Mat4Like = readonly number[] & { length: 16 }
```

Geprüft mit `tsc`: ein **Inline-Literal** mit exakt 16 Elementen ist zuweisbar
(TypeScript leitet dort ein Tupel mit `length: 16` ab), ein Wert vom Typ
`number[]` dagegen **nicht**:

```
error TS2322: Type 'number[]' is not assignable to type 'Mat4Like'.
  Types of property 'length' are incompatible. Type 'number' is not assignable to type '16'.
```

Betroffen ist damit alles, was nicht wörtlich hingeschrieben wird:
`JSON.parse` beim Laden einer `.osk`-Datei, `THREE.Matrix4.elements` (Typ
`number[]`), jedes `.map()` und jedes `Array.from()`. `mat4.ts` löst das intern
mit der Hilfsfunktion `m4()` (`mat4.ts:20-22`), die genau diesen Cast versteckt -
alle anderen Module haben diese Hilfe nicht. Dev IO wird beim Deserialisieren als
Erstes über diesen Typ stolpern.

**Vorschlag:** entweder ein echtes Tupel definieren (dann prüft der Compiler die
Länge wirklich und die Fehlermeldung ist verständlich):

```ts
export type Mat4Like = readonly [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number,
]
```

oder auf `readonly number[]` reduzieren und die Länge zur Laufzeit prüfen. In
jedem Fall gehört eine geprüfte Konstruktionsfunktion `M.fromArray` (existiert,
`mat4.ts:255`) in `ARCHITECTURE.md` Abschnitt 5 als *der* vorgeschriebene Weg.

## W-3 - Eine `Entity` kennt ihren Besitzerkontext nicht

**Datei:** `src/shared/types.ts:183-190`, `src/shared/store-api.ts:294-301`

Entities liegen flach in `doc.entities` (`types.ts:551`) und werden nur über
`Definition.children` (`types.ts:151`) einem Kontext zugeordnet. `EntityBase` hat
kein Feld, das zurückzeigt. Um zu einer Entity die besitzende Definition zu
finden, muss man **alle** Definitionen durchsuchen.

`updateEntity(id, patch)`, `removeEntities(ids)`, `setEntityTag(ids, …)` und
`transformEntities(ids, …)` bekommen alle nur Ids. Jedes dieser Verfahren braucht
den Besitzer (für `sceneRevision`, für das `geometry:changed`-Event mit
`definitionId`, für die Weltmatrix). Vier Module werden vier eigene
Rückwärtssuchen bauen, drei davon O(n) pro Aufruf.

**Vorschlag:** `EntityBase` um `ownerDefinitionId: Id` erweitern (redundant zu
`children`, aber genau dafür da) und die Invariante in `ARCHITECTURE.md`
Abschnitt 3 als Regel 5 aufnehmen: *„`entity.ownerDefinitionId` und
`definition.children` werden immer gemeinsam gepflegt; der Store garantiert das."*
Alternativ eine Leseoperation `getEntityOwner(id): Id | undefined` in `AppState`.

## W-4 - `P.bestFit` und `P.arePointsCoplanar` sind Newell-basiert und damit reihenfolgeabhängig

**Datei:** `src/core/math/plane.ts:189-206`
**Test:** `src/core/math/__tests__/plane.test.ts` - `BEFUND W-4`

Beide Funktionen sind für **Punktwolken** dokumentiert („best fit plane through a
point cloud", „true when every point lies within `tol` of the plane"), rufen aber
`fromPolygon` auf - und Newell berechnet den *Flächenvektor einer Schleife*, nicht
eine Ausgleichsebene. Für vier perfekt koplanare Punkte in „Schmetterlings"-
Reihenfolge hebt sich die Summe auf:

```ts
const bowtie = [v3(0,0,0), v3(1,1,0), v3(1,0,0), v3(0,1,0)]  // alle in z = 0
P.polygonNormal(bowtie)          // null
P.bestFit(bowtie).n              // (0.707, -0.707, 0) - nicht die XY-Ebene
P.arePointsCoplanar(bowtie)      // true, aber ungeprüft (Zeile 204: if (!plane) return true)
```

Für geordnete Flächenschleifen (der Hauptanwendungsfall) ist das korrekt und die
Tests belegen es auch für stark konkave Polygone. Gefährlich wird es dort, wo Dev
Kernel oder Dev IO eine ungeordnete Punktmenge hineingibt - `arePointsCoplanar`
liefert dann ein stilles falsches Positiv.

**Vorschlag:** die Dokumentation ehrlich machen (`fromPolygon`/`polygonNormal`
erwarten eine **geordnete Schleife**) und `bestFit` auf eine echte Ausgleichsebene
umstellen (Kovarianzmatrix + kleinster Eigenvektor, oder als Minimalfassung: den
Newell-Weg versuchen und bei Degeneriertheit die Ebene aus den drei am weitesten
auseinanderliegenden Punkten bilden). In `arePointsCoplanar` sollte
`if (!plane) return true` durch eine explizite Behandlung ersetzt werden.

## W-5 - `ViewportApi` hat keine Methode, um die Canvas-Größe zu übernehmen

**Dateien:** `src/shared/store-api.ts:415-460`, `src/app/ViewportHost.tsx:65-66`

```ts
const resize = new ResizeObserver(() => vp.requestRender())
```

Der Host beobachtet die Containergröße, teilt dem Viewport aber nur mit, dass neu
gezeichnet werden soll - nicht, **wie groß**. `ViewportApi` hat `getSize()`
(`store-api.ts:440`), aber kein `setSize`. Die `width`/`height`-Attribute des
Canvas werden nirgends gesetzt, das Element ist nur per CSS auf `h-full w-full`
gestellt (`ViewportHost.tsx:222`). Ohne Absprache bleibt der Zeichenpuffer bei den
Vorgabewerten 300×150 und das Bild ist verzerrt.

**Vorschlag:** `ViewportApi` erweitern und den Host anpassen:

```ts
/** Canvas-Groesse in CSS-Pixeln; der Renderer skaliert selbst mit devicePixelRatio */
setSize(width: number, height: number): void
```

## W-6 - `V.key` löst die POINT_TOL-Verschmelzung nicht

**Datei:** `src/core/math/vec3.ts:242-246`
**Test:** `src/core/math/__tests__/vec3.test.ts` - `BEFUND W-6`

```ts
/** hash key for spatial deduplication at POINT_TOL resolution */
export function key(a: Vec3Like, tol = POINT_TOL): string {
  const q = 1 / tol
  return `${Math.round(a.x * q)},${Math.round(a.y * q)},${Math.round(a.z * q)}`
}
```

Naives Zellen-Runden kann Punkte, die deutlich näher als `tol` beieinanderliegen,
in verschiedene Zellen legen - immer dann, wenn sie eine Zellgrenze umschließen:

```ts
V.equals(v3(0.499999e-5,0,0), v3(0.500001e-5,0,0))  // true  (2e-11 m Abstand)
V.key  (v3(0.499999e-5,0,0)) !== V.key(v3(0.500001e-5,0,0))  // verschiedene Buckets
```

`ARCHITECTURE.md:66-69` macht das automatische Verschmelzen zur **zentralen**
Eigenschaft des Systems („Genau das macht das Zeichnen in SketchUp aus"). Wenn Dev
Kernel `key()` als Grundlage der Vertexverschmelzung nimmt - wofür der Kommentar
einlädt - entstehen sporadisch doppelte Vertices, die sich später als nicht
schließende Schleifen und fehlende Flächen äußern. Solche Fehler sind extrem
schwer zu reproduzieren.

**Vorschlag:** den Kommentar auf *„grobe Bucket-Zuordnung, für exakte Suche müssen
die 27 Nachbarzellen mitgeprüft werden"* ändern **und** eine fertige Funktion
anbieten, damit es nicht jeder anders macht:

```ts
/** alle 27 Bucket-Keys, die einen Punkt innerhalb tol enthalten koennen */
export function keyNeighborhood(a: Vec3Like, tol = POINT_TOL): string[]
```

## W-7 - Die Modellachsen haben keinen Platz im Dokument

**Dateien:** `src/shared/types.ts:709` (`ToolId 'axes'`), `types.ts:392` (`showAxes`), `types.ts:545-565`

Es gibt ein Werkzeug `'axes'` und einen Stil-Schalter `showAxes`, aber
`SketchDocument` speichert nirgends, **wo** die Achsen stehen. In SketchUp
verschiebt und dreht das Achsenwerkzeug die Zeichenachsen; alle Inferenzen
(`onAxisX/Y/Z`, `types.ts:631-633`), das Raster und die Bemaßung richten sich
danach. Dev Tools kann das Werkzeug nicht implementieren, Dev Render weiß nicht,
wo die Achsen zu zeichnen sind.

**Vorschlag:** in `SketchDocument` (und sinnvollerweise pro `Definition`, weil
Gruppen in SketchUp eigene Achsen haben) ergänzen:

```ts
/** Zeichenachsen des Kontexts, Standard = Identitaet */
axes: Mat4Like
```

## W-8 - Es gibt kein `activeSceneId`

**Dateien:** `src/shared/store-api.ts:372-378`, `src/shared/types.ts:433-457`

`activateScene(id)` existiert, aber weder `AppState` noch `SketchDocument` merken
sich, welche Szene aktiv ist. Der Szenen-Reiter kann die aktive Szene nicht
hervorheben, und `updateSceneFromView(id)` („Szene aktualisieren") braucht die
Angabe ebenfalls. Für `activeStyleId`, `activeTagId` und `activeMaterialId` gibt es
das Muster bereits (`types.ts:560-564`) - bei Szenen fehlt es.

**Vorschlag:** `activeSceneId: Id | null` in `AppState` (nicht in `SketchDocument`,
da es kein Dokumentzustand ist) plus Pflege in `activateScene`.

## W-9 - `TagFolder` hat keinen Elternbezug, `isTagVisible` verspricht aber Verschachtelung

**Dateien:** `src/shared/types.ts:323-327`, `src/shared/store-api.ts:219-220`

```ts
export interface TagFolder { id: Id; name: string; visible: boolean }   // kein folderId
/** true when the tag (and all parent folders) is visible */            // Plural
isTagVisible(tagId: Id | null): boolean
```

`Tag.folderId` (`types.ts:319`) verweist auf einen Ordner, aber ein Ordner kann
keinen Elternordner haben. Entweder ist die Verschachtelung gewollt (dann fehlt
das Feld) oder nicht (dann ist der Kommentar falsch und Dev Model implementiert
möglicherweise eine rekursive Suche, die nie terminiert bzw. nie greift).

**Vorschlag:** `folderId: Id | null` in `TagFolder` ergänzen und in
`ARCHITECTURE.md:209` („Tag-Ordner") die maximale Tiefe festlegen - oder den
Kommentar auf „(und sein Ordner)" korrigieren.

## W-10 - Zwei Wahrheitsquellen für das aktive Werkzeug

**Dateien:** `src/shared/store-api.ts:177-178, 383-385, 544-546`, `src/shared/events.ts:22`

Das aktive Werkzeug steht an drei Stellen: `AppState.activeTool` (+
`setActiveTool`), `ToolManagerApi.getToolId()` / `setTool()` und im Event
`tool:changed`. Der Contract sagt nicht, wer führt. Wahrscheinlicher Ablauf: Dev UI
ruft `store.setActiveTool('line')`, Dev Tools hört nicht darauf, weil sein
Manager auf `setTool` wartet - der Werkzeugkasten leuchtet, aber nichts passiert.
Das Gleiche gilt für `pushTransient` / `popTransient` (`store-api.ts:548-549`)
gegenüber `previousTool` / `restorePreviousTool` (`store-api.ts:178, 385`), die
dasselbe Problem doppelt lösen.

**Vorschlag:** in `store-api.ts` über `activeTool` schreiben, wer führt, z. B.:
*„`AppState.activeTool` ist die einzige Wahrheitsquelle. Der ToolManager abonniert
den Store und aktiviert die passende Werkzeuginstanz; `ToolManagerApi.setTool`
ruft intern `setActiveTool` und ist nur eine Bequemlichkeit."* Danach
`previousTool`/`restorePreviousTool` **oder** `pushTransient`/`popTransient`
streichen.

## W-11 - `transformPrimitives(sel, …)` und `transformEntities(…)` überlappen sich

**Datei:** `src/shared/store-api.ts:260, 297`

```ts
transformPrimitives(sel: Selection, matrix: Mat4Like, copy: boolean): GeometryChange
transformEntities(ids: Id[], matrix: Mat4Like, copy: boolean): Id[]
```

`Selection` enthält `entityIds` (`types.ts:516`). Verarbeitet
`transformPrimitives` die mit, oder ignoriert es sie? Das Verschieben-Werkzeug muss
in einem Zug Geometrie **und** Instanzen bewegen. Ruft es beides auf und
`transformPrimitives` behandelt Entities mit, werden Gruppen doppelt verschoben;
ignoriert es sie und das Werkzeug ruft nur `transformPrimitives`, bleiben Gruppen
stehen. Auch die Rückgabetypen passen nicht zusammen (`GeometryChange` vs. `Id[]`),
sodass das Werkzeug bei `copy: true` die neuen Ids nur für einen der beiden Fälle
bekommt.

**Vorschlag:** eine Operation mit klarer Rückgabe:

```ts
/** verschiebt/kopiert Geometrie UND Entities der Auswahl in einem Schritt */
transformSelection(sel: Selection, matrix: Mat4Like, copy: boolean): {
  change: GeometryChange
  newSelection: Selection
}
```

## W-12 - `AppState.hover` ist untypisiert und ohne Kontextangabe

**Datei:** `src/shared/store-api.ts:175`

```ts
hover: { kind: string; id: Id | null; definitionId: Id | null } | null
```

`kind` ist `string`, obwohl `PickKind` (`types.ts:573-581`) genau dafür existiert -
Tippfehler wie `'verticex'` fallen nicht auf. Außerdem fehlt `instancePath`: bei
verschachtelten Komponenten kann der Renderer aus `definitionId` allein nicht
ableiten, **welche** Instanz zu hervorheben ist, wenn dieselbe Definition mehrfach
platziert wurde.

**Vorschlag:**

```ts
hover: { kind: PickKind; id: Id | null; definitionId: Id | null; instancePath: Id[] } | null
```

oder schlicht `hover: PickHit | null`.

## W-13 - `Selection` hat keinen Kontextbezug, `pickRect` kann aber kontextübergreifend liefern

**Dateien:** `src/shared/types.ts:510-517`, `src/shared/store-api.ts:445-447`

`Selection` ist dokumentiert als „ids of vertices/edges/faces **inside the active
context**". `ViewportApi.pickRect` / `pickLasso` geben aber ein `Selection` zurück,
und ein Auswahlrechteck über der Modellwurzel erfasst typischerweise Instanzen
verschiedener Definitionen. Ids sind laut `ids.ts` global eindeutig, aber
`getEdge(id, definitionId?)` (`store-api.ts:203`) braucht bei fehlendem zweiten
Argument den *aktiven* Kontext - eine Kante aus einer fremden Definition wird dort
nicht gefunden.

**Vorschlag:** entweder in `Selection` ein `definitionId: Id` ergänzen und die
Invariante „eine Selection lebt in genau einem Kontext" hart machen, oder in
`store-api.ts` bei `pickRect` explizit dokumentieren, dass nur Elemente des
aktiven Kontexts plus dessen direkte Kinder geliefert werden.

## W-14 - Bemaßungen sind nicht an Geometrie gebunden

**Datei:** `src/shared/types.ts:204-220`

`DimensionEntity` speichert `start`, `end` und optional `center` als reine
Koordinaten. Verschiebt der Nutzer die vermessene Kante, bleibt das Maß stehen und
zeigt einen falschen Wert an. `ARCHITECTURE.md:218` verspricht „Bemaßung (linear,
Radius, Durchmesser, Winkel)" im SketchUp-Funktionsumfang - dort hängen Maße an
Endpunkten und Kanten und aktualisieren sich mit.

Für `kind: 'radius' | 'diameter'` fehlt zusätzlich jede Referenz auf den
Kreisbogen; aus zwei Punkten lässt sich kein Radius rekonstruieren.

**Vorschlag:**

```ts
export interface DimensionAttachment {
  kind: 'vertex' | 'edge' | 'face' | 'instance' | 'free'
  id: Id | null
  definitionId: Id | null
  instancePath: Id[]
  /** Parameter auf der Kante fuer 'edge' (0..1) */
  t?: number
}
// in DimensionEntity:
attachments: [DimensionAttachment, DimensionAttachment] | [DimensionAttachment, DimensionAttachment, DimensionAttachment]
```

Wenn das für Runde 1 zu groß ist, reicht zunächst ein
`refIds: Id[]` plus die Festlegung, dass Maße nach jeder Geometrieänderung neu
ausgewertet werden.

## W-15 - `GeometryChange` sagt nicht, welche Definition betroffen ist

**Datei:** `src/shared/store-api.ts:52-74`

Das Bus-Event `geometry:changed` trägt `{ definitionId, full }`
(`events.ts:30`), das Rückgabeobjekt aller Geometrieoperationen aber nicht. Wer
`addEdge` aufruft, kann aus dem Ergebnis nicht ableiten, für welchen Kontext er
das Event feuern soll - er muss den aktiven Kontext erneut abfragen und hoffen,
dass er sich zwischenzeitlich nicht geändert hat. Außerdem fehlt
`modifiedVertices`, obwohl `moveVertices` (`store-api.ts:258`) genau die ändert -
der Renderer kann Positionsänderungen nicht inkrementell nachziehen.

**Vorschlag:** `definitionId: Id` und `modifiedVertices: Id[]` in
`GeometryChange` und `emptyChange()` ergänzen.

## W-16 - Doppelklicks werden zweimal zugestellt

**Datei:** `src/app/ViewportHost.tsx:100-111, 124-127`

`onPointerDown` zählt selbst mit (`clickCount`, Zeile 105) und übergibt den Wert an
`handlePointerDown`. Zusätzlich hängt am Canvas ein nativer `dblclick`-Listener,
der `handleDoubleClick` aufruft. Beim zweiten Klick bekommt das Werkzeug also
**beides**: ein `onPointerDown` mit `clickCount === 2` und ein `onDoubleClick`.
`ARCHITECTURE.md:208` nennt „Kontextnavigation per Doppelklick" - wenn das
Werkzeug beide Wege behandelt, springt der Nutzer zwei Ebenen tief.

`clickCount` wird zudem nie zurückgesetzt: Vier schnelle Klicks liefern
`clickCount === 4`, obwohl `PointerInfo.clickCount` mit „(1,2,3)" dokumentiert ist
(`types.ts:736`).

**Vorschlag:** einen der beiden Wege wählen. Empfehlung: den nativen
`dblclick`-Listener entfernen und `handleDoubleClick` aus `onPointerDown` bei
`clickCount === 2` selbst aufrufen (dann ist die Reihenfolge deterministisch),
sowie `clickCount` bei `> 3` auf 1 zurücksetzen.

## W-17 - Wer das Overlay leert, widerspricht sich zwischen Doku und Code

**Dateien:** `ARCHITECTURE.md:188-190`, `src/app/ViewportHost.tsx:69-77`

`ARCHITECTURE.md`: *„Werkzeug-Feedback […] geht ausschließlich über die `OverlayApi`
im Immediate-Mode - **der Renderer** leert das Overlay vor jedem `draw()`."*

`ViewportHost.tsx:70`: der **Host** ruft `vp.overlay.clear()` und danach
`tm.draw()`.

Damit gibt es zwei plausible Implementierungen, und wenn Dev Render die Doku
umsetzt, wird zweimal geleert - im ungünstigen Fall *nach* dem Zeichnen der Tools,
und die Gummibänder sind unsichtbar. Zusätzlich passen `Tool.draw(overlay)`
(`store-api.ts:539`) und `ToolManagerApi.draw()` ohne Argument
(`store-api.ts:559`) nicht offensichtlich zusammen; woher der Manager sein Overlay
nimmt, steht nirgends (vermutlich `ToolContext.overlay`, `store-api.ts:510`).

**Vorschlag:** `ARCHITECTURE.md` Abschnitt 7 an den Code anpassen (*„die
Integrationsschicht `ViewportHost` leert das Overlay vor jedem `draw()`-Durchlauf;
der Renderer zeichnet nur, was drin steht"*) und bei `ToolManagerApi.draw()`
dokumentieren, dass der Manager das Overlay aus seinem `ToolContext` bezieht.

## W-18 - `ARCHITECTURE.md` kennt `src/app/**` nicht

**Datei:** `ARCHITECTURE.md:84-125`

Das Schichtdiagramm (Zeile 84-108) und die Eigentümertabelle (Zeile 112-122) führen
`shared`, `core`, `model`, `render`, `io`, `tools`, `ui`, `main.tsx` und `app.css`
auf - aber nicht `src/app/`, obwohl dort mit `bootstrap.ts` und `ViewportHost.tsx`
die gesamte Verdrahtung liegt und beide Dateien im Kopf „OWNERSHIP: Lead" tragen.
Ein Entwickler, der `ARCHITECTURE.md:124` befolgt („Schreibe niemals in ein fremdes
Verzeichnis"), kann nicht wissen, ob `src/app` fremd ist.

`CLAUDE.md` (Abschnitt „Dateieigentum", seit Commit `c887d69`) nennt `src/app/**`
inzwischen als Lead-Eigentum, verweist für die Details aber ausdrücklich auf
`ARCHITECTURE.md` Abschnitt 4 - und genau dort fehlt der Eintrag. Die beiden
Dokumente widersprechen sich damit.

Zusätzlich ist unklar, in welcher Schicht `src/app` liegt: es importiert `render`,
`tools`, `model`, `io` und `shared` gleichzeitig und steht damit über Schicht 5.

**Vorschlag:** Zeile im Diagramm und in der Tabelle ergänzen, damit beide Dokumente
übereinstimmen:

| `src/app/**` | **Lead** (read-only für alle) | alles |

## W-19 - `UnitSettings.precision` bedeutet in jedem Formatierer etwas anderes; `format: 'engineering'` wird nicht behandelt

**Dateien:** `src/shared/types.ts:474, 479`, `src/shared/units.ts:255-299`

Ein und dasselbe Feld wird viermal unterschiedlich interpretiert:

| Funktion | Zeile | Nachkommastellen |
|---|---|---|
| `formatLength` | 271 | `Math.max(0, precision)` |
| `formatAngle` (deg) | 283 | `Math.max(1, precision)` |
| `formatAngle` (rad) | 279 | `Math.max(2, precision)` |
| `formatArea` / `formatVolume` | 290 / 297 | `Math.max(2, precision)` |

Mit `DEFAULT_UNITS.precision = 1` bekommt man also 1 Nachkommastelle bei Längen,
aber 2 bei Flächen. Ein Nutzer, der „genauer anzeigen" einstellt, sieht die
Änderung an manchen Stellen nicht.

Außerdem hat `UnitSettings.format` den Wert `'engineering'` (`types.ts:474`), den
`formatLength` nirgends behandelt - er fällt stillschweigend in den Dezimalzweig.
In SketchUp ist „engineering" Dezimalfuß; mit `lengthUnit: 'mm'` kommt hier etwas
ganz anderes heraus.

**Vorschlag:** entweder getrennte Felder (`lengthPrecision`, `anglePrecision`,
`areaPrecision`) oder `precision` konsequent als Nachkommastellen für alle
Formatierer verwenden und die Mindestwerte streichen. Für `'engineering'` einen
eigenen Zweig ergänzen (Dezimalfuß) oder den Wert aus dem Union-Typ entfernen.

---

# Kosmetisch

## K-1 - `M.normalMatrix` liefert nicht, was der Kommentar sagt

`src/core/math/mat4.ts:188-191` - Kommentar: *„transpose of the inverse upper
3x3"*, Code: `transpose(invert(m))` über die **volle** 4×4-Matrix. Für den
vorgesehenen Gebrauch über `applyMat4Direction` (nur obere 3×3) ist das Ergebnis
korrekt - die Tests belegen es. Wer die Matrix aber an `M.transformPoint` gibt,
bekommt Unsinn, weil die untere Zeile die Translation der Inversen enthält.
**Vorschlag:** Kommentar präzisieren („nur die obere 3×3 ist gültig, ausschließlich
mit `transformDirection` verwenden") oder die letzte Zeile/Spalte auf `0,0,0,1`
zurücksetzen.

## K-2 - `formatArchitectural` ignoriert `displayUnitSuffix`

`src/shared/units.ts:239-252` gegenüber `units.ts:256`. `formatLength` berechnet
`showSuffix`, reicht es aber nicht an `formatArchitectural` weiter. Folge:
`formatPoint` (`units.ts:302-305`) ruft mit `{ suffix: false }` auf und bekommt in
imperialen Dokumenten trotzdem `[3' 6"; …]`.

## K-3 - `V.isParallel` und `V.isPerpendicular` melden `true` für den Nullvektor

`src/core/math/vec3.ts:154-160`, Test in `vec3.test.ts`. `normalize` liefert für
den Nullvektor den Nullvektor (`vec3.ts:92`), Kreuzprodukt und Skalarprodukt sind
dann 0 - beide Prädikate antworten `true`. In der Inferenz kann eine entartete
Richtung so als „parallel zu allem" durchgehen.
**Vorschlag:** in beiden Funktionen `if (isZero(a) || isZero(b)) return false`.

## K-4 - `V2.perp` liefert `-0` für die X-Komponente

`src/core/math/vec2.ts:53-55`: `{ x: -a.y, y: a.x }` ergibt für `a.y === 0` ein
`-0`. Rechnerisch belanglos, aber `Object.is`-Vergleiche und `toEqual` in Tests
schlagen fehl (im QA-Test mit `close()` umgangen). `JSON.stringify(-0)` liefert
`"0"`, die Serialisierung ist also nicht betroffen.

## K-5 - `Face.normal` und `Face.plane.n` sind redundant

`src/shared/types.ts:96-99`. Zwei Felder mit derselben Information, die
auseinanderlaufen können. Der Kommentar (`plane`, „normal == `normal`") ist eine
Invariante ohne Durchsetzung. **Vorschlag:** `normal` streichen und
`face.plane.n` verwenden.

## K-6 - `MeasurementField` und `StatusMessage` doppeln `UiState`

`src/shared/types.ts:791-807` gegenüber `src/shared/store-api.ts:119-124`. Die
Typen `StatusMessage { hint, modifiers }` und
`MeasurementField { label, value, editing, placeholder }` beschreiben genau die
Felder, die in `UiState` einzeln flach liegen (`statusHint`, `statusModifiers`,
`vcbLabel`, …). Beide Typen werden nirgends verwendet. **Vorschlag:** entweder in
`UiState` verschachteln (`status: StatusMessage; vcb: MeasurementField`) oder die
ungenutzten Typen entfernen.

## K-7 - `UvMapping.m` ist row-major, alles andere column-major

`src/shared/types.ts:109-111`: *„row major 3x3"* - während `Mat4Like`
(`types.ts:32`) und `ARCHITECTURE.md:157` ausdrücklich Spalten-Major festlegen.
Eine Ausnahme in einer einzigen Struktur ist eine sichere Fehlerquelle.

## K-8 - Der `Loop`-Kommentar erklärt die Schlusskante nicht

`src/shared/types.ts:84-88`: *„`edges[i]` connects `vertices[i]` to
`vertices[i+1]`"* - für `i === n-1` gibt es kein `vertices[n]`. Gemeint ist
offensichtlich `vertices[(i+1) % n]`; das sollte dastehen, ebenso wie die
Invariante `edges.length === vertices.length`.

## K-9 - `parseLength` akzeptiert `5 1/2'` nicht und normalisiert nur schließende typografische Anführungszeichen

`src/shared/units.ts:132, 136`. Die Fuß-Zoll-Regex erlaubt für den Fußteil nur
`NUMBER`, keinen gemischten Bruch - `5 1/2'` liefert `null`. Zeile 132 ersetzt `′`,
`″` und `”`, aber nicht die öffnenden Varianten `‘` und `“`, die manche Tastaturen
und Copy-Paste-Quellen produzieren. Beides sind Randfälle, aber im Maßeingabefeld
sieht der Nutzer nur „nichts passiert".

## K-10 - `V.equals` prüft einen Würfel, `V.equalsSq` eine Kugel

`src/core/math/vec3.ts:115-121`. `equals` vergleicht komponentenweise
(Toleranzwürfel mit Kantenlänge 2·tol), `equalsSq` den euklidischen Abstand
(Kugel). Zwei Punkte mit Abstand 1,7·`POINT_TOL` diagonal sind für `equals`
gleich, für `equalsSq` verschieden. Für die Vertexverschmelzung muss genau eine
Definition gelten (siehe auch W-6). **Vorschlag:** im Kopf von `constants.ts`
festhalten, welche der beiden maßgeblich ist.

## K-11 - `SunSettings.northAngle` ist „im Uhrzeigersinn" in einem rechtshändigen System

`src/shared/types.ts:419-420`: *„degrees clockwise from +Y"*. In einem
rechtshändigen Z-oben-System (`ARCHITECTURE.md:29`) ist eine Drehung im
Uhrzeigersinn von oben gesehen **negativ** um +Z. Die Angabe ist nicht falsch, aber
sie lädt zum Vorzeichenfehler ein. **Vorschlag:** ergänzen: *„entspricht einer
Drehung um `-northAngle` Grad um +Z"*.

## K-12 - `M.fromArray` kürzt still

`src/core/math/mat4.ts:255-257`: `Array.from(values).slice(0, 16)`. Bei weniger als
16 Eingabewerten entsteht eine zu kurze „Matrix" ohne Fehlermeldung - genau der
Fall, der beim Laden einer beschädigten `.osk`-Datei auftritt.
**Vorschlag:** `if (values.length < 16) throw new Error('Mat4 braucht 16 Werte')`.

## K-13 - `e.returnValue = ''` ist veraltet

`src/app/bootstrap.ts:157`. `BeforeUnloadEvent.returnValue` ist deprecated;
`e.preventDefault()` (Zeile 156) genügt in allen aktuellen Browsern.

---

# Anhang: geschriebene Tests

| Datei | Tests | davon `it.fails` |
|---|---|---|
| `src/core/math/__tests__/vec3.test.ts` | 31 | - |
| `src/core/math/__tests__/mat4.test.ts` | 31 | - |
| `src/core/math/__tests__/plane.test.ts` | 39 | - |
| `src/core/math/__tests__/ray.test.ts` | 32 | 2 (B-2) |
| `src/core/math/__tests__/bbox.test.ts` | 21 | - |
| `src/core/math/__tests__/vec2.test.ts` | 19 | - |
| `src/shared/__tests__/units.test.ts` | 67 | 2 (B-3, W-1) |
| **Summe** | **240** | **4** |

Ausführen mit:

```
cd opensketch && npm install && npx vitest run src/shared src/core/math
```

Ergebnis: **7 Testdateien grün, 236 bestanden, 4 erwartete Fehlschläge.**
`npx tsc -b --noEmit` ist ebenfalls grün.

Die vier `it.fails`-Tests sind die Abnahmekriterien für B-2, B-3 und W-1: Sobald
der jeweilige Bug behoben ist, schlagen sie als „unerwartet bestanden" fehl und
müssen zu normalen `it`-Tests umgeschrieben werden. Der jeweils danebenstehende
`(IST-Zustand)`-Test dokumentiert das aktuelle Verhalten und ist dann zu
entfernen.

## Was ausdrücklich geprüft und für korrekt befunden wurde

Damit niemand doppelt sucht:

- **Spalten-Major-Layout** von `M.translation`, `M.scaling`, `M.fromBasis` -
  identisch zu `THREE.Matrix4.elements`.
- **Multiplikationsreihenfolge** `multiply(a, b)` = erst `b`, dann `a`;
  `chain(a,b,c) === a*b*c`; Assoziativität.
- **Rechtshändigkeit** durchgängig: `V.cross(X,Y) === Z`, `M.rotation(+Z, 90°)`
  bildet `+X` auf `+Y` ab, `M.rotation` stimmt für beliebige Achsen und Winkel
  exakt mit `V.rotateAround` (Rodrigues) überein, `V.signedAngle` folgt der
  Rechte-Hand-Regel, `P.basis` liefert immer `u × v === n`.
- **`M.invert`**: `m · m⁻¹ = I`, `(ab)⁻¹ = b⁻¹a⁻¹`, `(m⁻¹)⁻¹ = m`,
  `det(m⁻¹) = 1/det(m)`, Identität bei Singularität. Formel stimmt Term für Term
  mit der three.js-Referenzimplementierung überein.
- **`M.mirror`**: selbstinvers, Fixpunkte auf der Ebene, `det < 0`.
- **`M.transformNormal`**: bleibt unter nicht-uniformer Skalierung senkrecht auf
  den transformierten Tangenten.
- **Newell-Normale** (`P.polygonNormalRaw`): korrekt für konvexe, konkave und
  stark konkave Schleifen, unabhängig vom Startindex, mitdrehend unter Rotation;
  `P.polygonArea` liefert exakt die richtigen Flächen (L-Form: 3, Stern: 12).
- **`P.intersectPlane`**: Richtung und Aufpunkt liegen für allgemeine schiefe
  Ebenen exakt in beiden Ebenen; `null` bei parallelen, identischen und
  gespiegelten Ebenen.
- **`R.intersectTriangle`**: baryzentrische Koordinaten, `t` als echter Abstand,
  Rückseiten-Culling in der richtigen Richtung, `null` bei parallelem Strahl und
  bei Treffern hinter dem Ursprung.
- **`B.transform`**: umschließt alle transformierten Ecken, korrekte Vergrößerung
  bei 45°-Drehung, identisch zu `B.fromPoints(corners.map(transform))`.
- **`parseLength`**: alle im Kommentar (`units.ts:126-128`) zugesagten Formate -
  `5`, `5m`, `500mm`, `12,5 cm`, `3'`, `6"`, `3' 6"`, `3'6`, `1 1/2"`, `3/4"`,
  `3' 6 1/2"`, `5ft`, `5 in`, `2yd`, `2.5m` - funktionieren, inklusive deutschem
  Dezimalkomma, Vorzeichen, Groß-/Kleinschreibung und typografischen
  Anführungszeichen. Die Regel „blanke Zahl folgt `units.lengthUnit`, `ftin` →
  Zoll" stimmt.
