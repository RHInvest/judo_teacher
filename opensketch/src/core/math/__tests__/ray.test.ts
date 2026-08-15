/**
 * QA-Tests fuer `@/core/math/ray`.
 *
 * Schwerpunkt: Moeller-Trumbore (Vorder-/Rueckseite, baryzentrische
 * Koordinaten), Segmentabstaende, Slab-Test.
 */

import { describe, expect, it } from 'vitest'
import * as R from '../ray'
import * as V from '../vec3'
import * as B from '../bbox'

type V3 = { x: number; y: number; z: number }

const close = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol

function expectVec(actual: V3, expected: V3, tol = 1e-12): void {
  expect(close(actual.x, expected.x, tol), `x: ${actual.x} != ${expected.x}`).toBe(true)
  expect(close(actual.y, expected.y, tol), `y: ${actual.y} != ${expected.y}`).toBe(true)
  expect(close(actual.z, expected.z, tol), `z: ${actual.z} != ${expected.z}`).toBe(true)
}

/** Dreieck in der XY-Ebene, CCW von +Z gesehen -> Vorderseite zeigt nach +Z. */
const TA = V.v3(0, 0, 0)
const TB = V.v3(1, 0, 0)
const TC = V.v3(0, 1, 0)

describe('ray - Konstruktion', () => {
  it('ray() normalisiert die Richtung', () => {
    const r = R.ray(V.ORIGIN, V.v3(0, 0, 7))
    expectVec(r.dir, V.AXIS_Z)
  })

  it('at(r, t) laeuft die Strahlparameter ab', () => {
    const r = R.ray(V.v3(1, 1, 1), V.AXIS_X)
    expectVec(R.at(r, 3), V.v3(4, 1, 1))
    expectVec(R.at(r, 0), V.v3(1, 1, 1))
  })
})

describe('ray - intersectTriangle (Moeller-Trumbore)', () => {
  it('trifft die Mitte, t ist der echte Abstand', () => {
    const r = R.ray(V.v3(0.25, 0.25, 5), V.negate(V.AXIS_Z))
    const hit = R.intersectTriangle(r, TA, TB, TC)
    expect(hit).not.toBeNull()
    expect(close(hit!.t, 5, 1e-12)).toBe(true)
    expectVec(hit!.point, V.v3(0.25, 0.25, 0), 1e-12)
  })

  it('liefert baryzentrische Koordinaten u (Richtung b) und v (Richtung c)', () => {
    const r = R.ray(V.v3(0.6, 0.2, 1), V.negate(V.AXIS_Z))
    const hit = R.intersectTriangle(r, TA, TB, TC)!
    expect(close(hit.u, 0.6, 1e-12)).toBe(true)
    expect(close(hit.v, 0.2, 1e-12)).toBe(true)
    // Rekonstruktion des Punktes aus den Baryzentren
    const rebuilt = V.add(TA, V.add(V.mul(V.sub(TB, TA), hit.u), V.mul(V.sub(TC, TA), hit.v)))
    expectVec(rebuilt, hit.point, 1e-12)
  })

  it('trifft die Eckpunkte mit u/v 0 bzw. 1', () => {
    const hitA = R.intersectTriangle(R.ray(V.v3(0, 0, 1), V.negate(V.AXIS_Z)), TA, TB, TC)!
    expect(close(hitA.u, 0, 1e-12)).toBe(true)
    expect(close(hitA.v, 0, 1e-12)).toBe(true)
    const hitB = R.intersectTriangle(R.ray(V.v3(1, 0, 1), V.negate(V.AXIS_Z)), TA, TB, TC)!
    expect(close(hitB.u, 1, 1e-12)).toBe(true)
  })

  it('verfehlt ausserhalb des Dreiecks', () => {
    expect(R.intersectTriangle(R.ray(V.v3(0.9, 0.9, 1), V.negate(V.AXIS_Z)), TA, TB, TC)).toBeNull()
    expect(R.intersectTriangle(R.ray(V.v3(-0.1, 0.5, 1), V.negate(V.AXIS_Z)), TA, TB, TC)).toBeNull()
    expect(R.intersectTriangle(R.ray(V.v3(0.5, -0.1, 1), V.negate(V.AXIS_Z)), TA, TB, TC)).toBeNull()
  })

  it('ignoriert Treffer hinter dem Strahlursprung', () => {
    const r = R.ray(V.v3(0.25, 0.25, 5), V.AXIS_Z)
    expect(R.intersectTriangle(r, TA, TB, TC)).toBeNull()
  })

  it('liefert null bei parallelem Strahl (Dreieck von der Kante)', () => {
    const r = R.ray(V.v3(-5, 0.25, 0), V.AXIS_X)
    expect(R.intersectTriangle(r, TA, TB, TC)).toBeNull()
  })

  it('trifft ohne Culling auch von hinten', () => {
    const r = R.ray(V.v3(0.25, 0.25, -5), V.AXIS_Z)
    expect(R.intersectTriangle(r, TA, TB, TC, false)).not.toBeNull()
  })

  it('backfaceCulling=true blendet die Rueckseite aus, nicht die Vorderseite', () => {
    const fromFront = R.ray(V.v3(0.25, 0.25, 5), V.negate(V.AXIS_Z))
    const fromBack = R.ray(V.v3(0.25, 0.25, -5), V.AXIS_Z)
    expect(R.intersectTriangle(fromFront, TA, TB, TC, true)).not.toBeNull()
    expect(R.intersectTriangle(fromBack, TA, TB, TC, true)).toBeNull()
  })

  it('funktioniert fuer beliebig orientierte Dreiecke', () => {
    const a = V.v3(2, -1, 3)
    const b = V.v3(5, 0.5, 3.5)
    const c = V.v3(2.5, 4, -1)
    const target = V.add(a, V.add(V.mul(V.sub(b, a), 0.3), V.mul(V.sub(c, a), 0.4)))
    const origin = V.v3(-20, -20, -20)
    const r = R.ray(origin, V.sub(target, origin))
    const hit = R.intersectTriangle(r, a, b, c)!
    expect(hit).not.toBeNull()
    expectVec(hit.point, target, 1e-9)
    expect(close(hit.u, 0.3, 1e-9)).toBe(true)
    expect(close(hit.v, 0.4, 1e-9)).toBe(true)
    expect(close(hit.t, V.distance(origin, target), 1e-9)).toBe(true)
  })
})

describe('ray - Punkte und Segmente', () => {
  it('closestPointOnLine laesst t ausserhalb [0,1] zu', () => {
    const res = R.closestPointOnLine(V.v3(0, 0, 0), V.v3(1, 0, 0), V.v3(3, 2, 0))
    expect(close(res.t, 3)).toBe(true)
    expectVec(res.point, V.v3(3, 0, 0))
  })

  it('closestPointOnSegment klemmt t auf [0,1]', () => {
    const a = V.v3(0, 0, 0)
    const b = V.v3(1, 0, 0)
    const before = R.closestPointOnSegment(a, b, V.v3(-3, 2, 0))
    expect(before.t).toBe(0)
    expectVec(before.point, a)
    const after = R.closestPointOnSegment(a, b, V.v3(3, 2, 0))
    expect(after.t).toBe(1)
    expectVec(after.point, b)
    const inside = R.closestPointOnSegment(a, b, V.v3(0.4, 9, 0))
    expect(close(inside.t, 0.4)).toBe(true)
    expectVec(inside.point, V.v3(0.4, 0, 0))
  })

  it('closestPointOnSegment ist robust fuer entartete Segmente', () => {
    const res = R.closestPointOnSegment(V.v3(1, 1, 1), V.v3(1, 1, 1), V.v3(5, 5, 5))
    expectVec(res.point, V.v3(1, 1, 1))
  })

  it('distanceToSegment misst den Lotabstand', () => {
    expect(close(R.distanceToSegment(V.v3(0, 0, 0), V.v3(10, 0, 0), V.v3(5, 3, 4)), 5)).toBe(true)
    expect(close(R.distanceToSegment(V.v3(0, 0, 0), V.v3(10, 0, 0), V.v3(-3, 4, 0)), 5)).toBe(true)
  })

  it('closestPointsBetweenLines findet die gemeinsame Lotstrecke', () => {
    // X-Achse bei z=0, Y-Achse bei z=2
    const res = R.closestPointsBetweenLines(V.ORIGIN, V.AXIS_X, V.v3(0, 0, 2), V.AXIS_Y)!
    expect(res).not.toBeNull()
    expectVec(res.point1, V.ORIGIN, 1e-12)
    expectVec(res.point2, V.v3(0, 0, 2), 1e-12)
    expect(close(V.distance(res.point1, res.point2), 2, 1e-12)).toBe(true)
  })

  it('closestPointsBetweenLines liefert null fuer parallele Geraden', () => {
    expect(R.closestPointsBetweenLines(V.ORIGIN, V.AXIS_X, V.v3(0, 1, 0), V.AXIS_X)).toBeNull()
  })

  it('intersectSegments findet den echten Kreuzungspunkt', () => {
    const hit = R.intersectSegments(V.v3(-1, 0, 0), V.v3(1, 0, 0), V.v3(0, -1, 0), V.v3(0, 1, 0), 1e-9)!
    expect(hit).not.toBeNull()
    expectVec(hit.point, V.ORIGIN, 1e-12)
    expect(close(hit.ta, 0.5, 1e-12)).toBe(true)
    expect(close(hit.tb, 0.5, 1e-12)).toBe(true)
  })

  it('intersectSegments lehnt windschiefe und zu kurze Segmente ab', () => {
    // windschief mit Abstand 1 > tol
    expect(R.intersectSegments(V.v3(-1, 0, 0), V.v3(1, 0, 0), V.v3(0, -1, 1), V.v3(0, 1, 1), 1e-6)).toBeNull()
    // Kreuzung liegt ausserhalb beider Segmente
    expect(R.intersectSegments(V.v3(2, 0, 0), V.v3(3, 0, 0), V.v3(0, -1, 0), V.v3(0, 1, 0), 1e-6)).toBeNull()
    // entartetes Segment
    expect(R.intersectSegments(V.ORIGIN, V.ORIGIN, V.v3(0, -1, 0), V.v3(0, 1, 0), 1e-6)).toBeNull()
  })

  it('rayToSegment misst den Abstand Strahl <-> Kante', () => {
    const r = R.ray(V.ORIGIN, V.AXIS_X)
    const res = R.rayToSegment(r, V.v3(5, 2, 0), V.v3(5, 2, 4))
    expect(close(res.distance, 2, 1e-12)).toBe(true)
    expectVec(res.pointOnSegment, V.v3(5, 2, 0), 1e-12)
    expect(close(res.rayT, 5, 1e-12)).toBe(true)
  })

  it('rayToSegment klemmt auf die Segmentenden', () => {
    const r = R.ray(V.ORIGIN, V.AXIS_X)
    // Segment quer zum Strahl, aber komplett hinter dessen Lotfusspunkt
    const res = R.rayToSegment(r, V.v3(5, 1, 0), V.v3(5, 4, 0))
    expect(res.t).toBe(0)
    expectVec(res.pointOnSegment, V.v3(5, 1, 0), 1e-12)
    expect(close(res.distance, 1, 1e-12)).toBe(true)
  })

  it('intersectCapsule trifft dicke Kanten innerhalb des Radius', () => {
    const r = R.ray(V.ORIGIN, V.AXIS_X)
    expect(R.intersectCapsule(r, V.v3(5, 0.05, 0), V.v3(5, 0.05, 3), 0.1)).not.toBeNull()
    expect(R.intersectCapsule(r, V.v3(5, 0.5, 0), V.v3(5, 0.5, 3), 0.1)).toBeNull()
  })

  /* ---------------------------------------------------------------- */
  /* BLOCKER B-2 - siehe QA-REVIEW.md                                  */
  /* ---------------------------------------------------------------- */

  it('B-2 (behoben): rayToSegment misst bei parallelen Kanten den Lotabstand zur Strahlgeraden', () => {
    const r = R.ray(V.ORIGIN, V.AXIS_X)
    // Kante parallel zum Strahl, echter Lotabstand ist 1 m.
    // Frueher wurde ab dem Strahlursprung gemessen -> sqrt(5^2+1^2) = 5,099.
    const res = R.rayToSegment(r, V.v3(5, 0, 1), V.v3(9, 0, 1))
    expect(close(res.distance, 1, 1e-9)).toBe(true)
    expect(res.rayT).toBeGreaterThan(0)
  })

  it('B-2 (behoben): intersectCapsule trifft eine zum Strahl parallele Kante', () => {
    const r = R.ray(V.ORIGIN, V.AXIS_X)
    // Kante liegt 0,05 m neben dem Strahl, Radius ist 0,1 m -> muss treffen
    expect(R.intersectCapsule(r, V.v3(5, 0, 0.05), V.v3(9, 0, 0.05), 0.1)).not.toBeNull()
    // Gegenprobe: 0,2 m daneben bei Radius 0,1 m -> darf nicht treffen
    expect(R.intersectCapsule(r, V.v3(5, 0, 0.2), V.v3(9, 0, 0.2), 0.1)).toBeNull()
  })

  it('B-2: eine Kante hinter dem Strahlursprung wird ab dem Ursprung gemessen', () => {
    const r = R.ray(V.ORIGIN, V.AXIS_X)
    const res = R.rayToSegment(r, V.v3(-9, 0, 1), V.v3(-5, 0, 1))
    // Der Strahl ist eine Halbgerade: naechster Punkt ist der Ursprung selbst
    expect(res.rayT).toBe(0)
    expect(close(res.distance, Math.hypot(5, 1), 1e-9)).toBe(true)
  })
})

describe('ray - Volumenkoerper', () => {
  const box: { min: V3; max: V3 } = { min: V.v3(-1, -1, -1), max: V.v3(1, 1, 1) }

  it('intersectBox liefert Ein- und Austrittsparameter', () => {
    const res = R.intersectBox(R.ray(V.v3(-5, 0, 0), V.AXIS_X), box)!
    expect(res).not.toBeNull()
    expect(close(res.tMin, 4, 1e-12)).toBe(true)
    expect(close(res.tMax, 6, 1e-12)).toBe(true)
  })

  it('intersectBox verfehlt neben der Box', () => {
    expect(R.intersectBox(R.ray(V.v3(-5, 5, 0), V.AXIS_X), box)).toBeNull()
  })

  it('intersectBox: Strahl komplett hinter der Box liefert null', () => {
    expect(R.intersectBox(R.ray(V.v3(5, 0, 0), V.AXIS_X), box)).toBeNull()
  })

  it('intersectBox: Ursprung in der Box ergibt negatives tMin', () => {
    const res = R.intersectBox(R.ray(V.ORIGIN, V.AXIS_X), box)!
    expect(res.tMin < 0).toBe(true)
    expect(close(res.tMax, 1, 1e-12)).toBe(true)
  })

  it('intersectBox behandelt achsparallele Strahlen ohne Division durch 0', () => {
    // Richtung ohne X-Anteil, Ursprung innerhalb des X-Slabs
    expect(R.intersectBox(R.ray(V.v3(0, -5, 0), V.AXIS_Y), box)).not.toBeNull()
    // Ursprung ausserhalb des X-Slabs -> kein Treffer
    expect(R.intersectBox(R.ray(V.v3(9, -5, 0), V.AXIS_Y), box)).toBeNull()
  })

  it('intersectBox stimmt mit B.containsPoint am Eintrittspunkt ueberein', () => {
    const r = R.ray(V.v3(-4, -0.5, 0.25), V.AXIS_X)
    const res = R.intersectBox(r, box)!
    expect(B.containsPoint(box, R.at(r, res.tMin), 1e-9)).toBe(true)
    expect(B.containsPoint(box, R.at(r, res.tMax), 1e-9)).toBe(true)
  })

  it('intersectSphere liefert den naeheren, nicht negativen Treffer', () => {
    const r = R.ray(V.v3(-5, 0, 0), V.AXIS_X)
    expect(close(R.intersectSphere(r, V.ORIGIN, 1)!, 4, 1e-12)).toBe(true)
    // Ursprung innerhalb der Kugel -> Austrittspunkt
    expect(close(R.intersectSphere(R.ray(V.ORIGIN, V.AXIS_X), V.ORIGIN, 2)!, 2, 1e-12)).toBe(true)
    // Kugel hinter dem Strahl
    expect(R.intersectSphere(R.ray(V.v3(5, 0, 0), V.AXIS_X), V.ORIGIN, 1)).toBeNull()
    // vorbei
    expect(R.intersectSphere(R.ray(V.v3(-5, 5, 0), V.AXIS_X), V.ORIGIN, 1)).toBeNull()
  })
})
