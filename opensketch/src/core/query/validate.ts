/**
 * Integrity checks. Used by the tests and by the debug panel; every kernel
 * operation must leave the geometry so that `validate` returns an empty list.
 */

import type { Geometry } from '@/shared/types'
import { MIN_LENGTH, PLANAR_TOL, V } from '@/core/math'

export function validate(geom: Geometry): string[] {
  const errors: string[] = []
  const push = (msg: string): void => {
    if (errors.length < 200) errors.push(msg)
  }

  for (const vId in geom.vertices) {
    const v = geom.vertices[vId]
    if (v.id !== vId) push(`vertex ${vId}: id mismatch (${v.id})`)
    if (!V.isFinite3(v.p)) push(`vertex ${vId}: non finite position`)
    const seen = new Set<string>()
    for (const eId of v.edges) {
      if (seen.has(eId)) push(`vertex ${vId}: duplicate edge reference ${eId}`)
      seen.add(eId)
      const e = geom.edges[eId]
      if (!e) {
        push(`vertex ${vId}: references missing edge ${eId}`)
        continue
      }
      if (e.a !== vId && e.b !== vId) push(`vertex ${vId}: edge ${eId} does not use it`)
    }
  }

  const edgeKeys = new Map<string, string>()
  for (const eId in geom.edges) {
    const e = geom.edges[eId]
    if (e.id !== eId) push(`edge ${eId}: id mismatch (${e.id})`)
    const a = geom.vertices[e.a]
    const b = geom.vertices[e.b]
    if (!a) push(`edge ${eId}: missing vertex ${e.a}`)
    if (!b) push(`edge ${eId}: missing vertex ${e.b}`)
    if (e.a === e.b) push(`edge ${eId}: degenerate (same vertex)`)
    if (a && b && V.distance(a.p, b.p) < MIN_LENGTH) push(`edge ${eId}: zero length`)
    if (a && !a.edges.includes(eId)) push(`edge ${eId}: vertex ${e.a} misses back reference`)
    if (b && !b.edges.includes(eId)) push(`edge ${eId}: vertex ${e.b} misses back reference`)
    const key = [e.a, e.b].sort().join('-')
    const dup = edgeKeys.get(key)
    if (dup) push(`edge ${eId}: duplicates edge ${dup}`)
    else edgeKeys.set(key, eId)
    const seenFaces = new Set<string>()
    for (const fId of e.faces) {
      if (seenFaces.has(fId)) push(`edge ${eId}: duplicate face reference ${fId}`)
      seenFaces.add(fId)
      const f = geom.faces[fId]
      if (!f) {
        push(`edge ${eId}: references missing face ${fId}`)
        continue
      }
      const used = [f.outer, ...f.inner].some((l) => l.edges.includes(eId))
      if (!used) push(`edge ${eId}: face ${fId} does not use it`)
    }
  }

  for (const fId in geom.faces) {
    const f = geom.faces[fId]
    if (f.id !== fId) push(`face ${fId}: id mismatch (${f.id})`)
    const loops = [f.outer, ...f.inner]
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li]
      const label = li === 0 ? 'outer' : `inner[${li - 1}]`
      const n = loop.edges.length
      if (n !== loop.vertices.length) {
        push(`face ${fId} ${label}: edge/vertex count mismatch (${n}/${loop.vertices.length})`)
        continue
      }
      if (n < 3) {
        push(`face ${fId} ${label}: loop has only ${n} edges`)
        continue
      }
      for (let i = 0; i < n; i++) {
        const e = geom.edges[loop.edges[i]]
        if (!e) {
          push(`face ${fId} ${label}: missing edge ${loop.edges[i]}`)
          continue
        }
        const from = loop.vertices[i]
        const to = loop.vertices[(i + 1) % n]
        if (!((e.a === from && e.b === to) || (e.b === from && e.a === to))) {
          push(`face ${fId} ${label}: edge ${e.id} does not connect ${from} -> ${to}`)
        }
        if (!e.faces.includes(fId)) push(`face ${fId} ${label}: edge ${e.id} misses back reference`)
      }
    }
    const len = V.length(f.normal)
    if (Math.abs(len - 1) > 1e-6) push(`face ${fId}: normal is not unit (${len})`)
    if (V.distance(f.normal, f.plane.n) > 1e-6) push(`face ${fId}: plane normal differs from face normal`)
    for (const vId of f.outer.vertices) {
      const v = geom.vertices[vId]
      if (!v) {
        push(`face ${fId}: missing vertex ${vId}`)
        continue
      }
      const dist = Math.abs(V.dot(f.plane.n, v.p) - f.plane.d)
      if (dist > PLANAR_TOL * 20) push(`face ${fId}: vertex ${vId} is ${dist} off the plane`)
    }
  }

  return errors
}
