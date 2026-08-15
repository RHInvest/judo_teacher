/**
 * Orientation helper shared by the generating operations (follow-me, revolve,
 * boolean). Freshly built shells have consistent but arbitrary winding; this
 * turns them so that all normals point away from the enclosed volume.
 */

import type { Geometry, Id } from '@/shared/types'
import { V } from '@/core/math'
import { findConnected, flipFace, orientFacesConsistentlyMut } from '@/core/topology'
import { faceTriangles } from '@/core/query/triangulate'

/** Signed volume of a face set via the divergence theorem. */
export function signedVolume(geom: Geometry, faceIds: readonly Id[]): number {
  let sum = 0
  for (const id of faceIds) {
    for (const [a, b, c] of faceTriangles(geom, id)) {
      sum += V.dot(a, V.cross(b, c))
    }
  }
  return sum / 6
}

/**
 * Makes the connected component around `seedFaceId` consistently oriented with
 * every normal pointing outwards. Open shells keep whatever orientation the
 * consistency pass produced.
 */
export function orientComponentOutward(geom: Geometry, seedFaceId: Id): void {
  if (!geom.faces[seedFaceId]) return
  orientFacesConsistentlyMut(geom, seedFaceId)
  const component = findConnected(geom, { faceIds: [seedFaceId] }).faceIds
  if (component.length === 0) return
  if (signedVolume(geom, component) < 0) {
    for (const id of component) flipFace(geom, id)
  }
}
