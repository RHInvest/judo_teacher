/**
 * Exportwarnungen - was auf dem Weg in die Datei verloren geht.
 *
 * Hintergrund ist der Projektstandard "Kein stilles Scheitern", nur auf der
 * Ausgabeseite: Ein Export, der Inhalt weglaesst, sieht fuer den Nutzer
 * genauso erfolgreich aus wie einer, der alles mitnimmt. Ein flaechenloser
 * Grundriss ergibt eine gueltige, leere STL-Datei - ohne Hinweis merkt das
 * niemand, bis der Drucker nichts anzeigt.
 *
 * Alle Texte stehen hier zusammen und nicht verstreut in den Exportern:
 * Sie werden vom Exportdialog unveraendert als Toast angezeigt, sind also
 * Oberflaeche und keine Entwicklermeldungen. Jeder Satz sagt deshalb
 *   1. was fehlt,
 *   2. warum das Format es nicht kann,
 *   3. was der Nutzer stattdessen tun kann.
 *
 * Gezaehlt wird immer die exportierte Menge (Auswahl beachtet), nicht das
 * ganze Dokument - sonst warnt der Export vor Dingen, die gar nicht dran
 * waren.
 */

import type { Geometry, Id, Material, SketchDocument } from '@/shared/types'
import type { FlatDocument, SceneNode } from './scene'

/* ------------------------------------------------------------------ */
/* Sammler                                                             */
/* ------------------------------------------------------------------ */

/**
 * Kleiner Sammler, damit die Exporter nicht ueberall `if (x) list.push(...)`
 * schreiben. `add` ignoriert leere Texte, doppelte Saetze kommen nur einmal
 * vor - zwei Wege zur selben Warnung sollen nicht zwei Toasts ergeben.
 */
export class WarningList {
  private readonly items: string[] = []

  add(text: string | null | undefined): void {
    if (!text) return
    if (this.items.includes(text)) return
    this.items.push(text)
  }

  /** Fuegt `text` nur hinzu, wenn `condition` zutrifft. */
  addIf(condition: boolean, text: string): void {
    if (condition) this.add(text)
  }

  get length(): number {
    return this.items.length
  }

  /** Kopie fuer `ExportResult.warnings`. */
  list(): string[] {
    return [...this.items]
  }
}

/* ------------------------------------------------------------------ */
/* Sprachhelfer                                                        */
/* ------------------------------------------------------------------ */

/** "1 Kante" / "3 Kanten" - Zahlwoerter fuer die Meldungstexte. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

/* ------------------------------------------------------------------ */
/* Kennzahlen des Exportumfangs                                        */
/* ------------------------------------------------------------------ */

export interface LossCounts {
  /** Kanten, die an keiner Flaeche haengen */
  facelessEdges: number
  /** Flaechen mit einem eigenen Rueckseitenmaterial */
  backMaterialFaces: number
}

const EMPTY_LOSS: LossCounts = { facelessEdges: 0, backMaterialFaces: 0 }

/** Kennzahlen aus der flachen Sicht (STL, OBJ, SVG). */
export function flatLoss(flat: FlatDocument): LossCounts {
  let facelessEdges = 0
  for (const edge of flat.edges) if (!edge.hasFaces) facelessEdges++
  let backMaterialFaces = 0
  for (const face of flat.faces) {
    if (face.backMaterialId && face.backMaterialId !== face.frontMaterialId) backMaterialFaces++
  }
  return { facelessEdges, backMaterialFaces }
}

/**
 * Dieselben Kennzahlen fuer die Knotensicht (glTF, DAE). Gezaehlt wird je
 * Vorkommen im Baum, nicht je Definition: Eine Komponente, die fuenfmal
 * platziert ist, verliert ihre Kanten auch fuenfmal.
 */
export function treeLoss(doc: SketchDocument, root: SceneNode): LossCounts {
  const cache = new Map<Id, LossCounts>()
  const out: LossCounts = { facelessEdges: 0, backMaterialFaces: 0 }

  const lossOf = (definitionId: Id): LossCounts => {
    const known = cache.get(definitionId)
    if (known) return known
    const definition = doc.definitions[definitionId]
    const value = definition ? geometryLoss(definition.geometry) : EMPTY_LOSS
    cache.set(definitionId, value)
    return value
  }

  const walk = (node: SceneNode): void => {
    const loss = lossOf(node.definitionId)
    out.facelessEdges += loss.facelessEdges
    out.backMaterialFaces += loss.backMaterialFaces
    for (const child of node.children) walk(child)
  }

  walk(root)
  return out
}

/** Versteckte und Hilfskanten zaehlen nicht - sie waeren auch sichtbar nicht dabei. */
function geometryLoss(geom: Geometry): LossCounts {
  let facelessEdges = 0
  for (const edge of Object.values(geom.edges)) {
    if (edge.hidden || edge.guide) continue
    if (edge.faces.length === 0) facelessEdges++
  }
  let backMaterialFaces = 0
  for (const face of Object.values(geom.faces)) {
    if (face.hidden) continue
    if (face.backMaterialId && face.backMaterialId !== face.frontMaterialId) backMaterialFaces++
  }
  return { facelessEdges, backMaterialFaces }
}

/** Texturen, die an den mitexportierten Materialien haengen. */
export function usedTextures(doc: SketchDocument, materials: readonly Material[]): Id[] {
  const ids: Id[] = []
  for (const material of materials) {
    if (!material.textureId) continue
    if (!doc.textures[material.textureId]) continue
    if (!ids.includes(material.textureId)) ids.push(material.textureId)
  }
  return ids
}

/* ------------------------------------------------------------------ */
/* Texte - formatuebergreifend                                         */
/* ------------------------------------------------------------------ */

/**
 * Der wichtigste Fall: Die Datei entsteht, ist gueltig und enthaelt nichts.
 * `hinweis` sagt formatabhaengig, was zu tun ist.
 */
export function emptyExportWarning(format: string, selectionOnly: boolean, hinweis: string): string {
  const quelle = selectionOnly
    ? 'Die Auswahl enthält nichts, was sich als'
    : 'Das Modell enthält nichts, was sich als'
  return `${quelle} ${format} speichern lässt — die Datei bleibt leer. ${hinweis}`
}

/** Instanzen, die die Traversierung wegen Ring oder Tiefe ausgelassen hat. */
export function skippedInstancesWarning(count: number): string | null {
  if (count <= 0) return null
  const wurden = count === 1 ? 'wurde' : 'wurden'
  const fehlen = count === 1 ? 'fehlt' : 'fehlen'
  return (
    `${plural(count, 'Instanz', 'Instanzen')} ${wurden} übersprungen — ringförmig ineinander ` +
    `verschachtelte oder zu tief geschachtelte Gruppen kann der Export nicht auflösen, ` +
    `und ${fehlen} in der Datei. Löse die Verschachtelung auf, wenn der Inhalt mit soll.`
  )
}

/** Kanten ohne Flaeche in einem Format, das nur Dreiecke kennt. */
export function facelessEdgesWarning(count: number, format: string): string | null {
  if (count <= 0) return null
  const fehlen = count === 1 ? 'sie fehlt' : 'sie fehlen'
  return (
    `Das Modell enthält ${plural(count, 'Kante ohne Fläche', 'Kanten ohne Fläche')}. ` +
    `${format} speichert nur Dreiecke — ${fehlen} in der Datei. ` +
    `Schliesse den Grundriss zu einer Fläche, bevor du als ${format} exportierst.`
  )
}

/** Kanten ohne Flaeche, die das Format koennte, der Nutzer aber abgeschaltet hat. */
export function edgesDisabledWarning(count: number, format: string): string | null {
  if (count <= 0) return null
  const fehlen = count === 1 ? 'sie fehlt' : 'sie fehlen'
  return (
    `Das Modell enthält ${plural(count, 'Kante ohne Fläche', 'Kanten ohne Fläche')}, ` +
    `und ${fehlen} in der Datei, weil „Kanten mitexportieren“ nicht gesetzt ist. ` +
    `Schalte die Option ein, wenn ${format} auch die Linien enthalten soll.`
  )
}

/**
 * Flaechen, die die Triangulierung nicht verwerten konnte. Bisher fielen sie
 * lautlos aus der Schleife - entartete Eckpunkte, nicht ebene Ringe oder ein
 * einzelner NaN-Vertex reichen dafuer.
 */
export function degenerateFacesWarning(count: number): string | null {
  if (count <= 0) return null
  const liess = count === 1 ? 'liess' : 'liessen'
  const fehlt = count === 1 ? 'fehlt' : 'fehlen'
  return (
    `${plural(count, 'Fläche', 'Flächen')} ${liess} sich nicht in Dreiecke zerlegen und ${fehlt} ` +
    `in der Datei — meist liegen die Eckpunkte zusammen oder nicht in einer Ebene. ` +
    `Zeichne die betroffenen Flächen neu, wenn sie mit sollen.`
  )
}

/** Kanten mit nicht endlichen Koordinaten - dieselbe Ursache, andere Entitaet. */
export function degenerateEdgesWarning(count: number): string | null {
  if (count <= 0) return null
  const hat = count === 1 ? 'hat' : 'haben'
  const fehlt = count === 1 ? 'fehlt' : 'fehlen'
  return (
    `${plural(count, 'Kante', 'Kanten')} ${hat} ungültige Koordinaten und ${fehlt} in der Datei. ` +
    `Lösche die betroffenen Kanten und zeichne sie neu.`
  )
}

/** Rueckseitenmaterialien in Formaten mit nur einem Material je Flaeche. */
export function backMaterialWarning(count: number, format: string): string | null {
  if (count <= 0) return null
  const haben = count === 1 ? 'hat' : 'haben'
  return (
    `${plural(count, 'Fläche', 'Flächen')} ${haben} ein eigenes Rückseitenmaterial. ` +
    `${format} kennt nur ein Material je Fläche — die Rückseite geht verloren. ` +
    `Weise das gewünschte Material der Vorderseite zu, wenn es erhalten bleiben soll.`
  )
}

/* ------------------------------------------------------------------ */
/* Texte - formatabhaengig                                             */
/* ------------------------------------------------------------------ */

export const STL_HINT = 'Schliesse den Grundriss zu einer Fläche, bevor du als STL exportierst.'

export function stlMaterialsWarning(count: number): string | null {
  if (count <= 0) return null
  return (
    `Materialien und Farben gehen verloren: STL speichert nur die nackte Geometrie ` +
    `(${plural(count, 'Material betroffen', 'Materialien betroffen')}). ` +
    `Nutze OBJ, COLLADA oder glTF, wenn die Oberflächen erhalten bleiben sollen.`
  )
}

/** OBJ verweist per `map_Kd` auf Bilddateien, die niemand mitschreibt. */
export function objTexturesReferencedWarning(count: number): string | null {
  if (count <= 0) return null
  const werden = count === 1 ? 'wird' : 'werden'
  return (
    `${plural(count, 'Textur', 'Texturen')} ${werden} in der MTL-Datei referenziert, aber nicht ` +
    `mitgeschrieben — OBJ hat kein Containerformat für Bilddaten. ` +
    `Lege die Bilddateien von Hand daneben, oder exportiere als glTF/GLB, das sie einbettet.`
  )
}

/** `embedTextures: false` - der Nutzer hat es abgeschaltet, verliert aber Inhalt. */
export function texturesDisabledWarning(count: number): string | null {
  if (count <= 0) return null
  const fehlen = count === 1 ? 'fehlt' : 'fehlen'
  return (
    `${plural(count, 'Textur', 'Texturen')} ${fehlen} in der Datei, weil das Einbetten ` +
    `abgeschaltet ist. Die Materialien behalten nur ihre Farbe. ` +
    `Schalte „Texturen einbetten“ ein, wenn die Bilder mit sollen.`
  )
}

export function daeTexturesWarning(count: number): string | null {
  if (count <= 0) return null
  const gehen = count === 1 ? 'geht' : 'gehen'
  return (
    `${plural(count, 'Textur', 'Texturen')} ${gehen} verloren: Der COLLADA-Export schreibt Farben ` +
    `und Kennwerte, aber keine Bilddaten. ` +
    `Nutze glTF oder GLB, wenn die Texturen erhalten bleiben sollen.`
  )
}

/** Eine Textur, deren Data-URL sich nicht lesen laesst - bisher stiller Abbruch. */
export function textureUnreadableWarning(name: string): string {
  return (
    `Die Textur „${name || 'ohne Namen'}“ liess sich nicht lesen und fehlt in der Datei. ` +
    `Das Material behält seine Farbe. Weise die Textur neu zu, wenn sie mit soll.`
  )
}

export function svgProjectionWarning(viewLabel: string): string {
  return (
    `Die Zeichnung ist eine Projektion (${viewLabel}), keine 3D-Datei: Die räumliche Tiefe geht ` +
    `verloren, und verdeckte Kanten bleiben sichtbar. ` +
    `Nutze OBJ, COLLADA oder glTF, wenn die Geometrie räumlich bleiben soll.`
  )
}

export function svgTexturesWarning(count: number): string | null {
  if (count <= 0) return null
  const werden = count === 1 ? 'wird' : 'werden'
  return (
    `${plural(count, 'Textur', 'Texturen')} ${werden} als einfarbige Fläche gezeichnet — ` +
    `die Zeichnung übernimmt nur die Materialfarbe. ` +
    `Nutze den PNG-Export, wenn das Bild die Oberflächen zeigen soll.`
  )
}

export function pngMimeWarning(type: string): string {
  return (
    `Der Viewport hat ein Bild vom Typ „${type}“ geliefert. Es wird unverändert unter der ` +
    `Endung .png gespeichert und ist damit kein echtes PNG. ` +
    `Prüfe die Datei, wenn sie sich nicht öffnen lässt.`
  )
}

/**
 * Formate, die `selectionOnly` gar nicht auswerten koennen: OSK speichert
 * immer das ganze Dokument, PNG immer das, was der Viewport gerendert hat.
 * Ohne Hinweis sieht der Nutzer eine Datei, die mehr enthaelt als bestellt.
 */
export function selectionIgnoredWarning(grund: string): string {
  return `„Nur Auswahl“ wirkt sich hier nicht aus: ${grund}`
}
