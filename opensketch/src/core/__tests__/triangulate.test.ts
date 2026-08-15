/**
 * Ohren-Clipping und Flaechen-Tesselierung.
 */

import { describe, expect, it } from 'vitest'
import { addFacePolygon, addPolyline, faceArea, triangulateFace, triangulatePolygon2D } from '@/core'
import { invalidateFaceCache } from '@/core/query'
import { V2 } from '@/core/math'
import { expectValid, faceIds, geom, p, rect } from './helpers'

interface Pt {
  x: number
  y: number
}

function polygonArea2D(points: readonly Pt[]): number {
  return Math.abs(V2.signedArea(points))
}

/** Gesamtflaeche aller Dreiecke einer Triangulierung. */
function triangleArea(pts: readonly Pt[], tris: readonly number[]): number {
  let sum = 0
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = pts[tris[i]]
    const b = pts[tris[i + 1]]
    const c = pts[tris[i + 2]]
    sum += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
  }
  return sum
}

describe('triangulatePolygon2D', () => {
  it('trianguliert ein Quadrat zu zwei Dreiecken', () => {
    const square: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    const tris = triangulatePolygon2D(square)
    expect(tris.length).toBe(6)
    expect(triangleArea(square, tris)).toBeCloseTo(1, 9)
  })

  it('trianguliert ein konkaves L-Polygon vollstaendig', () => {
    const shape: Pt[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ]
    const tris = triangulatePolygon2D(shape)
    expect(tris.length).toBe((shape.length - 2) * 3)
    expect(triangleArea(shape, tris)).toBeCloseTo(polygonArea2D(shape), 9)
  })

  it('trianguliert einen stark konkaven Stern', () => {
    const star: Pt[] = []
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const r = i % 2 === 0 ? 1 : 0.4
      star.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
    const tris = triangulatePolygon2D(star)
    expect(tris.length).toBe((star.length - 2) * 3)
    expect(triangleArea(star, tris)).toBeCloseTo(polygonArea2D(star), 9)
  })

  it('bindet ein Loch ueber eine Bruecke ein', () => {
    const outer: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const hole: Pt[] = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ]
    const tris = triangulatePolygon2D(outer, [hole])
    const all = [...outer, ...hole]
    expect(tris.length).toBeGreaterThan(0)
    expect(triangleArea(all, tris)).toBeCloseTo(100 - 16, 6)
  })

  it('bindet zwei Loecher ein', () => {
    const outer: Pt[] = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 6 },
      { x: 0, y: 6 },
    ]
    const h1: Pt[] = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ]
    const h2: Pt[] = [
      { x: 8, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 4 },
      { x: 8, y: 4 },
    ]
    const tris = triangulatePolygon2D(outer, [h1, h2])
    const all = [...outer, ...h1, ...h2]
    expect(triangleArea(all, tris)).toBeCloseTo(72 - 4 - 4, 6)
  })

  it('vertraegt kollineare Punkte', () => {
    const shape: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ]
    const tris = triangulatePolygon2D(shape)
    expect(triangleArea(shape, tris)).toBeCloseTo(4, 9)
  })

  it('liefert nichts fuer entartete Eingaben', () => {
    expect(triangulatePolygon2D([])).toEqual([])
    expect(triangulatePolygon2D([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([])
  })

  it('behaelt den Umlaufsinn der Aussenschleife', () => {
    const cw: Pt[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]
    const tris = triangulatePolygon2D(cw)
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const a = cw[tris[i]]
      const b = cw[tris[i + 1]]
      const c = cw[tris[i + 2]]
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      expect(area).toBeLessThan(0)
    }
  })
})

describe('triangulateFace', () => {
  it('tesseliert eine einfache Flaeche', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const mesh = triangulateFace(g, faceIds(g)[0])

    expect(mesh.positions.length).toBe(4 * 3)
    expect(mesh.indices.length).toBe(6)
    expect(mesh.normals.length).toBe(4 * 3)
    // Normale zeigt nach +Z
    expect(Math.abs(mesh.normals[2])).toBeCloseTo(1, 9)
  })

  it('spart das Loch aus', () => {
    const g = geom()
    addFacePolygon(g, rect(10, 10), [[p(3, 3), p(7, 3), p(7, 7), p(3, 7)]])
    const id = faceIds(g)[0]
    const mesh = triangulateFace(g, id)

    let area = 0
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const at = (k: number): Pt => ({
        x: mesh.positions[mesh.indices[i + k] * 3],
        y: mesh.positions[mesh.indices[i + k] * 3 + 1],
      })
      const a = at(0)
      const b = at(1)
      const c = at(2)
      area += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
    }
    expect(area).toBeCloseTo(faceArea(g, id), 6)
    expectValid(g, 'Loch tesseliert')
  })

  it('liefert nach Cache-Invalidierung dasselbe Ergebnis', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)
    const id = faceIds(g)[0]
    const first = triangulateFace(g, id)
    invalidateFaceCache(id)
    const second = triangulateFace(g, id)
    expect([...second.indices]).toEqual([...first.indices])
  })
})
