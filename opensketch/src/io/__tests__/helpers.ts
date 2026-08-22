/**
 * Gemeinsame Testhilfen der IO-Schicht.
 *
 * Die Tests arbeiten gegen echte `SketchDocument`e, nicht gegen Attrappen -
 * Import und Export sollen genau das sehen, was die Anwendung ihnen gibt.
 */

import type {
  Definition,
  Geometry,
  Id,
  InstanceEntity,
  Material,
  SketchDocument,
  Vec3Like,
} from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { createEmptyDocument } from '@/model'
import { newId } from '@/shared/ids'
import { M } from '@/core/math'
import { GeomBuilder, geometryBounds } from '../common/geom'

/* ------------------------------------------------------------------ */
/* Dokumente                                                           */
/* ------------------------------------------------------------------ */

/** Leeres Dokument ohne Standardmaterialien - deterministisch fuer Tests. */
export function emptyDoc(name = 'Testmodell'): SketchDocument {
  const doc = createEmptyDocument('empty')
  doc.meta.name = name
  return doc
}

/** Rohgeometrie der Wurzeldefinition. */
export function rootGeometry(doc: SketchDocument): Geometry {
  return doc.definitions[doc.rootId].geometry
}

/**
 * Achsparalleler Quader in die Wurzel des Dokuments.
 * Sechs N-Gon-Flaechen, keine Triangulierung.
 */
export function addBox(
  geom: Geometry,
  min: Vec3Like,
  max: Vec3Like,
  materialId: Id | null = null,
): void {
  const g = new GeomBuilder(geom)
  const { x: x0, y: y0, z: z0 } = min
  const { x: x1, y: y1, z: z1 } = max
  const p = (x: number, y: number, z: number): Vec3Like => ({ x, y, z })
  const opts = { materialId }
  // Aussenschleifen laufen gegen den Uhrzeigersinn, von aussen gesehen
  g.face([p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)], [], opts) // unten
  g.face([p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], [], opts) // oben
  g.face([p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], [], opts) // vorn
  g.face([p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)], [], opts) // hinten
  g.face([p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)], [], opts) // links
  g.face([p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], [], opts) // rechts
}

/** Dokument mit einem einzelnen Wuerfel in der Wurzel. */
export function cubeDoc(size = 2, materialId: Id | null = null): SketchDocument {
  const doc = emptyDoc('Wuerfel')
  addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: size, y: size, z: size }, materialId)
  return doc
}

/** Dokument mit Wuerfel und einem Material darauf. */
export function cubeWithMaterial(size = 2): { doc: SketchDocument; material: Material } {
  const doc = emptyDoc('Wuerfel')
  const material: Material = {
    id: newId('m'),
    name: 'Eiche hell',
    color: '#c8a26a',
    opacity: 1,
    textureId: null,
    textureWidth: 1.2,
    textureHeight: 1.2,
    roughness: 0.65,
    metalness: 0,
    category: 'Holz',
    colorize: false,
  }
  doc.materials[material.id] = material
  addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: size, y: size, z: size }, material.id)
  return { doc, material }
}

/**
 * Haengt eine Definition mit Instanz unter die Wurzel - fuer Hierarchietests
 * (glTF-Knoten, DAE-Szene, OBJ-Gruppen).
 */
export function addGroup(
  doc: SketchDocument,
  name: string,
  transform = M.identity(),
  build: (geom: Geometry) => void = () => {},
): { definition: Definition; entity: InstanceEntity } {
  const definition: Definition = {
    id: newId('d'),
    name,
    kind: 'group',
    description: '',
    geometry: emptyGeometry(),
    children: [],
    instanceCount: 1,
  }
  build(definition.geometry)
  const entity: InstanceEntity = {
    id: newId('e'),
    type: 'instance',
    name,
    definitionId: definition.id,
    transform,
    isGroup: true,
    materialId: null,
    tagId: null,
    hidden: false,
    locked: false,
  }
  doc.definitions[definition.id] = definition
  doc.entities[entity.id] = entity
  doc.definitions[doc.rootId].children.push(entity.id)
  return { definition, entity }
}

/* ------------------------------------------------------------------ */
/* Auswertung                                                          */
/* ------------------------------------------------------------------ */

export function faceCount(geom: Geometry): number {
  return Object.keys(geom.faces).length
}

export function vertexCount(geom: Geometry): number {
  return Object.keys(geom.vertices).length
}

export function edgeCount(geom: Geometry): number {
  return Object.keys(geom.edges).length
}

export function boundsSize(geom: Geometry): Vec3Like {
  const b = geometryBounds(geom)
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z }
}

/** Volumen aus Dreiecken ueber das Divergenztheorem - vorzeichenbehaftet. */
export function volumeOfTriangles(
  tris: readonly { a: Vec3Like; b: Vec3Like; c: Vec3Like }[],
): number {
  let sum = 0
  for (const t of tris) {
    sum +=
      t.a.x * (t.b.y * t.c.z - t.c.y * t.b.z) -
      t.a.y * (t.b.x * t.c.z - t.c.x * t.b.z) +
      t.a.z * (t.b.x * t.c.y - t.c.x * t.b.y)
  }
  return sum / 6
}

/* ------------------------------------------------------------------ */
/* Blobs                                                               */
/* ------------------------------------------------------------------ */

export async function blobText(blob: Blob): Promise<string> {
  return blob.text()
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Minimaler Wohlgeformtheitspruefer fuer die XML-Ausgaben (DAE, SVG).
 * In Node gibt es keinen DOMParser, und ein Fremdpaket ist nicht erlaubt -
 * fuer Dateien, die aus Strings zusammengesetzt werden, reicht das hier: Tags
 * muessen in der richtigen Reihenfolge schliessen, Attribute in
 * Anfuehrungszeichen stehen, und im Text darf kein unmaskiertes `<` oder `&`
 * vorkommen.
 */
export function checkXml(xml: string): { ok: true } | { ok: false; error: string } {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
  const stack: string[] = []
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"<]*")*)\s*(\/?)>/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tag.exec(body)) !== null) {
    const text = body.slice(cursor, match.index)
    if (text.includes('<')) return { ok: false, error: `Unmaskiertes < in "${text.slice(0, 60)}"` }
    if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(text)) {
      return { ok: false, error: `Unmaskiertes & in "${text.slice(0, 60)}"` }
    }
    cursor = match.index + match[0].length
    const [, closing, name, , selfClosing] = match
    if (selfClosing) continue
    if (closing) {
      const open = stack.pop()
      if (open !== name) return { ok: false, error: `</${name}> schliesst <${open ?? 'nichts'}>` }
    } else {
      stack.push(name)
    }
  }
  const rest = body.slice(cursor)
  if (rest.includes('<')) return { ok: false, error: `Unvollstaendiges Tag: "${rest.slice(0, 60)}"` }
  if (stack.length > 0) return { ok: false, error: `Nicht geschlossen: ${stack.join(', ')}` }
  return { ok: true }
}
