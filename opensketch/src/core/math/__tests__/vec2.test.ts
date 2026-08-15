/**
 * QA-Tests fuer `@/core/math/vec2`.
 *
 * Schwerpunkt: Umlaufsinn (signedArea), Punkt-in-Polygon bei konkaven Formen,
 * Segmentschnitt.
 */

import { describe, expect, it } from 'vitest'
import * as V2 from '../vec2'

const close = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol

const SQUARE = [V2.v2(0, 0), V2.v2(1, 0), V2.v2(1, 1), V2.v2(0, 1)]

/** Konkaves L, gegen den Uhrzeigersinn, Flaeche 3. */
const L_SHAPE = [V2.v2(0, 0), V2.v2(2, 0), V2.v2(2, 1), V2.v2(1, 1), V2.v2(1, 2), V2.v2(0, 2)]

describe('vec2 - Grundlagen', () => {
  it('cross ist positiv, wenn b links von a liegt', () => {
    expect(V2.cross(V2.v2(1, 0), V2.v2(0, 1))).toBe(1)
    expect(V2.cross(V2.v2(0, 1), V2.v2(1, 0))).toBe(-1)
  })

  it('perp dreht 90 Grad gegen den Uhrzeigersinn', () => {
    // Hinweis: p.x ist hier -0 (Befund K-4), deshalb close() statt toBe(0).
    const p = V2.perp(V2.v2(1, 0))
    expect(close(p.x, 0)).toBe(true)
    expect(p.y).toBe(1)
    const q = V2.perp(V2.v2(0, 1))
    expect(q.x).toBe(-1)
    expect(close(q.y, 0)).toBe(true)
  })

  it('rotate dreht gegen den Uhrzeigersinn', () => {
    const r = V2.rotate(V2.v2(1, 0), Math.PI / 2)
    expect(close(r.x, 0)).toBe(true)
    expect(close(r.y, 1)).toBe(true)
  })

  it('angle liefert atan2', () => {
    expect(close(V2.angle(V2.v2(0, 1)), Math.PI / 2)).toBe(true)
    expect(close(V2.angle(V2.v2(-1, 0)), Math.PI)).toBe(true)
  })

  it('normalize eines Nullvektors liefert den Nullvektor', () => {
    expect(V2.normalize(V2.v2(0, 0))).toEqual({ x: 0, y: 0 })
  })
})

describe('vec2 - Polygone', () => {
  it('signedArea ist positiv fuer CCW und negativ fuer CW', () => {
    expect(close(V2.signedArea(SQUARE), 1)).toBe(true)
    expect(close(V2.signedArea([...SQUARE].reverse()), -1)).toBe(true)
    expect(V2.isCounterClockwise(SQUARE)).toBe(true)
    expect(V2.isCounterClockwise([...SQUARE].reverse())).toBe(false)
  })

  it('signedArea eines konkaven Polygons ist korrekt', () => {
    expect(close(V2.signedArea(L_SHAPE), 3)).toBe(true)
  })

  it('perimeter mit und ohne Schliessung', () => {
    expect(close(V2.perimeter(SQUARE), 4)).toBe(true)
    expect(close(V2.perimeter(SQUARE, false), 3)).toBe(true)
  })

  it('centroid eines Quadrats ist der Mittelpunkt', () => {
    const c = V2.centroid(SQUARE)
    expect(close(c.x, 0.5)).toBe(true)
    expect(close(c.y, 0.5)).toBe(true)
  })

  it('centroid faellt fuer entartete Polygone auf das arithmetische Mittel zurueck', () => {
    const c = V2.centroid([V2.v2(0, 0), V2.v2(2, 0), V2.v2(4, 0)])
    expect(close(c.x, 2)).toBe(true)
    expect(close(c.y, 0)).toBe(true)
  })

  it('pointInPolygon fuer ein konvexes Polygon', () => {
    expect(V2.pointInPolygon(V2.v2(0.5, 0.5), SQUARE)).toBe(true)
    expect(V2.pointInPolygon(V2.v2(1.5, 0.5), SQUARE)).toBe(false)
    expect(V2.pointInPolygon(V2.v2(-0.5, 0.5), SQUARE)).toBe(false)
  })

  it('pointInPolygon zaehlt Randpunkte als innen', () => {
    expect(V2.pointInPolygon(V2.v2(0, 0.5), SQUARE)).toBe(true)
    expect(V2.pointInPolygon(V2.v2(0, 0), SQUARE)).toBe(true)
  })

  it('pointInPolygon erkennt die Einbuchtung eines konkaven Polygons', () => {
    expect(V2.pointInPolygon(V2.v2(0.5, 0.5), L_SHAPE)).toBe(true)
    expect(V2.pointInPolygon(V2.v2(1.5, 0.5), L_SHAPE)).toBe(true)
    expect(V2.pointInPolygon(V2.v2(0.5, 1.5), L_SHAPE)).toBe(true)
    // im "fehlenden" Quadranten des L
    expect(V2.pointInPolygon(V2.v2(1.5, 1.5), L_SHAPE)).toBe(false)
  })

  it('pointInPolygon ist unabhaengig vom Umlaufsinn', () => {
    const cw = [...L_SHAPE].reverse()
    expect(V2.pointInPolygon(V2.v2(0.5, 0.5), cw)).toBe(true)
    expect(V2.pointInPolygon(V2.v2(1.5, 1.5), cw)).toBe(false)
  })

  it('isSimplePolygon erkennt Ueberschneidungen', () => {
    expect(V2.isSimplePolygon(SQUARE)).toBe(true)
    expect(V2.isSimplePolygon(L_SHAPE)).toBe(true)
    const bowtie = [V2.v2(0, 0), V2.v2(1, 1), V2.v2(1, 0), V2.v2(0, 1)]
    expect(V2.isSimplePolygon(bowtie)).toBe(false)
  })

  it('cleanPolygon entfernt Duplikate und den geschlossenen Endpunkt', () => {
    const raw = [V2.v2(0, 0), V2.v2(0, 0), V2.v2(1, 0), V2.v2(1, 1), V2.v2(0, 0)]
    const cleaned = V2.cleanPolygon(raw)
    expect(cleaned).toHaveLength(3)
    expect(cleaned[0]).toEqual({ x: 0, y: 0 })
    expect(cleaned[2]).toEqual({ x: 1, y: 1 })
  })
})

describe('vec2 - Segmente', () => {
  it('distanceToSegment klemmt an den Enden', () => {
    expect(close(V2.distanceToSegment(V2.v2(0.5, 2), V2.v2(0, 0), V2.v2(1, 0)), 2)).toBe(true)
    expect(close(V2.distanceToSegment(V2.v2(-3, 4), V2.v2(0, 0), V2.v2(1, 0)), 5)).toBe(true)
  })

  it('intersectSegments findet den Kreuzungspunkt mit Parametern', () => {
    const hit = V2.intersectSegments(V2.v2(-1, 0), V2.v2(1, 0), V2.v2(0, -1), V2.v2(0, 1))!
    expect(hit).not.toBeNull()
    expect(close(hit.point.x, 0)).toBe(true)
    expect(close(hit.point.y, 0)).toBe(true)
    expect(close(hit.ta, 0.5)).toBe(true)
    expect(close(hit.tb, 0.5)).toBe(true)
  })

  it('intersectSegments liefert null fuer parallele und nicht kreuzende Segmente', () => {
    expect(V2.intersectSegments(V2.v2(0, 0), V2.v2(1, 0), V2.v2(0, 1), V2.v2(1, 1))).toBeNull()
    expect(V2.intersectSegments(V2.v2(0, 0), V2.v2(1, 0), V2.v2(5, -1), V2.v2(5, 1))).toBeNull()
  })
})
