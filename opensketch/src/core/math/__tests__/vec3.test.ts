/**
 * QA-Tests fuer `@/core/math/vec3`.
 *
 * Schwerpunkt: Rechtshaendigkeit, Vorzeichen, Degeneriertheit.
 * Ein rot werdender Test hier ist ein echter Bug im Contract-Code.
 */

import { describe, expect, it } from 'vitest'
import * as V from '../vec3'
import * as M from '../mat4'
import { MIN_LENGTH, POINT_TOL } from '../constants'

const close = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol

function expectVec(actual: V3, expected: V3, tol = 1e-12): void {
  expect(close(actual.x, expected.x, tol), `x: ${actual.x} != ${expected.x}`).toBe(true)
  expect(close(actual.y, expected.y, tol), `y: ${actual.y} != ${expected.y}`).toBe(true)
  expect(close(actual.z, expected.z, tol), `z: ${actual.z} != ${expected.z}`).toBe(true)
}

type V3 = { x: number; y: number; z: number }

describe('vec3 - Grundrechenarten', () => {
  it('add/sub/mul/div/negate rechnen komponentenweise', () => {
    const a = V.v3(1, 2, 3)
    const b = V.v3(4, 5, 6)
    expectVec(V.add(a, b), V.v3(5, 7, 9))
    expectVec(V.sub(b, a), V.v3(3, 3, 3))
    expectVec(V.mul(a, 2), V.v3(2, 4, 6))
    expectVec(V.div(a, 2), V.v3(0.5, 1, 1.5))
    expectVec(V.negate(a), V.v3(-1, -2, -3))
    expectVec(V.mulVec(a, b), V.v3(4, 10, 18))
  })

  it('div durch 0 liefert den Nullvektor statt Infinity', () => {
    expectVec(V.div(V.v3(1, 2, 3), 0), V.v3())
  })

  it('addScaled entspricht a + b*s', () => {
    expectVec(V.addScaled(V.v3(1, 1, 1), V.AXIS_Z, 5), V.v3(1, 1, 6))
  })

  it('dot und length', () => {
    expect(V.dot(V.v3(1, 2, 3), V.v3(4, -5, 6))).toBe(12)
    expect(V.length(V.v3(3, 4, 0))).toBe(5)
    expect(V.lengthSq(V.v3(3, 4, 0))).toBe(25)
    expect(V.distance(V.v3(1, 0, 0), V.v3(4, 4, 0))).toBe(5)
  })
})

describe('vec3 - Rechtshaendigkeit (ARCHITECTURE Abschnitt 2)', () => {
  it('cross(X, Y) === +Z', () => {
    expectVec(V.cross(V.AXIS_X, V.AXIS_Y), V.AXIS_Z)
  })

  it('cross(Y, Z) === +X und cross(Z, X) === +Y', () => {
    expectVec(V.cross(V.AXIS_Y, V.AXIS_Z), V.AXIS_X)
    expectVec(V.cross(V.AXIS_Z, V.AXIS_X), V.AXIS_Y)
  })

  it('cross ist antikommutativ', () => {
    const a = V.v3(0.3, -1.2, 2)
    const b = V.v3(4, 0.5, -0.25)
    expectVec(V.cross(a, b), V.negate(V.cross(b, a)))
  })

  it('rotateAround dreht +X in 90 Grad um +Z nach +Y (Rechte-Hand-Regel)', () => {
    expectVec(V.rotateAround(V.AXIS_X, V.AXIS_Z, Math.PI / 2), V.AXIS_Y, 1e-15)
  })

  it('rotateAround dreht +Y in 90 Grad um +X nach +Z', () => {
    expectVec(V.rotateAround(V.AXIS_Y, V.AXIS_X, Math.PI / 2), V.AXIS_Z, 1e-15)
  })

  it('rotateAround erhaelt die Laenge und ist um 2pi periodisch', () => {
    const a = V.v3(1, 2, -3)
    const r = V.rotateAround(a, V.normalize(V.v3(1, 1, 1)), 0.7)
    expect(close(V.length(r), V.length(a), 1e-12)).toBe(true)
    expectVec(V.rotateAround(a, V.AXIS_Z, Math.PI * 2), a, 1e-12)
  })

  it('rotateAboutLine dreht um eine verschobene Achse', () => {
    const p = V.v3(2, 0, 0)
    const res = V.rotateAboutLine(p, V.v3(1, 0, 0), V.AXIS_Z, Math.PI)
    expectVec(res, V.v3(0, 0, 0), 1e-12)
  })

  it('signedAngle ist positiv im Rechtssinn und negativ im Gegensinn', () => {
    expect(close(V.signedAngle(V.AXIS_X, V.AXIS_Y, V.AXIS_Z), Math.PI / 2)).toBe(true)
    expect(close(V.signedAngle(V.AXIS_Y, V.AXIS_X, V.AXIS_Z), -Math.PI / 2)).toBe(true)
  })

  it('angleBetween liegt in [0, pi]', () => {
    expect(close(V.angleBetween(V.AXIS_X, V.AXIS_X), 0)).toBe(true)
    expect(close(V.angleBetween(V.AXIS_X, V.negate(V.AXIS_X)), Math.PI, 1e-7)).toBe(true)
    expect(close(V.angleBetween(V.AXIS_X, V.AXIS_Y), Math.PI / 2)).toBe(true)
  })
})

describe('vec3 - Normalisierung und Degeneriertheit', () => {
  it('normalize liefert Einheitslaenge', () => {
    expect(close(V.length(V.normalize(V.v3(3, 4, 12))), 1)).toBe(true)
  })

  it('normalize eines Nullvektors liefert den Nullvektor (kein NaN)', () => {
    expectVec(V.normalize(V.v3()), V.v3())
    expect(V.isFinite3(V.normalize(V.v3()))).toBe(true)
  })

  it('normalizeOr faellt auf den Fallback zurueck', () => {
    expectVec(V.normalizeOr(V.v3(0, 0, 0), V.AXIS_Y), V.AXIS_Y)
  })

  it('isZero respektiert MIN_LENGTH', () => {
    expect(V.isZero(V.v3(MIN_LENGTH / 2, 0, 0))).toBe(true)
    expect(V.isZero(V.v3(MIN_LENGTH * 10, 0, 0))).toBe(false)
  })

  it('anyPerpendicular steht auf allen Achsen und schraegen Richtungen senkrecht', () => {
    const dirs = [
      V.AXIS_X,
      V.AXIS_Y,
      V.AXIS_Z,
      V.negate(V.AXIS_X),
      V.v3(1, 1, 1),
      V.v3(0.001, 0, 1),
      V.v3(-3, 7, 0.5),
    ]
    for (const d of dirs) {
      const p = V.anyPerpendicular(d)
      expect(close(V.length(p), 1, 1e-12), `Laenge fuer ${JSON.stringify(d)}`).toBe(true)
      expect(close(V.dot(p, V.normalize(d)), 0, 1e-12), `Senkrecht fuer ${JSON.stringify(d)}`).toBe(true)
    }
  })
})

describe('vec3 - Projektionen', () => {
  it('projectOnVector projiziert auf eine Richtung', () => {
    expectVec(V.projectOnVector(V.v3(3, 4, 0), V.AXIS_X), V.v3(3, 0, 0))
  })

  it('projectOnPlaneNormal entfernt den Normalenanteil', () => {
    const res = V.projectOnPlaneNormal(V.v3(3, 4, 5), V.AXIS_Z)
    expectVec(res, V.v3(3, 4, 0))
  })

  it('reflect spiegelt an einer Ebene mit gegebener Normalen', () => {
    expectVec(V.reflect(V.v3(1, 0, -1), V.AXIS_Z), V.v3(1, 0, 1))
  })

  it('isParallel / isPerpendicular fuer eindeutige Faelle', () => {
    expect(V.isParallel(V.AXIS_X, V.mul(V.AXIS_X, -7))).toBe(true)
    expect(V.isParallel(V.AXIS_X, V.AXIS_Y)).toBe(false)
    expect(V.isPerpendicular(V.AXIS_X, V.AXIS_Y)).toBe(true)
    expect(V.isPerpendicular(V.AXIS_X, V.v3(1, 1, 0))).toBe(false)
  })
})

describe('vec3 - Matrixanwendung', () => {
  it('applyMat4 beruecksichtigt die Translation, applyMat4Direction nicht', () => {
    const m = M.translation(V.v3(10, 20, 30))
    expectVec(V.applyMat4(V.v3(1, 2, 3), m), V.v3(11, 22, 33))
    expectVec(V.applyMat4Direction(V.v3(1, 2, 3), m), V.v3(1, 2, 3))
  })

  it('applyMat4 mit einer Rotationsmatrix stimmt mit rotateAround ueberein', () => {
    const axis = V.normalize(V.v3(1, 2, 3))
    const angle = 0.83
    const p = V.v3(-2, 5, 1)
    expectVec(V.applyMat4(p, M.rotation(axis, angle)), V.rotateAround(p, axis, angle), 1e-12)
  })
})

describe('vec3 - Hilfsfunktionen', () => {
  it('centroid mittelt, leere Liste gibt den Ursprung', () => {
    expectVec(V.centroid([V.v3(0, 0, 0), V.v3(2, 0, 0), V.v3(0, 3, 0)]), V.v3(2 / 3, 1, 0))
    expectVec(V.centroid([]), V.v3())
  })

  it('dominantAxis findet die groesste Komponente', () => {
    expect(V.dominantAxis(V.v3(-5, 1, 2))).toBe(0)
    expect(V.dominantAxis(V.v3(1, -5, 2))).toBe(1)
    expect(V.dominantAxis(V.v3(1, 2, -5))).toBe(2)
  })

  it('equals arbeitet mit POINT_TOL', () => {
    expect(V.equals(V.v3(0, 0, 0), V.v3(POINT_TOL / 2, 0, 0))).toBe(true)
    expect(V.equals(V.v3(0, 0, 0), V.v3(POINT_TOL * 10, 0, 0))).toBe(false)
  })

  it('round und key stabilisieren die Serialisierung', () => {
    expectVec(V.round(V.v3(1.23456789012, 0, 0), 3), V.v3(1.235, 0, 0), 1e-15)
    expect(V.key(V.v3(0, 0, 0))).toBe(V.key(V.v3(POINT_TOL / 10, 0, 0)))
  })

  it('toArray / fromArray sind invers', () => {
    const a = V.v3(1, -2, 3)
    expectVec(V.fromArray(V.toArray(a)), a)
    expectVec(V.fromArray([9, 9, 1, -2, 3], 2), a)
  })
})

/* ------------------------------------------------------------------ */
/* Bekannte Schwaechen - siehe QA-REVIEW.md                            */
/* ------------------------------------------------------------------ */

describe('vec3 - dokumentierte Schwaechen', () => {
  it('BEFUND W-6: key() kann Punkte innerhalb POINT_TOL auf verschiedene Buckets legen', () => {
    // Beide Punkte liegen 2e-9 m auseinander, also weit unter POINT_TOL (1e-5),
    // fallen aber auf verschiedene Seiten der Rundungsgrenze.
    const a = V.v3(0.499999e-5, 0, 0)
    const b = V.v3(0.500001e-5, 0, 0)
    expect(V.equals(a, b)).toBe(true) // dieselben Punkte laut Toleranz ...
    expect(V.key(a)).not.toBe(V.key(b)) // ... aber verschiedene Hash-Keys
  })

  it('BEFUND K-3: isParallel/isPerpendicular melden true fuer den Nullvektor', () => {
    expect(V.isParallel(V.v3(), V.AXIS_X)).toBe(true)
    expect(V.isPerpendicular(V.v3(), V.AXIS_X)).toBe(true)
  })
})
