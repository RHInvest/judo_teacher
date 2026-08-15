/**
 * QA-Tests fuer `@/core/math/bbox`.
 *
 * Schwerpunkt: Semantik der leeren Box, `transform` unter Drehung und
 * Skalierung, Reihenfolge der Ecken.
 */

import { describe, expect, it } from 'vitest'
import * as B from '../bbox'
import * as V from '../vec3'
import * as M from '../mat4'

type V3 = { x: number; y: number; z: number }

const close = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol

function expectVec(actual: V3, expected: V3, tol = 1e-12): void {
  expect(close(actual.x, expected.x, tol), `x: ${actual.x} != ${expected.x}`).toBe(true)
  expect(close(actual.y, expected.y, tol), `y: ${actual.y} != ${expected.y}`).toBe(true)
  expect(close(actual.z, expected.z, tol), `z: ${actual.z} != ${expected.z}`).toBe(true)
}

const UNIT: { min: V3; max: V3 } = { min: V.v3(0, 0, 0), max: V.v3(1, 1, 1) }

describe('bbox - leere Box', () => {
  it('empty() ist leer, hat min > max und neutrale Kennzahlen', () => {
    const e = B.empty()
    expect(B.isEmpty(e)).toBe(true)
    expect(B.volume(e)).toBe(0)
    expect(B.diagonal(e)).toBe(0)
    expectVec(B.size(e), V.v3())
    expectVec(B.center(e), V.v3())
    expect(B.distanceToPoint(e, V.ORIGIN)).toBe(Infinity)
  })

  it('union mit einer leeren Box ist neutral', () => {
    expect(B.isEmpty(B.union(B.empty(), B.empty()))).toBe(true)
    const a = B.union(B.empty(), UNIT)
    expectVec(a.min, UNIT.min)
    expectVec(a.max, UNIT.max)
    const b = B.union(UNIT, B.empty())
    expectVec(b.min, UNIT.min)
    expectVec(b.max, UNIT.max)
  })

  it('fromPoints([]) ist leer, transform einer leeren Box bleibt leer', () => {
    expect(B.isEmpty(B.fromPoints([]))).toBe(true)
    expect(B.isEmpty(B.transform(B.empty(), M.translation(V.v3(1, 2, 3))))).toBe(true)
    expect(B.isEmpty(B.expandByScalar(B.empty(), 5))).toBe(true)
  })
})

describe('bbox - Aufbau und Kennzahlen', () => {
  it('fromPoints umschliesst alle Punkte', () => {
    const box = B.fromPoints([V.v3(1, -2, 3), V.v3(-4, 5, 0), V.v3(0, 0, 9)])
    expectVec(box.min, V.v3(-4, -2, 0))
    expectVec(box.max, V.v3(1, 5, 9))
  })

  it('fromCenterSize zentriert korrekt', () => {
    const box = B.fromCenterSize(V.v3(1, 1, 1), V.v3(2, 4, 6))
    expectVec(box.min, V.v3(0, -1, -2))
    expectVec(box.max, V.v3(2, 3, 4))
  })

  it('center / size / volume / diagonal', () => {
    const box = { min: V.v3(0, 0, 0), max: V.v3(2, 4, 4) }
    expectVec(B.center(box), V.v3(1, 2, 2))
    expectVec(B.size(box), V.v3(2, 4, 4))
    expect(B.volume(box)).toBe(32)
    expect(close(B.diagonal(box), 6)).toBe(true)
  })

  it('expandByPoint ist die unveraenderliche Variante von expandByPointMut', () => {
    const grown = B.expandByPoint(UNIT, V.v3(5, -5, 0.5))
    expectVec(grown.min, V.v3(0, -5, 0))
    expectVec(grown.max, V.v3(5, 1, 1))
    // Original unveraendert
    expectVec(UNIT.min, V.v3(0, 0, 0))
    expectVec(UNIT.max, V.v3(1, 1, 1))
  })

  it('expandByScalar waechst in alle Richtungen', () => {
    const g = B.expandByScalar(UNIT, 0.5)
    expectVec(g.min, V.v3(-0.5, -0.5, -0.5))
    expectVec(g.max, V.v3(1.5, 1.5, 1.5))
  })
})

describe('bbox - Enthaltensein und Ueberschneidung', () => {
  it('containsPoint inklusive Rand', () => {
    expect(B.containsPoint(UNIT, V.v3(0.5, 0.5, 0.5))).toBe(true)
    expect(B.containsPoint(UNIT, V.v3(0, 0, 0))).toBe(true)
    expect(B.containsPoint(UNIT, V.v3(1, 1, 1))).toBe(true)
    expect(B.containsPoint(UNIT, V.v3(1.001, 0.5, 0.5))).toBe(false)
    expect(B.containsPoint(UNIT, V.v3(1.001, 0.5, 0.5), 0.01)).toBe(true)
  })

  it('containsBox', () => {
    expect(B.containsBox(UNIT, { min: V.v3(0.2, 0.2, 0.2), max: V.v3(0.8, 0.8, 0.8) })).toBe(true)
    expect(B.containsBox(UNIT, { min: V.v3(-0.2, 0.2, 0.2), max: V.v3(0.8, 0.8, 0.8) })).toBe(false)
  })

  it('intersects erkennt Beruehrung und Trennung', () => {
    expect(B.intersects(UNIT, { min: V.v3(0.5, 0.5, 0.5), max: V.v3(2, 2, 2) })).toBe(true)
    expect(B.intersects(UNIT, { min: V.v3(1, 0, 0), max: V.v3(2, 1, 1) })).toBe(true) // Beruehrung
    expect(B.intersects(UNIT, { min: V.v3(1.5, 0, 0), max: V.v3(2, 1, 1) })).toBe(false)
    expect(B.intersects(UNIT, { min: V.v3(1.5, 0, 0), max: V.v3(2, 1, 1) }, 1)).toBe(true)
  })

  it('distanceToPoint ist 0 innerhalb und misst sonst zur Oberflaeche', () => {
    expect(B.distanceToPoint(UNIT, V.v3(0.5, 0.5, 0.5))).toBe(0)
    expect(close(B.distanceToPoint(UNIT, V.v3(4, 0.5, 0.5)), 3)).toBe(true)
    expect(close(B.distanceToPoint(UNIT, V.v3(-3, -4, 0.5)), 5)).toBe(true)
  })
})

describe('bbox - Ecken und Kanten', () => {
  it('corners liefert 8 verschiedene Ecken in der dokumentierten Reihenfolge', () => {
    const c = B.corners(UNIT)
    expect(c).toHaveLength(8)
    expectVec(c[0], V.v3(0, 0, 0))
    expectVec(c[1], V.v3(1, 0, 0))
    expectVec(c[2], V.v3(0, 1, 0))
    expectVec(c[4], V.v3(0, 0, 1))
    expectVec(c[7], V.v3(1, 1, 1))
    expect(new Set(c.map((p) => `${p.x},${p.y},${p.z}`)).size).toBe(8)
  })

  it('edgeSegments liefert 12 Kanten, jede mit Laenge einer Boxkante', () => {
    const box = { min: V.v3(0, 0, 0), max: V.v3(2, 3, 4) }
    const segs = B.edgeSegments(box)
    expect(segs).toHaveLength(12)
    const lengths = segs.map(([a, b]) => V.distance(a, b)).sort((x, y) => x - y)
    expect(lengths.filter((l) => close(l, 2)).length).toBe(4)
    expect(lengths.filter((l) => close(l, 3)).length).toBe(4)
    expect(lengths.filter((l) => close(l, 4)).length).toBe(4)
  })

  it('jede Ecke hat in edgeSegments genau drei Nachbarn', () => {
    const segs = B.edgeSegments(UNIT)
    const count = new Map<string, number>()
    for (const [a, b] of segs) {
      for (const p of [a, b]) {
        const k = `${p.x},${p.y},${p.z}`
        count.set(k, (count.get(k) ?? 0) + 1)
      }
    }
    expect(count.size).toBe(8)
    for (const [k, n] of count) expect(n, `Ecke ${k}`).toBe(3)
  })
})

describe('bbox - transform', () => {
  it('Translation verschiebt die Box exakt', () => {
    const t = B.transform(UNIT, M.translation(V.v3(10, -5, 2)))
    expectVec(t.min, V.v3(10, -5, 2))
    expectVec(t.max, V.v3(11, -4, 3))
  })

  it('Drehung um 90 Grad um +Z bildet die Box wieder achsparallel ab', () => {
    const t = B.transform(UNIT, M.rotation(V.AXIS_Z, Math.PI / 2))
    expectVec(t.min, V.v3(-1, 0, 0), 1e-12)
    expectVec(t.max, V.v3(0, 1, 1), 1e-12)
    expect(close(B.volume(t), 1, 1e-12)).toBe(true)
  })

  it('Drehung um 45 Grad vergroessert die achsparallele Huelle', () => {
    const t = B.transform(UNIT, M.rotation(V.AXIS_Z, Math.PI / 4))
    const s = B.size(t)
    expect(close(s.x, Math.SQRT2, 1e-12)).toBe(true)
    expect(close(s.y, Math.SQRT2, 1e-12)).toBe(true)
    expect(close(s.z, 1, 1e-12)).toBe(true)
  })

  it('Skalierung wirkt auf die Box', () => {
    const t = B.transform(UNIT, M.scaling(V.v3(2, 3, 4)))
    expectVec(t.min, V.v3(0, 0, 0))
    expectVec(t.max, V.v3(2, 3, 4))
  })

  it('transform umschliesst alle transformierten Ecken (allgemeine Matrix)', () => {
    const m = M.chain(
      M.translation(V.v3(1, -2, 0.5)),
      M.rotation(V.normalize(V.v3(1, 2, 3)), 0.9),
      M.scaling(V.v3(2, 0.5, 1.5)),
    )
    const box = { min: V.v3(-1, -2, -3), max: V.v3(4, 5, 6) }
    const t = B.transform(box, m)
    for (const c of B.corners(box)) {
      expect(B.containsPoint(t, M.transformPoint(m, c), 1e-9)).toBe(true)
    }
  })

  it('transform ist kompatibel mit fromPoints der transformierten Ecken', () => {
    const m = M.rotation(V.normalize(V.v3(0.3, 1, -2)), 1.4)
    const box = { min: V.v3(0, 0, 0), max: V.v3(3, 1, 2) }
    const a = B.transform(box, m)
    const b = B.fromPoints(B.corners(box).map((c) => M.transformPoint(m, c)))
    expectVec(a.min, b.min, 1e-12)
    expectVec(a.max, b.max, 1e-12)
  })
})
