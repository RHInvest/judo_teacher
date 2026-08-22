/**
 * STL-Export, binaer und ASCII.
 *
 * STL kennt weder Materialien noch Hierarchie: alle Instanzen werden in
 * Weltkoordinaten eingebacken und jede Flaeche trianguliert. Die
 * Facettennormale wird aus dem Dreieck selbst berechnet und - falls das
 * Dreieck entartet ist - durch die Flaechennormale ersetzt.
 */

import type { SketchDocument, Vec3Like } from '@/shared/types'
import type { ExportOptions, ExportResult } from '../api-types'
import { flattenDocument, triangulateFlatFace, usedMaterials, type FlatDocument } from '../common/scene'
import { binaryBlob, num, sanitizeFilename, textBlob } from '../common/util'
import {
  STL_HINT,
  WarningList,
  degenerateEdgesWarning,
  degenerateFacesWarning,
  emptyExportWarning,
  facelessEdgesWarning,
  flatLoss,
  skippedInstancesWarning,
  stlMaterialsWarning,
} from '../common/warnings'
import { V } from '@/core/math'

export interface StlTriangle {
  normal: Vec3Like
  a: Vec3Like
  b: Vec3Like
  c: Vec3Like
}

/** Alle Dreiecke des Dokuments in Weltkoordinaten. */
export function collectTriangles(doc: SketchDocument, opts: ExportOptions = {}): StlTriangle[] {
  return trianglesOf(flattenFor(doc, opts)).triangles
}

function flattenFor(doc: SketchDocument, opts: ExportOptions): FlatDocument {
  return flattenDocument(doc, {
    unitScale: opts.unitScale ?? 1,
    onlyEntityIds: opts.selectionOnly ? opts.selectedEntityIds : undefined,
  })
}

/**
 * `degenerate` zaehlt Flaechen, die keinen einzigen brauchbaren Dreieckszug
 * ergeben haben - sie fielen bisher lautlos aus der Schleife.
 */
function trianglesOf(flat: FlatDocument): { triangles: StlTriangle[]; degenerate: number } {
  const out: StlTriangle[] = []
  let degenerate = 0
  for (const poly of flat.faces) {
    const before = out.length
    for (const tri of triangulateFlatFace(poly)) {
      const raw = V.cross(V.sub(tri.b, tri.a), V.sub(tri.c, tri.a))
      const len = V.length(raw)
      if (len < 1e-16) continue
      const normal = V.mul(raw, 1 / len)
      // Bei entarteter Triangulierung kann die Umlaufrichtung kippen -
      // die Flaechennormale ist die Referenz.
      const aligned = V.dot(normal, poly.normal) >= 0
      out.push(
        aligned
          ? { normal, a: tri.a, b: tri.b, c: tri.c }
          : { normal: V.negate(normal), a: tri.a, b: tri.c, c: tri.b },
      )
    }
    if (out.length === before) degenerate++
  }
  return { triangles: out, degenerate }
}

/* ------------------------------------------------------------------ */
/* Binaer                                                              */
/* ------------------------------------------------------------------ */

export function exportStlBinary(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const flat = flattenFor(doc, opts)
  const { triangles, degenerate } = trianglesOf(flat)
  const bytes = writeStlBinary(triangles, `OpenSketch Studio - ${doc.meta.name}`)
  return {
    blob: binaryBlob(bytes, 'model/stl'),
    filename: `${sanitizeFilename(opts.filename ?? doc.meta.name)}.stl`,
    warnings: stlWarnings(doc, opts, flat, triangles.length, degenerate),
  }
}

export function writeStlBinary(triangles: readonly StlTriangle[], header: string): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50)
  const view = new DataView(bytes.buffer)
  // 80 Byte Kopf, reiner ASCII-Text, darf nicht mit "solid" beginnen
  const text = header.slice(0, 79)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[i] = code < 128 ? code : 0x3f
  }
  view.setUint32(80, triangles.length, true)

  let offset = 84
  for (const tri of triangles) {
    view.setFloat32(offset, tri.normal.x, true)
    view.setFloat32(offset + 4, tri.normal.y, true)
    view.setFloat32(offset + 8, tri.normal.z, true)
    view.setFloat32(offset + 12, tri.a.x, true)
    view.setFloat32(offset + 16, tri.a.y, true)
    view.setFloat32(offset + 20, tri.a.z, true)
    view.setFloat32(offset + 24, tri.b.x, true)
    view.setFloat32(offset + 28, tri.b.y, true)
    view.setFloat32(offset + 32, tri.b.z, true)
    view.setFloat32(offset + 36, tri.c.x, true)
    view.setFloat32(offset + 40, tri.c.y, true)
    view.setFloat32(offset + 44, tri.c.z, true)
    view.setUint16(offset + 48, 0, true)
    offset += 50
  }
  return bytes
}

/* ------------------------------------------------------------------ */
/* ASCII                                                               */
/* ------------------------------------------------------------------ */

export function exportStlAscii(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const flat = flattenFor(doc, opts)
  const { triangles, degenerate } = trianglesOf(flat)
  const name = sanitizeFilename(opts.filename ?? doc.meta.name)
  return {
    blob: textBlob(writeStlAscii(triangles, name), 'model/stl'),
    filename: `${name}.stl`,
    warnings: stlWarnings(doc, opts, flat, triangles.length, degenerate),
  }
}

export function writeStlAscii(triangles: readonly StlTriangle[], name: string): string {
  const lines: string[] = [`solid ${name}`]
  for (const tri of triangles) {
    lines.push(`  facet normal ${num(tri.normal.x)} ${num(tri.normal.y)} ${num(tri.normal.z)}`)
    lines.push('    outer loop')
    lines.push(`      vertex ${num(tri.a.x)} ${num(tri.a.y)} ${num(tri.a.z)}`)
    lines.push(`      vertex ${num(tri.b.x)} ${num(tri.b.y)} ${num(tri.b.z)}`)
    lines.push(`      vertex ${num(tri.c.x)} ${num(tri.c.y)} ${num(tri.c.z)}`)
    lines.push('    endloop')
    lines.push('  endfacet')
  }
  lines.push(`endsolid ${name}`)
  lines.push('')
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Warnungen                                                           */
/* ------------------------------------------------------------------ */

/**
 * Beide STL-Varianten schreiben dieselben Dreiecke und verlieren deshalb
 * dasselbe: Kanten, Materialien, Hierarchie.
 */
function stlWarnings(
  doc: SketchDocument,
  opts: ExportOptions,
  flat: FlatDocument,
  triangleCount: number,
  degenerateFaces: number,
): string[] {
  const warnings = new WarningList()
  const loss = flatLoss(flat)

  if (triangleCount === 0) {
    warnings.add(emptyExportWarning('STL', opts.selectionOnly === true, STL_HINT))
  } else {
    warnings.add(facelessEdgesWarning(loss.facelessEdges, 'STL'))
  }
  warnings.add(degenerateFacesWarning(degenerateFaces + flat.degenerateFaces))
  warnings.add(degenerateEdgesWarning(flat.degenerateEdges))
  warnings.add(stlMaterialsWarning(usedMaterials(doc, flat).length))
  warnings.add(skippedInstancesWarning(flat.skipped))
  return warnings.list()
}
