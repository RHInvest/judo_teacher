/**
 * Wavefront-OBJ-Import (+ MTL, sofern der Aufrufer die Datei mitliefert).
 *
 * Eigenschaften:
 *  - `v`, `vt`, `vn`, `f` mit `v`, `v/vt`, `v//vn` und `v/vt/vn`
 *  - negative (relative) Indizes
 *  - `g` und `o` erzeugen je eine eigene Definition, die als Instanz unter
 *    der Wurzel haengt
 *  - `usemtl` setzt das Flaechenmaterial, `mtllib` wird - wenn vorhanden -
 *    aus `ImportOptions.companions` gelesen
 *  - **N-Gons bleiben N-Gons**; nur nicht-planare Polygone werden zerlegt
 */

import type { Definition, Id, Material, Vec3Like } from '@/shared/types'
import type { ImportOptions, ImportResult } from '../api-types'
import { GeomBuilder } from '../common/geom'
import { baseName, parseCssColor, rgbToHex, utf8Text } from '../common/util'
import { ImportScene, makeMaterial } from './common'
import { P, PLANAR_TOL } from '@/core/math'

interface ObjFaceCorner {
  v: number
  t: number
  n: number
}

export function importObj(bytes: Uint8Array, filename: string, opts: ImportOptions = {}): ImportResult {
  return parseObj(utf8Text(bytes), filename, opts)
}

export function parseObj(text: string, filename: string, opts: ImportOptions = {}): ImportResult {
  const scale = opts.unitScale ?? 1
  const scene = new ImportScene(opts.name ?? baseName(filename) ?? 'OBJ-Import')

  const positions: Vec3Like[] = []
  const uvs: { x: number; y: number }[] = []
  const normals: Vec3Like[] = []

  const materialsByName = new Map<string, Material>()
  let currentMaterial: Material | null = null

  let group: Definition | null = null
  let builder: GeomBuilder | null = null
  let groupName = ''
  let faceCount = 0
  let skippedFaces = 0

  const beginGroup = (name: string): void => {
    if (group && Object.keys(group.geometry.faces).length === 0 && Object.keys(group.geometry.edges).length === 0) {
      // leere Gruppe wiederverwenden statt eine Leiche zu hinterlassen
      group.name = name || group.name
      groupName = name
      return
    }
    group = scene.addDefinition(name || `Gruppe ${scene.definitions.length}`, 'group')
    scene.addInstance(scene.root, group, undefined, group.name)
    builder = new GeomBuilder(group.geometry)
    groupName = name
  }
  const ensureGroup = (): GeomBuilder => {
    if (!builder) beginGroup(groupName || 'Geometrie')
    // beginGroup setzt builder immer
    return builder as GeomBuilder
  }

  const resolve = (raw: number, length: number): number => (raw < 0 ? length + raw : raw - 1)

  const lines = text.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const space = line.indexOf(' ')
    const keyword = space < 0 ? line : line.slice(0, space)
    const rest = space < 0 ? '' : line.slice(space + 1).trim()

    switch (keyword) {
      case 'v': {
        const p = rest.split(/\s+/)
        positions.push({
          x: (parseFloat(p[0]) || 0) * scale,
          y: (parseFloat(p[1]) || 0) * scale,
          z: (parseFloat(p[2]) || 0) * scale,
        })
        break
      }
      case 'vt': {
        const p = rest.split(/\s+/)
        uvs.push({ x: parseFloat(p[0]) || 0, y: parseFloat(p[1]) || 0 })
        break
      }
      case 'vn': {
        const p = rest.split(/\s+/)
        normals.push({ x: parseFloat(p[0]) || 0, y: parseFloat(p[1]) || 0, z: parseFloat(p[2]) || 0 })
        break
      }
      case 'g':
      case 'o':
        beginGroup(rest)
        break
      case 'usemtl': {
        const name = rest || 'Material'
        let material = materialsByName.get(name)
        if (!material) {
          material = makeMaterial(name, '#cccccc', 'Import')
          materialsByName.set(name, material)
          scene.addMaterial(material)
        }
        currentMaterial = material
        break
      }
      case 'mtllib': {
        const applied = applyMtl(rest, opts, materialsByName, scene)
        if (!applied) scene.warn(`Materialdatei "${rest}" wurde nicht mitgeladen - Ersatzfarben werden benutzt.`)
        break
      }
      case 'f': {
        const corners = parseFaceCorners(rest, positions.length, uvs.length, normals.length, resolve)
        if (corners.length < 3) {
          skippedFaces++
          break
        }
        const points = corners.map((c) => positions[c.v]).filter((p): p is Vec3Like => !!p)
        if (points.length < 3) {
          skippedFaces++
          break
        }
        const g = ensureGroup()
        const created = addPolygon(g, points, currentMaterial?.id ?? null)
        faceCount += created
        if (created === 0) skippedFaces++
        break
      }
      case 'l': {
        const indices = rest
          .split(/\s+/)
          .map((token) => resolve(parseInt(token.split('/')[0], 10), positions.length))
        const g = ensureGroup()
        for (let i = 0; i + 1 < indices.length; i++) {
          const a = positions[indices[i]]
          const b = positions[indices[i + 1]]
          if (a && b) g.edgePoints(a, b, { materialId: currentMaterial?.id ?? null })
        }
        break
      }
      case 'p':
      case 's':
      case 'mtllib_':
        break
      default:
        break
    }
  }

  if (positions.length === 0) scene.warn('Die Datei enthält keine Vertices.')
  if (faceCount === 0 && positions.length > 0) scene.warn('Es wurden keine Flächen gefunden - nur Punkte und Kanten.')
  if (skippedFaces > 0) scene.warn(`${skippedFaces} entartete Fläche(n) wurden übersprungen.`)
  if (normals.length > 0) {
    // Normalen werden aus der Umlaufrichtung neu berechnet; explizite
    // Vertexnormalen kennt das Datenmodell nicht.
    scene.warn('Vertexnormalen aus der Datei wurden ignoriert - Normalen kommen aus der Flächenumlaufrichtung.')
  }

  return scene.toResult()
}

/* ------------------------------------------------------------------ */
/* Flaechen                                                            */
/* ------------------------------------------------------------------ */

function parseFaceCorners(
  rest: string,
  vCount: number,
  tCount: number,
  nCount: number,
  resolve: (raw: number, length: number) => number,
): ObjFaceCorner[] {
  const out: ObjFaceCorner[] = []
  for (const token of rest.split(/\s+/)) {
    if (token.length === 0) continue
    const parts = token.split('/')
    const v = parseInt(parts[0], 10)
    if (!Number.isFinite(v)) continue
    const t = parts.length > 1 && parts[1].length > 0 ? parseInt(parts[1], 10) : NaN
    const n = parts.length > 2 && parts[2].length > 0 ? parseInt(parts[2], 10) : NaN
    out.push({
      v: resolve(v, vCount),
      t: Number.isFinite(t) ? resolve(t, tCount) : -1,
      n: Number.isFinite(n) ? resolve(n, nCount) : -1,
    })
  }
  return out
}

/**
 * Erzeugt eine Flaeche aus einem Polygon. Planare N-Gons bleiben erhalten,
 * nicht-planare werden in ein Dreiecksfaecher zerlegt - alles andere waere
 * geometrisch nicht darstellbar.
 */
function addPolygon(g: GeomBuilder, points: Vec3Like[], materialId: Id | null): number {
  if (points.length === 3) return g.face(points, [], { materialId }) ? 1 : 0
  const plane = P.fromPolygon(points)
  if (plane && points.every((p) => P.containsPoint(plane, p, PLANAR_TOL * 20))) {
    return g.face(points, [], { materialId }) ? 1 : 0
  }
  let created = 0
  for (let i = 1; i + 1 < points.length; i++) {
    if (g.face([points[0], points[i], points[i + 1]], [], { materialId })) created++
  }
  return created
}

/* ------------------------------------------------------------------ */
/* MTL                                                                 */
/* ------------------------------------------------------------------ */

function applyMtl(
  reference: string,
  opts: ImportOptions,
  materialsByName: Map<string, Material>,
  scene: ImportScene,
): boolean {
  const companions = opts.companions
  if (!companions) return false
  const key = Object.keys(companions).find(
    (name) => name === reference || baseName(name) === baseName(reference),
  )
  if (!key) return false
  for (const material of parseMtl(utf8Text(companions[key]))) {
    const existing = materialsByName.get(material.name)
    if (existing) {
      Object.assign(existing, material, { id: existing.id })
    } else {
      materialsByName.set(material.name, material)
      scene.addMaterial(material)
    }
  }
  return true
}

/** Liest eine MTL-Datei; Texturverweise werden als Warnung gemeldet. */
export function parseMtl(text: string): Material[] {
  const out: Material[] = []
  let current: Material | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const space = line.indexOf(' ')
    const keyword = space < 0 ? line : line.slice(0, space)
    const rest = space < 0 ? '' : line.slice(space + 1).trim()
    switch (keyword) {
      case 'newmtl':
        current = makeMaterial(rest || 'Material', '#cccccc', 'Import')
        out.push(current)
        break
      case 'Kd': {
        if (!current) break
        const [r, g, b] = rest.split(/\s+/).map((v) => parseFloat(v))
        if (Number.isFinite(r)) {
          current.color = rgbToHex((r || 0) * 255, (g ?? r) * 255, (b ?? r) * 255)
        }
        break
      }
      case 'Ns': {
        if (!current) break
        const ns = parseFloat(rest)
        if (Number.isFinite(ns)) current.roughness = Math.max(0, Math.min(1, 1 - ns / 200))
        break
      }
      case 'Ks': {
        if (!current) break
        const [r] = rest.split(/\s+/).map((v) => parseFloat(v))
        if (Number.isFinite(r)) current.metalness = Math.max(0, Math.min(1, (r - 0.04) / 0.5))
        break
      }
      case 'd': {
        if (!current) break
        const d = parseFloat(rest)
        if (Number.isFinite(d)) current.opacity = Math.max(0, Math.min(1, d))
        break
      }
      case 'Tr': {
        if (!current) break
        const tr = parseFloat(rest)
        if (Number.isFinite(tr)) current.opacity = Math.max(0, Math.min(1, 1 - tr))
        break
      }
      case 'Ka':
      case 'illum':
        break
      default:
        break
    }
  }
  // Farben koennen auch als '#rrggbb' notiert sein (nicht Standard, kommt vor)
  for (const material of out) material.color = parseCssColor(material.color) ?? '#cccccc'
  return out
}
