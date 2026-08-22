/**
 * Wavefront-OBJ-Export (+ zugehoerige MTL-Datei).
 *
 * Eigenschaften:
 *  - Flaechen bleiben Polygone (N-Gons), es wird nur auf Wunsch trianguliert
 *  - Gruppen und Komponenten werden zu `g`-Bloecken
 *  - `v` / `vt` / `vn` mit `f v/vt/vn`
 *  - Loecher werden als eigene Konturen ausgegeben (OBJ kennt keine Loecher),
 *    deshalb wird eine gelochte Flaeche immer trianguliert
 *  - Kanten optional als `l`
 *
 * Achsen: OBJ legt keine Achsenkonvention fest. Wir schreiben das Modell
 * unveraendert Z-oben heraus (wie Blender) und vermerken das im Kopf.
 */

import type { Material, SketchDocument, Vec3Like } from '@/shared/types'
import type { ExportOptions, ExportResult } from '../api-types'
import { flattenDocument, usedMaterials, type FacePolygon } from '../common/scene'
import { triangulatePolygon3 } from '../common/triangulate'
import { hexToRgb01, num, sanitizeFilename, textBlob } from '../common/util'
import {
  WarningList,
  backMaterialWarning,
  degenerateEdgesWarning,
  degenerateFacesWarning,
  edgesDisabledWarning,
  emptyExportWarning,
  flatLoss,
  objTexturesReferencedWarning,
  skippedInstancesWarning,
  texturesDisabledWarning,
  usedTextures,
} from '../common/warnings'
import { P, POINT_TOL } from '@/core/math'

const DEFAULT_MATERIAL = 'OpenSketch_Standard'

export function exportObj(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const scale = opts.unitScale ?? 1
  const base = sanitizeFilename(opts.filename ?? doc.meta.name)
  const flat = flattenDocument(doc, {
    unitScale: scale,
    onlyEntityIds: opts.selectionOnly ? opts.selectedEntityIds : undefined,
  })
  const materials = usedMaterials(doc, flat)
  const materialNames = buildMaterialNames(materials)

  const lines: string[] = []
  lines.push('# OpenSketch Studio - Wavefront OBJ')
  lines.push(`# Modell: ${doc.meta.name}`)
  lines.push(`# Achsen: X rechts, Y hinten, Z oben (Z-up)`)
  lines.push(`# Einheit: ${scale === 1 ? 'Meter' : `Meter x ${num(scale)}`}`)
  if (materials.length > 0) lines.push(`mtllib ${base}.mtl`)
  lines.push('')

  /* ---- Vertexpuffer, positionsbasiert verschmolzen ---- */
  const positions: Vec3Like[] = []
  const positionIndex = new Map<string, number>()
  const uvs: { x: number; y: number }[] = []
  const uvIndex = new Map<string, number>()
  const normals: Vec3Like[] = []
  const normalIndex = new Map<string, number>()

  const quant = (v: number): number => Math.round(v / POINT_TOL)
  const vIdx = (p: Vec3Like): number => {
    const key = `${quant(p.x)},${quant(p.y)},${quant(p.z)}`
    const found = positionIndex.get(key)
    if (found !== undefined) return found
    positions.push(p)
    const index = positions.length
    positionIndex.set(key, index)
    return index
  }
  const tIdx = (u: number, v: number): number => {
    const key = `${Math.round(u * 1e5)},${Math.round(v * 1e5)}`
    const found = uvIndex.get(key)
    if (found !== undefined) return found
    uvs.push({ x: u, y: v })
    const index = uvs.length
    uvIndex.set(key, index)
    return index
  }
  const nIdx = (n: Vec3Like): number => {
    const key = `${Math.round(n.x * 1e5)},${Math.round(n.y * 1e5)},${Math.round(n.z * 1e5)}`
    const found = normalIndex.get(key)
    if (found !== undefined) return found
    normals.push(n)
    const index = normals.length
    normalIndex.set(key, index)
    return index
  }

  /* ---- Flaechen nach Gruppe und Material sortieren ---- */
  interface FaceRecord {
    corners: { v: number; t: number; n: number }[][]
  }
  const groups = new Map<string, Map<string, FaceRecord[]>>()
  const groupOrder: string[] = []
  let writtenFaces = 0
  let degenerateFaces = 0

  for (const poly of flat.faces) {
    const groupName = objName(poly.groupName)
    let byMaterial = groups.get(groupName)
    if (!byMaterial) {
      byMaterial = new Map()
      groups.set(groupName, byMaterial)
      groupOrder.push(groupName)
    }
    const material = poly.frontMaterialId ? doc.materials[poly.frontMaterialId] : undefined
    const materialName = material ? materialNames.get(material.id) ?? DEFAULT_MATERIAL : DEFAULT_MATERIAL
    let list = byMaterial.get(materialName)
    if (!list) {
      list = []
      byMaterial.set(materialName, list)
    }
    const record = encodeFace(poly, material, opts.triangulate === true, vIdx, tIdx, nIdx, scale)
    if (record.corners.length > 0) {
      list.push(record)
      writtenFaces += record.corners.length
    } else {
      // Weder N-Gon noch Dreieck herausgekommen - die Flaeche ist entartet
      // und verschwand hier bisher wortlos.
      degenerateFaces++
    }
  }

  /* ---- Kanten ---- */
  // Muss VOR der Ausgabe der `v`-Zeilen laufen: eine Kante, die an keiner
  // Flaeche haengt (gezeichneter, noch nicht geschlossener Grundriss), bringt
  // ihre Endpunkte sonst in keinen Vertexpuffer - die Datei bliebe leer.
  const edgeLines: string[] = []
  if (opts.includeEdges) {
    const seen = new Set<string>()
    for (const edge of flat.edges) {
      if (edge.soft) continue
      const a = vIdx(edge.a)
      const b = vIdx(edge.b)
      if (a === b) continue
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(key)) continue
      seen.add(key)
      edgeLines.push(`l ${a} ${b}`)
    }
  }

  /* ---- Ausgabe ---- */
  for (const p of positions) lines.push(`v ${num(p.x)} ${num(p.y)} ${num(p.z)}`)
  lines.push('')
  for (const t of uvs) lines.push(`vt ${num(t.x)} ${num(t.y)}`)
  if (uvs.length > 0) lines.push('')
  for (const n of normals) lines.push(`vn ${num(n.x)} ${num(n.y)} ${num(n.z)}`)
  if (normals.length > 0) lines.push('')

  for (const groupName of groupOrder) {
    const byMaterial = groups.get(groupName)
    if (!byMaterial) continue
    lines.push(`g ${groupName}`)
    for (const [materialName, records] of byMaterial) {
      lines.push(`usemtl ${materialName}`)
      for (const record of records) {
        for (const corners of record.corners) {
          lines.push(`f ${corners.map((c) => `${c.v}/${c.t}/${c.n}`).join(' ')}`)
        }
      }
    }
    lines.push('')
  }

  if (edgeLines.length > 0) {
    lines.push('g OpenSketch_Kanten')
    lines.push(...edgeLines)
    lines.push('')
  }

  /* ---- Warnungen ---- */
  const warnings = new WarningList()
  const loss = flatLoss(flat)
  if (writtenFaces === 0 && edgeLines.length === 0) {
    warnings.add(
      emptyExportWarning(
        'OBJ',
        opts.selectionOnly === true,
        'Zeichne Geometrie oder schalte „Kanten mitexportieren“ ein, wenn nur Linien vorhanden sind.',
      ),
    )
  } else if (!opts.includeEdges) {
    // Mit `includeEdges` landen die Kanten als `l`-Zeilen in der Datei, ohne
    // sie verschwinden genau die, die an keiner Flaeche haengen.
    warnings.add(edgesDisabledWarning(loss.facelessEdges, 'OBJ'))
  }
  warnings.add(degenerateFacesWarning(degenerateFaces + flat.degenerateFaces))
  warnings.add(degenerateEdgesWarning(flat.degenerateEdges))
  const textureIds = usedTextures(doc, materials)
  warnings.add(
    opts.embedTextures === false
      ? texturesDisabledWarning(textureIds.length)
      : objTexturesReferencedWarning(textureIds.length),
  )
  warnings.add(backMaterialWarning(loss.backMaterialFaces, 'OBJ'))
  warnings.add(skippedInstancesWarning(flat.skipped))

  const objText = lines.join('\n')
  const result: ExportResult = {
    blob: textBlob(objText, 'model/obj'),
    filename: `${base}.obj`,
    warnings: warnings.list(),
  }
  if (materials.length > 0) {
    result.files = [
      {
        blob: textBlob(buildMtl(doc, materials, materialNames, opts), 'model/mtl'),
        filename: `${base}.mtl`,
      },
    ]
  }
  return result
}

/* ------------------------------------------------------------------ */
/* Flaechen                                                            */
/* ------------------------------------------------------------------ */

function encodeFace(
  poly: FacePolygon,
  material: Material | undefined,
  forceTriangulate: boolean,
  vIdx: (p: Vec3Like) => number,
  tIdx: (u: number, v: number) => number,
  nIdx: (n: Vec3Like) => number,
  scale: number,
): { corners: { v: number; t: number; n: number }[][] } {
  const normal = poly.normal
  const n = nIdx(normal)
  const frame = P.frame(P.fromNormalAndPoint(normal, poly.outer[0]), poly.outer[0])
  const tw = (material && material.textureWidth > 0 ? material.textureWidth : 1) * scale
  const th = (material && material.textureHeight > 0 ? material.textureHeight : 1) * scale
  const corner = (p: Vec3Like) => {
    const uv = frame.to2d(p)
    return { v: vIdx(p), t: tIdx(uv.x / tw, uv.y / th), n }
  }

  // OBJ kennt keine Loecher - gelochte Flaechen muessen trianguliert werden.
  const needsTriangles = forceTriangulate || poly.holes.length > 0
  if (!needsTriangles) {
    return { corners: [poly.outer.map(corner)] }
  }

  const all = [...poly.outer, ...poly.holes.flat()]
  const tris = triangulatePolygon3({ outer: poly.outer, holes: poly.holes, normal })
  const out: { v: number; t: number; n: number }[][] = []
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = all[tris[i]]
    const b = all[tris[i + 1]]
    const c = all[tris[i + 2]]
    if (a && b && c) out.push([corner(a), corner(b), corner(c)])
  }
  return { corners: out }
}

/* ------------------------------------------------------------------ */
/* Materialien                                                         */
/* ------------------------------------------------------------------ */

function buildMaterialNames(materials: Material[]): Map<string, string> {
  const used = new Set<string>([DEFAULT_MATERIAL])
  const out = new Map<string, string>()
  for (const material of materials) {
    let name = objName(material.name || 'Material')
    let suffix = 1
    while (used.has(name)) name = `${objName(material.name || 'Material')}_${++suffix}`
    used.add(name)
    out.set(material.id, name)
  }
  return out
}

function buildMtl(
  doc: SketchDocument,
  materials: Material[],
  names: Map<string, string>,
  opts: ExportOptions,
): string {
  const lines: string[] = ['# OpenSketch Studio - Materialbibliothek', '']
  lines.push(`newmtl ${DEFAULT_MATERIAL}`)
  lines.push('Ka 0 0 0')
  lines.push('Kd 0.85 0.83 0.78')
  lines.push('Ks 0.05 0.05 0.05')
  lines.push('Ns 24')
  lines.push('d 1')
  lines.push('illum 2')
  lines.push('')

  for (const material of materials) {
    const [r, g, b] = hexToRgb01(material.color)
    const shininess = Math.max(1, Math.round((1 - material.roughness) * 200))
    const spec = 0.04 + material.metalness * 0.5
    lines.push(`newmtl ${names.get(material.id) ?? objName(material.name)}`)
    lines.push('Ka 0 0 0')
    lines.push(`Kd ${num(r, 4)} ${num(g, 4)} ${num(b, 4)}`)
    lines.push(`Ks ${num(spec, 4)} ${num(spec, 4)} ${num(spec, 4)}`)
    lines.push(`Ns ${shininess}`)
    lines.push(`d ${num(material.opacity, 4)}`)
    if (material.opacity < 1) lines.push(`Tr ${num(1 - material.opacity, 4)}`)
    lines.push('illum 2')
    const texture = material.textureId ? doc.textures[material.textureId] : undefined
    if (texture && opts.embedTextures !== false) {
      // Texturen liegen als Data-URL im Dokument. OBJ hat kein Container-
      // format, deshalb steht der Dateiname hier und der Aufrufer speichert
      // die Textur ueber `ExportResult.files` daneben ab.
      lines.push(`map_Kd ${sanitizeFilename(texture.name || 'textur')}.png`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** OBJ-Bezeichner duerfen keine Leerzeichen enthalten. */
function objName(name: string): string {
  const cleaned = (name || '')
    .normalize('NFC')
    .replace(/[\s#/\\]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : 'Objekt'
}
