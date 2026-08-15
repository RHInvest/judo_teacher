/**
 * Gemeinsame Testhelfer fuer den Geometriekern.
 */

import { expect } from 'vitest'
import { emptyGeometry, type Geometry, type Id, type Vec3Like } from '@/shared/types'
import { validate } from '@/core'

export function geom(): Geometry {
  return emptyGeometry()
}

export function p(x: number, y: number, z = 0): Vec3Like {
  return { x, y, z }
}

export function countVertices(g: Geometry): number {
  return Object.keys(g.vertices).length
}

export function countEdges(g: Geometry): number {
  return Object.keys(g.edges).length
}

export function countFaces(g: Geometry): number {
  return Object.keys(g.faces).length
}

export function faceIds(g: Geometry): Id[] {
  return Object.keys(g.faces)
}

export function edgeIds(g: Geometry): Id[] {
  return Object.keys(g.edges)
}

/** Jede Operation muss die Geometrie in einem gueltigen Zustand hinterlassen. */
export function expectValid(g: Geometry, label = ''): void {
  const errors = validate(g)
  expect(errors, `${label} ${errors.join(' | ')}`).toEqual([])
}

/** Rechteck in der XY-Ebene, gegen den Uhrzeigersinn. */
export function rect(w: number, h: number, z = 0): Vec3Like[] {
  return [p(0, 0, z), p(w, 0, z), p(w, h, z), p(0, h, z)]
}
