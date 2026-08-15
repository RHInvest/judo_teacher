/**
 * QA-Tests fuer `@/core/math/mat4`.
 *
 * Schwerpunkt: Spalten-Major-Layout, Multiplikationsreihenfolge,
 * Rechtshaendigkeit der Rotation, Korrektheit von `invert`.
 */

import { describe, expect, it } from 'vitest'
import * as M from '../mat4'
import * as V from '../vec3'

type V3 = { x: number; y: number; z: number }

const close = (a: number, b: number, tol = 1e-10) => Math.abs(a - b) <= tol

function expectVec(actual: V3, expected: V3, tol = 1e-10): void {
  expect(close(actual.x, expected.x, tol), `x: ${actual.x} != ${expected.x}`).toBe(true)
  expect(close(actual.y, expected.y, tol), `y: ${actual.y} != ${expected.y}`).toBe(true)
  expect(close(actual.z, expected.z, tol), `z: ${actual.z} != ${expected.z}`).toBe(true)
}

const allFinite = (m: readonly number[]) => Array.from(m).every((v) => Number.isFinite(v))

/** Eine beliebige, gut konditionierte affine Matrix. */
const A = M.chain(
  M.translation(V.v3(3, -1, 7)),
  M.rotation(V.normalize(V.v3(1, 2, 3)), 0.61),
  M.scaling(V.v3(2, 0.5, 1.75)),
)

const B = M.chain(
  M.translation(V.v3(-4, 8, 0.5)),
  M.rotation(V.normalize(V.v3(-2, 1, 0.5)), -1.2),
  M.scaling(V.v3(0.25, 3, 1)),
)

describe('mat4 - Layout und Grundbausteine', () => {
  it('IDENTITY und identity() stimmen ueberein und sind neutral', () => {
    expect(M.isIdentity(M.IDENTITY)).toBe(true)
    expect(M.isIdentity(M.identity())).toBe(true)
    expect(M.equals(M.multiply(A, M.identity()), A)).toBe(true)
    expect(M.equals(M.multiply(M.identity(), A), A)).toBe(true)
  })

  it('translation legt die Verschiebung in m[12..14] (Spalten-Major wie THREE.Matrix4)', () => {
    const t = M.translation(V.v3(1, 2, 3))
    expect(t[12]).toBe(1)
    expect(t[13]).toBe(2)
    expect(t[14]).toBe(3)
    expect(t[15]).toBe(1)
  })

  it('scaling legt die Faktoren auf die Diagonale', () => {
    const s = M.scaling(V.v3(2, 3, 4))
    expect(s[0]).toBe(2)
    expect(s[5]).toBe(3)
    expect(s[10]).toBe(4)
  })

  it('fromBasis speichert die Achsen spaltenweise', () => {
    const m = M.fromBasis(V.v3(9, 9, 9), V.AXIS_Y, V.AXIS_Z, V.AXIS_X)
    expectVec(M.getAxis(m, 0), V.AXIS_Y)
    expectVec(M.getAxis(m, 1), V.AXIS_Z)
    expectVec(M.getAxis(m, 2), V.AXIS_X)
    expectVec(M.getTranslation(m), V.v3(9, 9, 9))
  })
})

describe('mat4 - Multiplikationsreihenfolge', () => {
  it('multiply(a, b) wendet erst b und dann a an', () => {
    const t = M.translation(V.v3(10, 0, 0))
    const r = M.rotation(V.AXIS_Z, Math.PI / 2)
    const p = V.v3(1, 0, 0)
    // erst drehen (-> (0,1,0)), dann verschieben (-> (10,1,0))
    expectVec(M.transformPoint(M.multiply(t, r), p), V.v3(10, 1, 0))
    // umgekehrt: erst verschieben (-> (11,0,0)), dann drehen (-> (0,11,0))
    expectVec(M.transformPoint(M.multiply(r, t), p), V.v3(0, 11, 0))
  })

  it('Multiplikation ist assoziativ', () => {
    const C = M.rotation(V.AXIS_X, 0.4)
    expect(M.equals(M.multiply(M.multiply(A, B), C), M.multiply(A, M.multiply(B, C)), 1e-9)).toBe(true)
  })

  it('chain(a,b,c) === a*b*c', () => {
    const C = M.rotation(V.AXIS_X, 0.4)
    expect(M.equals(M.chain(A, B, C), M.multiply(M.multiply(A, B), C), 1e-9)).toBe(true)
    expect(M.isIdentity(M.chain(), 1e-15)).toBe(true)
  })

  it('transpose ist selbstinvers und dreht multiply um', () => {
    expect(M.equals(M.transpose(M.transpose(A)), A)).toBe(true)
    expect(M.equals(M.transpose(M.multiply(A, B)), M.multiply(M.transpose(B), M.transpose(A)), 1e-9)).toBe(true)
  })
})

describe('mat4 - Rotation ist rechtshaendig', () => {
  it('rotation(+Z, 90 Grad) bildet +X auf +Y ab', () => {
    expectVec(M.transformPoint(M.rotation(V.AXIS_Z, Math.PI / 2), V.AXIS_X), V.AXIS_Y)
  })

  it('rotation(+X, 90 Grad) bildet +Y auf +Z ab', () => {
    expectVec(M.transformPoint(M.rotation(V.AXIS_X, Math.PI / 2), V.AXIS_Y), V.AXIS_Z)
  })

  it('rotation(+Y, 90 Grad) bildet +Z auf +X ab', () => {
    expectVec(M.transformPoint(M.rotation(V.AXIS_Y, Math.PI / 2), V.AXIS_Z), V.AXIS_X)
  })

  it('rotation stimmt mit V.rotateAround fuer beliebige Achsen ueberein', () => {
    const axis = V.normalize(V.v3(-1, 4, 2))
    for (const angle of [0.1, 1, 2.5, -0.8, Math.PI]) {
      const m = M.rotation(axis, angle)
      for (const p of [V.v3(1, 0, 0), V.v3(0, 3, -2), V.v3(5, 5, 5)]) {
        expectVec(M.transformPoint(m, p), V.rotateAround(p, axis, angle), 1e-12)
      }
    }
  })

  it('rotation ist orthogonal mit Determinante +1 (kein Spiegeln)', () => {
    const m = M.rotation(V.normalize(V.v3(1, -2, 0.5)), 1.3)
    expect(close(M.determinant(m), 1, 1e-12)).toBe(true)
    expect(M.isMirrored(m)).toBe(false)
    expect(M.equals(M.multiply(m, M.transpose(m)), M.identity(), 1e-12)).toBe(true)
  })

  it('rotation normalisiert die Achse selbst', () => {
    const a = M.rotation(V.v3(0, 0, 5), 0.7)
    const b = M.rotation(V.AXIS_Z, 0.7)
    expect(M.equals(a, b, 1e-14)).toBe(true)
  })

  it('rotationAboutLine dreht um eine verschobene Achse', () => {
    const m = M.rotationAboutLine(V.v3(1, 0, 0), V.AXIS_Z, Math.PI)
    expectVec(M.transformPoint(m, V.v3(2, 0, 0)), V.v3(0, 0, 0))
    expectVec(M.transformPoint(m, V.v3(1, 0, 5)), V.v3(1, 0, 5))
  })

  it('scalingAbout skaliert um einen Fixpunkt', () => {
    const m = M.scalingAbout(V.v3(1, 1, 1), 2)
    expectVec(M.transformPoint(m, V.v3(1, 1, 1)), V.v3(1, 1, 1))
    expectVec(M.transformPoint(m, V.v3(2, 1, 1)), V.v3(3, 1, 1))
  })
})

describe('mat4 - invert', () => {
  it('m * invert(m) === Identitaet', () => {
    for (const m of [A, B, M.multiply(A, B), M.rotation(V.AXIS_Y, 2.1), M.translation(V.v3(5, 5, 5))]) {
      expect(M.isIdentity(M.multiply(m, M.invert(m)), 1e-9)).toBe(true)
      expect(M.isIdentity(M.multiply(M.invert(m), m), 1e-9)).toBe(true)
    }
  })

  it('invert(multiply(a, b)) === multiply(invert(b), invert(a))', () => {
    const lhs = M.invert(M.multiply(A, B))
    const rhs = M.multiply(M.invert(B), M.invert(A))
    expect(M.equals(lhs, rhs, 1e-9)).toBe(true)
  })

  it('invert(invert(m)) === m', () => {
    expect(M.equals(M.invert(M.invert(A)), A, 1e-9)).toBe(true)
  })

  it('invert transportiert Punkte zurueck (Welt -> Kontext -> Welt)', () => {
    const world = M.chain(M.translation(V.v3(2, -3, 4)), M.rotation(V.AXIS_Z, 0.9), M.scaling(2))
    const inv = M.invert(world)
    const p = V.v3(7, -2, 0.5)
    expectVec(M.transformPoint(inv, M.transformPoint(world, p)), p, 1e-9)
  })

  it('invert einer singulaeren Matrix liefert die Identitaet', () => {
    expect(M.isIdentity(M.invert(M.scaling(V.v3(1, 0, 1))))).toBe(true)
  })

  it('determinant entspricht dem Produkt der Skalierungen', () => {
    expect(close(M.determinant(M.scaling(V.v3(2, 3, 4))), 24, 1e-12)).toBe(true)
    expect(close(M.determinant(M.translation(V.v3(9, 9, 9))), 1, 1e-12)).toBe(true)
    expect(close(M.determinant(M.invert(A)), 1 / M.determinant(A), 1e-9)).toBe(true)
  })
})

describe('mat4 - Spiegelung und Normalen', () => {
  it('mirror laesst Punkte auf der Ebene unveraendert und spiegelt andere', () => {
    const m = M.mirror(V.v3(0, 0, 2), V.AXIS_Z)
    expectVec(M.transformPoint(m, V.v3(1, 1, 2)), V.v3(1, 1, 2))
    expectVec(M.transformPoint(m, V.v3(1, 1, 5)), V.v3(1, 1, -1))
    expect(M.isMirrored(m)).toBe(true)
  })

  it('mirror ist selbstinvers', () => {
    const m = M.mirror(V.v3(1, 2, 3), V.normalize(V.v3(1, 1, 0)))
    expect(M.isIdentity(M.multiply(m, m), 1e-12)).toBe(true)
  })

  it('transformNormal haelt die Normale bei nicht-uniformer Skalierung senkrecht', () => {
    const m = M.scaling(V.v3(1, 5, 1))
    // Tangente in der Ebene z = x (Normale (-1,0,1)/sqrt2)
    const normal = V.normalize(V.v3(-1, 0, 1))
    const tangent = V.v3(1, 0, 1)
    const tangent2 = V.v3(0, 1, 0)
    const n2 = M.transformNormal(m, normal)
    expect(close(V.dot(n2, M.transformDirection(m, tangent)), 0, 1e-12)).toBe(true)
    expect(close(V.dot(n2, M.transformDirection(m, tangent2)), 0, 1e-12)).toBe(true)
    expect(close(V.length(n2), 1, 1e-12)).toBe(true)
  })

  it('transformNormal entspricht transformDirection bei starren Transformationen', () => {
    const m = M.chain(M.translation(V.v3(1, 2, 3)), M.rotation(V.AXIS_X, 0.6))
    const n = V.normalize(V.v3(1, 2, -3))
    expectVec(M.transformNormal(m, n), M.transformDirection(m, n), 1e-12)
  })
})

describe('mat4 - Zerlegung und lookAt', () => {
  it('getScale liest die Spaltenlaengen', () => {
    expectVec(M.getScale(M.chain(M.rotation(V.AXIS_Z, 0.5), M.scaling(V.v3(2, 3, 4)))), V.v3(2, 3, 4), 1e-12)
  })

  it('orthonormalize entfernt die Skalierung und behaelt Translation und Drehung', () => {
    const rot = M.rotation(V.normalize(V.v3(1, 1, 0)), 0.77)
    const m = M.chain(M.translation(V.v3(4, 5, 6)), rot, M.scaling(V.v3(3, 3, 3)))
    const o = M.orthonormalize(m)
    expectVec(M.getScale(o), V.v3(1, 1, 1), 1e-12)
    expectVec(M.getTranslation(o), V.v3(4, 5, 6))
    expect(close(M.determinant(o), 1, 1e-12)).toBe(true)
  })

  it('lookAt baut eine rechtshaendige Kamerabasis mit -Z als Blickrichtung', () => {
    const eye = V.v3(0, -10, 0)
    const target = V.v3(0, 0, 0)
    const m = M.lookAt(eye, target, V.AXIS_Z)
    expectVec(M.getTranslation(m), eye)
    const x = M.getAxis(m, 0)
    const y = M.getAxis(m, 1)
    const z = M.getAxis(m, 2)
    // z zeigt vom Ziel zur Kamera
    expectVec(z, V.normalize(V.sub(eye, target)))
    // Blickrichtung ist -z
    expectVec(V.negate(z), V.v3(0, 1, 0))
    // rechtshaendig
    expectVec(V.cross(x, y), z, 1e-12)
    // "oben" bleibt oben
    expect(V.dot(y, V.AXIS_Z) > 0.99).toBe(true)
  })

  it('lookAt bleibt stabil, wenn up parallel zur Blickrichtung ist', () => {
    const m = M.lookAt(V.v3(0, 0, 10), V.v3(0, 0, 0), V.AXIS_Z)
    expect(allFinite(m)).toBe(true)
    expect(close(Math.abs(M.determinant(m)), 1, 1e-12)).toBe(true)
  })

  it('toArray / fromArray sind invers', () => {
    expect(M.equals(M.fromArray(M.toArray(A)), A)).toBe(true)
    expect(M.toArray(A)).toHaveLength(16)
  })
})
