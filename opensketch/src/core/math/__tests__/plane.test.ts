/**
 * QA-Tests fuer `@/core/math/plane`.
 *
 * Schwerpunkt: Newell-Normale bei konkaven und geneigten Polygonen,
 * Ebenenschnitt, Segmentschnitt, Rechtshaendigkeit der 2D-Basis.
 */

import { describe, expect, it } from 'vitest'
import * as P from '../plane'
import * as V from '../vec3'
import * as M from '../mat4'
import { PLANAR_TOL } from '../constants'

type V3 = { x: number; y: number; z: number }

const close = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol

function expectVec(actual: V3, expected: V3, tol = 1e-12): void {
  expect(close(actual.x, expected.x, tol), `x: ${actual.x} != ${expected.x}`).toBe(true)
  expect(close(actual.y, expected.y, tol), `y: ${actual.y} != ${expected.y}`).toBe(true)
  expect(close(actual.z, expected.z, tol), `z: ${actual.z} != ${expected.z}`).toBe(true)
}

/** Konkaves L-Polygon in der XY-Ebene, gegen den Uhrzeigersinn (Flaeche 3). */
const L_SHAPE: V3[] = [
  V.v3(0, 0, 0),
  V.v3(2, 0, 0),
  V.v3(2, 1, 0),
  V.v3(1, 1, 0),
  V.v3(1, 2, 0),
  V.v3(0, 2, 0),
]

/** Stark konkaves "Stern"-artiges Polygon, ebenfalls CCW in XY. */
const CONCAVE_STAR: V3[] = [
  V.v3(0, 0, 0),
  V.v3(4, 0, 0),
  V.v3(4, 4, 0),
  V.v3(2, 2, 0), // tiefe Einbuchtung
  V.v3(0, 4, 0),
]

describe('plane - Konstruktion', () => {
  it('fromNormalAndPoint erfuellt dot(n,p) - d === 0', () => {
    const pl = P.fromNormalAndPoint(V.v3(0, 0, 3), V.v3(1, 2, 5))
    expectVec(pl.n, V.AXIS_Z)
    expect(pl.d).toBe(5)
    expect(close(P.signedDistance(pl, V.v3(9, 9, 5)), 0)).toBe(true)
  })

  it('fromPoints liefert die rechtshaendige Normale der Dreiecksumlaufrichtung', () => {
    const pl = P.fromPoints(V.v3(0, 0, 0), V.v3(1, 0, 0), V.v3(0, 1, 0))
    expect(pl).not.toBeNull()
    expectVec(pl!.n, V.AXIS_Z)
    expect(close(pl!.d, 0)).toBe(true)
  })

  it('fromPoints liefert null fuer kollineare Punkte', () => {
    expect(P.fromPoints(V.v3(0, 0, 0), V.v3(1, 1, 1), V.v3(2, 2, 2))).toBeNull()
  })

  it('fromNormalAndDistance normalisiert die Normale', () => {
    const pl = P.fromNormalAndDistance(V.v3(0, 0, 7), 4)
    expectVec(pl.n, V.AXIS_Z)
    expect(pl.d).toBe(4)
  })
})

describe('plane - Newell-Normale', () => {
  it('konvexes CCW-Quadrat in XY ergibt +Z', () => {
    const square = [V.v3(0, 0, 0), V.v3(1, 0, 0), V.v3(1, 1, 0), V.v3(0, 1, 0)]
    expectVec(P.polygonNormal(square)!, V.AXIS_Z)
    expect(close(P.polygonArea(square), 1)).toBe(true)
  })

  it('umgekehrte Umlaufrichtung kehrt die Normale um', () => {
    const square = [V.v3(0, 0, 0), V.v3(1, 0, 0), V.v3(1, 1, 0), V.v3(0, 1, 0)]
    expectVec(P.polygonNormal([...square].reverse())!, V.negate(V.AXIS_Z))
  })

  it('KONKAVES L-Polygon liefert weiterhin +Z und die korrekte Flaeche', () => {
    expectVec(P.polygonNormal(L_SHAPE)!, V.AXIS_Z)
    expect(close(P.polygonArea(L_SHAPE), 3)).toBe(true)
  })

  it('stark konkaves Polygon liefert weiterhin +Z und die korrekte Flaeche', () => {
    // 4x4-Quadrat minus das eingedrueckte Dreieck (Grundseite 4, Hoehe 2) = 16 - 4 = 12
    expectVec(P.polygonNormal(CONCAVE_STAR)!, V.AXIS_Z)
    expect(close(P.polygonArea(CONCAVE_STAR), 12)).toBe(true)
  })

  it('Newell ist unabhaengig vom Startindex der Schleife', () => {
    const rotated = [...L_SHAPE.slice(3), ...L_SHAPE.slice(0, 3)]
    expectVec(P.polygonNormal(rotated)!, P.polygonNormal(L_SHAPE)!)
    expect(close(P.polygonArea(rotated), P.polygonArea(L_SHAPE), 1e-12)).toBe(true)
  })

  it('geneigtes konkaves Polygon: Normale und Flaeche werden mitgedreht', () => {
    const rot = M.rotation(V.normalize(V.v3(1, 1, 0)), 0.6)
    const tilted = L_SHAPE.map((p) => M.transformPoint(rot, p))
    expectVec(P.polygonNormal(tilted)!, M.transformDirection(rot, V.AXIS_Z), 1e-12)
    expect(close(P.polygonArea(tilted), 3, 1e-12)).toBe(true)
  })

  it('fromPolygon legt die Ebene durch alle Punkte des konkaven Polygons', () => {
    const rot = M.chain(M.translation(V.v3(2, -5, 1)), M.rotation(V.normalize(V.v3(0.3, 1, 2)), 1.1))
    const tilted = L_SHAPE.map((p) => M.transformPoint(rot, p))
    const pl = P.fromPolygon(tilted)!
    expect(pl).not.toBeNull()
    for (const p of tilted) {
      expect(P.containsPoint(pl, p, 1e-12), `Punkt ${JSON.stringify(p)} nicht auf der Ebene`).toBe(true)
    }
  })

  it('polygonNormal liefert null fuer weniger als 3 Punkte und fuer kollineare Punkte', () => {
    expect(P.polygonNormal([V.v3(0, 0, 0), V.v3(1, 0, 0)])).toBeNull()
    expect(P.polygonNormal([V.v3(0, 0, 0), V.v3(1, 0, 0), V.v3(2, 0, 0)])).toBeNull()
  })

  it('polygonArea ist unabhaengig von der Umlaufrichtung', () => {
    expect(close(P.polygonArea([...L_SHAPE].reverse()), 3)).toBe(true)
  })
})

describe('plane - Abstand, Projektion, Umkehrung', () => {
  it('signedDistance ist positiv auf der Normalenseite', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 2))
    expect(close(P.signedDistance(pl, V.v3(0, 0, 5)), 3)).toBe(true)
    expect(close(P.signedDistance(pl, V.v3(0, 0, -1)), -3)).toBe(true)
  })

  it('projectPoint faellt lotrecht auf die Ebene', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 2))
    expectVec(P.projectPoint(pl, V.v3(4, 5, 9)), V.v3(4, 5, 2))
    expect(close(P.signedDistance(pl, P.projectPoint(pl, V.v3(4, 5, 9))), 0)).toBe(true)
  })

  it('projectDirection entfernt den Normalenanteil', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 2))
    expectVec(P.projectDirection(pl, V.v3(1, 2, 3)), V.v3(1, 2, 0))
  })

  it('flip dreht Normale und Vorzeichen der Distanz, die Ebene bleibt dieselbe', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 2))
    const f = P.flip(pl)
    expectVec(f.n, V.negate(V.AXIS_Z))
    expect(f.d).toBe(-2)
    expect(close(P.signedDistance(f, V.v3(0, 0, 2)), 0)).toBe(true)
    expect(P.isCoplanar(pl, f)).toBe(true)
    expect(P.equals(pl, f)).toBe(false)
  })

  it('containsPoint arbeitet mit PLANAR_TOL', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN)
    expect(P.containsPoint(pl, V.v3(0, 0, PLANAR_TOL / 2))).toBe(true)
    expect(P.containsPoint(pl, V.v3(0, 0, PLANAR_TOL * 10))).toBe(false)
  })
})

describe('plane - Schnitte', () => {
  it('intersectRay trifft die Ebene bei korrektem t', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 5))
    const t = P.intersectRay(pl, V.ORIGIN, V.AXIS_Z)
    expect(close(t!, 5)).toBe(true)
    expectVec(P.intersectRayPoint(pl, V.ORIGIN, V.AXIS_Z)!, V.v3(0, 0, 5))
  })

  it('intersectRay liefert negatives t fuer Ebenen hinter dem Ursprung', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, -5))
    expect(close(P.intersectRay(pl, V.ORIGIN, V.AXIS_Z)!, -5)).toBe(true)
  })

  it('intersectRay liefert null bei paralleler Richtung', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN)
    expect(P.intersectRay(pl, V.v3(0, 0, 1), V.AXIS_X)).toBeNull()
  })

  it('intersectSegment findet den Durchstosspunkt', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN)
    expectVec(P.intersectSegment(pl, V.v3(1, 1, -2), V.v3(1, 1, 2))!, V.v3(1, 1, 0))
  })

  it('intersectSegment liefert null, wenn beide Enden auf derselben Seite liegen', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN)
    expect(P.intersectSegment(pl, V.v3(0, 0, 1), V.v3(0, 0, 3))).toBeNull()
    expect(P.intersectSegment(pl, V.v3(0, 0, -1), V.v3(0, 0, -3))).toBeNull()
  })

  it('intersectSegment liefert den Endpunkt, wenn dieser auf der Ebene liegt', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN)
    expectVec(P.intersectSegment(pl, V.v3(4, 4, 0), V.v3(0, 0, 3))!, V.v3(4, 4, 0))
    expectVec(P.intersectSegment(pl, V.v3(0, 0, 3), V.v3(4, 4, 0))!, V.v3(4, 4, 0))
  })

  it('intersectPlane: XY-Ebene und XZ-Ebene schneiden sich in der X-Achse', () => {
    const a = P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN)
    const b = P.fromNormalAndPoint(V.AXIS_Y, V.ORIGIN)
    const line = P.intersectPlane(a, b)!
    expect(line).not.toBeNull()
    expect(V.isParallel(line.dir, V.AXIS_X)).toBe(true)
    expect(close(V.length(line.dir), 1)).toBe(true)
    expectVec(line.origin, V.ORIGIN, 1e-12)
  })

  it('intersectPlane: der Ursprung liegt auf beiden Ebenen (versetzte Ebenen)', () => {
    const a = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 2))
    const b = P.fromNormalAndPoint(V.AXIS_X, V.v3(3, 0, 0))
    const line = P.intersectPlane(a, b)!
    expectVec(line.origin, V.v3(3, 0, 2), 1e-12)
    expect(V.isParallel(line.dir, V.AXIS_Y)).toBe(true)
  })

  it('intersectPlane: allgemeine schiefe Ebenen - Gerade liegt in beiden Ebenen', () => {
    const a = P.fromNormalAndPoint(V.normalize(V.v3(1, 2, 3)), V.v3(1, 0, 0))
    const b = P.fromNormalAndPoint(V.normalize(V.v3(-2, 1, 0.5)), V.v3(0, -3, 2))
    const line = P.intersectPlane(a, b)!
    expect(line).not.toBeNull()
    for (const t of [-10, 0, 1, 7.5]) {
      const p = V.addScaled(line.origin, line.dir, t)
      expect(close(P.signedDistance(a, p), 0, 1e-12), `t=${t} nicht auf Ebene a`).toBe(true)
      expect(close(P.signedDistance(b, p), 0, 1e-12), `t=${t} nicht auf Ebene b`).toBe(true)
    }
    expect(close(V.dot(line.dir, a.n), 0, 1e-12)).toBe(true)
    expect(close(V.dot(line.dir, b.n), 0, 1e-12)).toBe(true)
  })

  it('intersectPlane liefert null bei parallelen und identischen Ebenen', () => {
    const a = P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN)
    const b = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 5))
    expect(P.intersectPlane(a, b)).toBeNull()
    expect(P.intersectPlane(a, a)).toBeNull()
    expect(P.intersectPlane(a, P.flip(a))).toBeNull()
  })
})

describe('plane - 2D-Basis und Frame', () => {
  const NORMALS = [
    V.AXIS_X,
    V.AXIS_Y,
    V.AXIS_Z,
    V.negate(V.AXIS_X),
    V.negate(V.AXIS_Y),
    V.negate(V.AXIS_Z),
    V.normalize(V.v3(1, 1, 1)),
    V.normalize(V.v3(-2, 0.5, 3)),
    V.normalize(V.v3(0.0001, 1, 0.0001)),
  ]

  it('basis liefert eine rechtshaendige Orthonormalbasis (u x v === n)', () => {
    for (const n of NORMALS) {
      const pl = P.fromNormalAndPoint(n, V.ORIGIN)
      const { u, v } = P.basis(pl)
      expect(close(V.length(u), 1, 1e-12), `|u| fuer ${JSON.stringify(n)}`).toBe(true)
      expect(close(V.length(v), 1, 1e-12), `|v| fuer ${JSON.stringify(n)}`).toBe(true)
      expect(close(V.dot(u, v), 0, 1e-12), `u.v fuer ${JSON.stringify(n)}`).toBe(true)
      expect(close(V.dot(u, pl.n), 0, 1e-12), `u.n fuer ${JSON.stringify(n)}`).toBe(true)
      expect(close(V.dot(v, pl.n), 0, 1e-12), `v.n fuer ${JSON.stringify(n)}`).toBe(true)
      expectVec(V.cross(u, v), pl.n, 1e-12)
    }
  })

  it('basis der XY-Ebene ist (X, Y)', () => {
    const { u, v } = P.basis(P.fromNormalAndPoint(V.AXIS_Z, V.ORIGIN))
    expectVec(u, V.AXIS_X)
    expectVec(v, V.AXIS_Y)
  })

  it('to2d/from2d sind zueinander invers fuer Punkte auf der Ebene', () => {
    for (const n of NORMALS) {
      const pl = P.fromNormalAndPoint(n, V.v3(1, -2, 3))
      const f = P.frame(pl)
      for (const p2 of [{ x: 0, y: 0 }, { x: 3, y: -7 }, { x: -1.5, y: 0.25 }]) {
        const p3 = f.from2d(p2)
        expect(close(P.signedDistance(pl, p3), 0, 1e-12)).toBe(true)
        const back = f.to2d(p3)
        expect(close(back.x, p2.x, 1e-12)).toBe(true)
        expect(close(back.y, p2.y, 1e-12)).toBe(true)
      }
    }
  })

  it('frame ohne Ursprung nutzt den ebenennaechsten Punkt zum Weltursprung', () => {
    const pl = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 4))
    expectVec(P.frame(pl).origin, V.v3(0, 0, 4))
  })

  it('to2d erhaelt Abstaende (Isometrie)', () => {
    const pl = P.fromNormalAndPoint(V.normalize(V.v3(1, 2, 3)), V.ORIGIN)
    const f = P.frame(pl)
    const a = f.from2d({ x: 1, y: 2 })
    const b = f.from2d({ x: 4, y: -2 })
    expect(close(V.distance(a, b), 5, 1e-12)).toBe(true)
  })

  it('Flaeche eines konkaven Polygons stimmt in 2D und 3D ueberein', () => {
    const rot = M.rotation(V.normalize(V.v3(1, -1, 2)), 0.9)
    const tilted = L_SHAPE.map((p) => M.transformPoint(rot, p))
    const pl = P.fromPolygon(tilted)!
    const f = P.frame(pl)
    const flat = tilted.map((p) => f.to2d(p))
    let sum = 0
    for (let i = 0; i < flat.length; i++) {
      const a = flat[i]
      const b = flat[(i + 1) % flat.length]
      sum += a.x * b.y - b.x * a.y
    }
    // positiv, weil die Basis rechtshaendig zur Polygonnormalen liegt
    expect(close(sum * 0.5, 3, 1e-12)).toBe(true)
  })
})

describe('plane - Koplanaritaet', () => {
  it('arePointsCoplanar erkennt planare Punkte', () => {
    expect(P.arePointsCoplanar(L_SHAPE)).toBe(true)
  })

  it('arePointsCoplanar erkennt einen ausgelenkten Punkt', () => {
    const bent = [...L_SHAPE.slice(0, 5), V.v3(0, 2, 0.01)]
    expect(P.arePointsCoplanar(bent)).toBe(false)
  })

  it('isCoplanar ignoriert die Normalenrichtung, equals nicht', () => {
    const a = P.fromNormalAndPoint(V.AXIS_Z, V.v3(0, 0, 3))
    expect(P.isCoplanar(a, P.flip(a))).toBe(true)
    expect(P.equals(a, P.flip(a))).toBe(false)
    expect(P.equals(a, a)).toBe(true)
  })

  it('bestFit liefert fuer eine ebene Punktwolke die richtige Ebene', () => {
    const pl = P.bestFit(L_SHAPE)
    expectVec(pl.n, V.AXIS_Z)
    expect(close(pl.d, 0)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Bekannte Schwaechen - siehe QA-REVIEW.md                            */
/* ------------------------------------------------------------------ */

describe('plane - dokumentierte Schwaechen', () => {
  it('BEFUND W-4: bestFit/arePointsCoplanar sind Newell-basiert und damit reihenfolgeabhaengig', () => {
    // Vier koplanare Punkte in "Schmetterlings"-Reihenfolge: die Newell-Summe
    // hebt sich auf, obwohl die Punkte perfekt in der XY-Ebene liegen.
    const bowtie = [V.v3(0, 0, 0), V.v3(1, 1, 0), V.v3(1, 0, 0), V.v3(0, 1, 0)]
    expect(P.polygonNormal(bowtie)).toBeNull()
    // bestFit faellt deshalb auf einen willkuerlichen Zweipunkt-Fallback zurueck
    // statt die offensichtliche XY-Ebene zu liefern.
    expect(V.isParallel(P.bestFit(bowtie).n, V.AXIS_Z)).toBe(false)
    // arePointsCoplanar antwortet hier nur deshalb "true", weil die Normale
    // degeneriert ist - es wurde nichts geprueft.
    expect(P.arePointsCoplanar(bowtie)).toBe(true)
  })
})
