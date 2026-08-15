/**
 * Kantenextraktion und -klassifikation.
 */

import { describe, expect, it } from 'vitest'
import type { Edge, Geometry, Id, SketchDocument, StyleSettings } from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { classifyEdge, edgeColors, extractEdges } from '../edges'
import { DEFAULT_STYLE } from '../defaults'
import { documentWithSquare, emptyDocument, squareGeometry } from './helpers'

function edge(patch: Partial<Edge> = {}): Edge {
  return {
    id: 'e1',
    a: 'v1',
    b: 'v2',
    faces: [],
    soft: false,
    smooth: false,
    hidden: false,
    tagId: null,
    materialId: null,
    ...patch,
  }
}

/** Zwei Punkte plus eine Kante dazwischen, ohne Kernel. */
function twoPointGeometry(patch: Partial<Edge> = {}): Geometry {
  const geom = emptyGeometry()
  geom.vertices.v1 = { id: 'v1', p: { x: 0, y: 0, z: 0 }, edges: ['e1'] }
  geom.vertices.v2 = { id: 'v2', p: { x: 1, y: 0, z: 0 }, edges: ['e1'] }
  geom.edges.e1 = edge(patch)
  return geom
}

const options = { isTagVisible: () => true, showHiddenGeometry: false, collectEndpoints: true }

describe('classifyEdge', () => {
  it('erkennt Konstruktionskanten zuerst', () => {
    expect(classifyEdge(edge({ guide: true, faces: ['f1', 'f2'] }))).toBe('guide')
  })

  it('erkennt weiche und versteckte Kanten', () => {
    expect(classifyEdge(edge({ soft: true, faces: ['f1', 'f2'] }))).toBe('hidden')
    expect(classifyEdge(edge({ hidden: true, faces: ['f1', 'f2'] }))).toBe('hidden')
  })

  it('nennt Kanten mit weniger als zwei Nachbarflaechen Profillinien', () => {
    expect(classifyEdge(edge({ faces: [] }))).toBe('profile')
    expect(classifyEdge(edge({ faces: ['f1'] }))).toBe('profile')
    expect(classifyEdge(edge({ faces: ['f1', 'f2'] }))).toBe('normal')
  })
})

describe('extractEdges', () => {
  it('legt die vier Kanten eines Quadrats als Profillinien ab', () => {
    const geom = squareGeometry(2)
    const result = extractEdges(geom, options)
    expect(result.total).toBe(4)
    expect(result.buckets.profile.segments).toBe(4)
    expect(result.buckets.normal.segments).toBe(0)
    // 6 Werte je Segment
    expect(result.buckets.profile.positions.length).toBe(4 * 6)
    // vier eindeutige Endpunkte
    expect(result.endpointCount).toBe(4)
  })

  it('blendet weiche Kanten aus, bis versteckte Geometrie angezeigt wird', () => {
    const geom = twoPointGeometry({ soft: true })
    expect(extractEdges(geom, options).total).toBe(0)
    const visible = extractEdges(geom, { ...options, showHiddenGeometry: true })
    expect(visible.total).toBe(1)
    expect(visible.buckets.hidden.segments).toBe(1)
  })

  it('respektiert die Tag-Sichtbarkeit', () => {
    const geom = twoPointGeometry({ tagId: 'tagA' })
    const result = extractEdges(geom, { ...options, isTagVisible: (id: Id | null) => id !== 'tagA' })
    expect(result.total).toBe(0)
  })

  it('sammelt Endpunkte nur auf Wunsch', () => {
    const geom = squareGeometry(2)
    const result = extractEdges(geom, { ...options, collectEndpoints: false })
    expect(result.endpointCount).toBe(0)
    expect(result.total).toBe(4)
  })

  it('ueberspringt Kanten mit fehlenden Vertices', () => {
    const geom = twoPointGeometry()
    delete geom.vertices.v2
    expect(extractEdges(geom, options).total).toBe(0)
  })

  it('schreibt die Positionen in der Reihenfolge Start/Ende', () => {
    const geom = twoPointGeometry()
    const bucket = extractEdges(geom, options).buckets.profile
    expect(Array.from(bucket.positions)).toEqual([0, 0, 0, 1, 0, 0])
    expect(bucket.edgeIds).toEqual(['e1'])
  })
})

describe('edgeColors', () => {
  const style: StyleSettings = { ...DEFAULT_STYLE }

  it('liefert null bei einheitlicher Kantenfarbe', () => {
    const bucket = extractEdges(squareGeometry(), options).buckets.profile
    expect(edgeColors(bucket, style, null)).toBeNull()
  })

  it('faerbt nach Material', () => {
    const doc: SketchDocument = documentWithSquare()
    doc.materials.matRed = {
      id: 'matRed',
      name: 'Rot',
      color: '#ff0000',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 1,
      metalness: 0,
      category: '',
      colorize: false,
    }
    const geom = twoPointGeometry({ materialId: 'matRed' })
    const bucket = extractEdges(geom, options).buckets.profile
    const colors = edgeColors(bucket, { ...style, edgeColorMode: 'byMaterial' }, doc)
    expect(colors).not.toBeNull()
    const rgb = colors as Float32Array
    expect(rgb.length).toBe(6)
    expect(rgb[0]).toBeGreaterThan(0.9)
    expect(rgb[1]).toBeLessThan(0.1)
    // Start- und Endfarbe sind gleich
    expect(rgb[3]).toBeCloseTo(rgb[0], 6)
  })

  it('faerbt nach Tag', () => {
    const doc = emptyDocument()
    doc.tags.tagA = { id: 'tagA', name: 'A', visible: true, color: '#0000ff', dashes: 'solid', folderId: null, locked: false }
    const geom = twoPointGeometry({ tagId: 'tagA' })
    const bucket = extractEdges(geom, options).buckets.profile
    const colors = edgeColors(bucket, { ...style, edgeColorMode: 'byTag' }, doc) as Float32Array
    expect(colors[2]).toBeGreaterThan(0.9)
    expect(colors[0]).toBeLessThan(0.1)
  })
})
