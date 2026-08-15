/**
 * Accumulator for `GeometryChange`.
 *
 * Every kernel operation collects its effects here and converts the result to
 * the flat `GeometryChange` contract at the end. Ids that were created and
 * destroyed inside the same operation cancel out so the renderer and the undo
 * system never see phantom primitives.
 */

import type { Id } from '@/shared/types'
import type { GeometryChange } from '@/shared/store-api'

export interface ChangeAcc {
  addedVertices: Set<Id>
  addedEdges: Set<Id>
  addedFaces: Set<Id>
  removedVertices: Set<Id>
  removedEdges: Set<Id>
  removedFaces: Set<Id>
  modifiedFaces: Set<Id>
  modifiedEdges: Set<Id>
}

export function newAcc(): ChangeAcc {
  return {
    addedVertices: new Set(),
    addedEdges: new Set(),
    addedFaces: new Set(),
    removedVertices: new Set(),
    removedEdges: new Set(),
    removedFaces: new Set(),
    modifiedFaces: new Set(),
    modifiedEdges: new Set(),
  }
}

function reconcile(added: Set<Id>, removed: Set<Id>): { added: Id[]; removed: Id[] } {
  const a: Id[] = []
  const r: Id[] = []
  for (const id of added) if (!removed.has(id)) a.push(id)
  for (const id of removed) if (!added.has(id)) r.push(id)
  return { added: a, removed: r }
}

/** Turns the accumulator into the flat contract type. */
export function finishAcc(acc: ChangeAcc): GeometryChange {
  const v = reconcile(acc.addedVertices, acc.removedVertices)
  const e = reconcile(acc.addedEdges, acc.removedEdges)
  const f = reconcile(acc.addedFaces, acc.removedFaces)
  const modifiedFaces: Id[] = []
  for (const id of acc.modifiedFaces) {
    if (!acc.removedFaces.has(id) && !acc.addedFaces.has(id)) modifiedFaces.push(id)
  }
  const modifiedEdges: Id[] = []
  for (const id of acc.modifiedEdges) {
    if (!acc.removedEdges.has(id) && !acc.addedEdges.has(id)) modifiedEdges.push(id)
  }
  return {
    addedVertices: v.added,
    addedEdges: e.added,
    addedFaces: f.added,
    removedVertices: v.removed,
    removedEdges: e.removed,
    removedFaces: f.removed,
    modifiedFaces,
    modifiedEdges,
  }
}

/** Merges `src` into `dst` (used when an operation composes sub operations). */
export function mergeAcc(dst: ChangeAcc, src: ChangeAcc): void {
  for (const id of src.addedVertices) dst.addedVertices.add(id)
  for (const id of src.addedEdges) dst.addedEdges.add(id)
  for (const id of src.addedFaces) dst.addedFaces.add(id)
  for (const id of src.removedVertices) dst.removedVertices.add(id)
  for (const id of src.removedEdges) dst.removedEdges.add(id)
  for (const id of src.removedFaces) dst.removedFaces.add(id)
  for (const id of src.modifiedFaces) dst.modifiedFaces.add(id)
  for (const id of src.modifiedEdges) dst.modifiedEdges.add(id)
}
