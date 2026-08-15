/**
 * STL-Import, binaer und ASCII (Format wird selbst erkannt).
 *
 * STL ist eine reine Dreieckssuppe. Damit daraus brauchbare Geometrie wird:
 *  1. Vertices werden ueber den `GeomBuilder` positionsbasiert verschmolzen,
 *  2. koplanare Nachbarflaechen werden zusammengefasst
 *     (`core.mergeCoplanarFaces`, sonst das IO-eigene Verfahren),
 *  3. kollineare Zwischenpunkte fliegen aus den Flaechenschleifen.
 *
 * Aus einem Wuerfel werden so wieder 6 Flaechen statt 12 Dreiecke.
 */

import type { Vec3Like } from '@/shared/types'
import type { ImportOptions, ImportResult } from '../api-types'
import { GeomBuilder } from '../common/geom'
import { baseName, utf8Text } from '../common/util'
import { ImportScene, mergeCoplanarSafely } from './common'
import { V } from '@/core/math'

export interface StlTriangleData {
  normal: Vec3Like
  a: Vec3Like
  b: Vec3Like
  c: Vec3Like
}

/** true, wenn der Puffer als binaeres STL gelesen werden muss. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  // Die Laengenformel ist das einzige verlaessliche Merkmal: auch binaere
  // Dateien beginnen manchmal mit "solid".
  if (84 + count * 50 === bytes.length) return true
  // Manche Werkzeuge haengen Muell an; dann entscheidet der Textanfang.
  const head = utf8Text(bytes.subarray(0, 512)).toLowerCase()
  return !(head.trimStart().startsWith('solid') && head.includes('facet'))
}

export async function importStl(
  bytes: Uint8Array,
  filename: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const scale = opts.unitScale ?? 1
  const scene = new ImportScene(opts.name ?? baseName(filename) ?? 'STL-Import')
  const binary = isBinaryStl(bytes)
  const triangles = binary ? readBinaryStl(bytes, scale) : readAsciiStl(utf8Text(bytes), scale)

  if (triangles.length === 0) {
    scene.warn('Die STL-Datei enthält keine Dreiecke.')
    return scene.toResult()
  }

  const body = scene.addDefinition(baseName(filename) || 'Körper', 'group')
  scene.addInstance(scene.root, body, undefined, body.name)
  const g = new GeomBuilder(body.geometry)

  let degenerate = 0
  for (const tri of triangles) {
    // Die Umlaufrichtung im Dreieck gewinnt; die Facettennormale dient nur
    // als Korrektiv, wenn sie ihr eindeutig widerspricht.
    const raw = V.cross(V.sub(tri.b, tri.a), V.sub(tri.c, tri.a))
    if (V.lengthSq(raw) < 1e-20) {
      degenerate++
      continue
    }
    const flip = V.lengthSq(tri.normal) > 1e-12 && V.dot(raw, tri.normal) < 0
    const face = flip ? g.face([tri.a, tri.c, tri.b]) : g.face([tri.a, tri.b, tri.c])
    if (!face) degenerate++
  }

  const before = Object.keys(body.geometry.faces).length
  await mergeCoplanarSafely(body.geometry, scene)
  const after = Object.keys(body.geometry.faces).length

  scene.warn(
    `${binary ? 'Binäres' : 'ASCII-'}STL gelesen: ${triangles.length} Dreiecke, zu ${after} Fläche(n) zusammengefasst.`,
  )
  if (after === before && before > 0) {
    scene.warn('Es konnten keine koplanaren Flächen zusammengefasst werden.')
  }
  if (degenerate > 0) scene.warn(`${degenerate} entartete Dreieck(e) wurden übersprungen.`)
  scene.warn('STL kennt keine Materialien - die Geometrie ist unbemalt.')

  return scene.toResult()
}

/* ------------------------------------------------------------------ */
/* Leser                                                               */
/* ------------------------------------------------------------------ */

export function readBinaryStl(bytes: Uint8Array, scale = 1): StlTriangleData[] {
  if (bytes.length < 84) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  const available = Math.floor((bytes.length - 84) / 50)
  const total = Math.min(count, available)
  const out: StlTriangleData[] = []
  let offset = 84
  const read = (o: number): Vec3Like => ({
    x: view.getFloat32(o, true) * scale,
    y: view.getFloat32(o + 4, true) * scale,
    z: view.getFloat32(o + 8, true) * scale,
  })
  for (let i = 0; i < total; i++) {
    const n = view.getFloat32(offset, true)
    const ny = view.getFloat32(offset + 4, true)
    const nz = view.getFloat32(offset + 8, true)
    out.push({
      normal: { x: n, y: ny, z: nz },
      a: read(offset + 12),
      b: read(offset + 24),
      c: read(offset + 36),
    })
    offset += 50
  }
  return out
}

export function readAsciiStl(text: string, scale = 1): StlTriangleData[] {
  const out: StlTriangleData[] = []
  let normal: Vec3Like = { x: 0, y: 0, z: 0 }
  let vertices: Vec3Like[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line.startsWith('facet normal')) {
      const p = line.slice(12).trim().split(/\s+/).map((v) => parseFloat(v))
      normal = { x: p[0] || 0, y: p[1] || 0, z: p[2] || 0 }
      vertices = []
    } else if (line.startsWith('vertex')) {
      const p = line.slice(6).trim().split(/\s+/).map((v) => parseFloat(v))
      vertices.push({ x: (p[0] || 0) * scale, y: (p[1] || 0) * scale, z: (p[2] || 0) * scale })
    } else if (line.startsWith('endfacet')) {
      if (vertices.length >= 3) {
        // Mehr als drei Vertices je Facette kommen vor - als Faecher zerlegen
        for (let i = 1; i + 1 < vertices.length; i++) {
          out.push({ normal, a: vertices[0], b: vertices[i], c: vertices[i + 1] })
        }
      }
      vertices = []
    }
  }
  return out
}
