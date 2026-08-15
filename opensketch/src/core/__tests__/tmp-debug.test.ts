import { it } from 'vitest'
import { addEdge, addPolyline, faceArea, pushPull, solidVolume } from '@/core'
import { crossIntersectionSegments, classifyPoint } from '@/core/ops/boolean'
import { geom, p, faceIds } from './helpers'

function box(x0: number, y0: number, z0: number, sx: number, sy: number, sz: number) {
  const g = geom()
  addPolyline(g, [p(x0, y0, z0), p(x0 + sx, y0, z0), p(x0 + sx, y0 + sy, z0), p(x0, y0 + sy, z0)], true)
  pushPull(g, faceIds(g)[0], sz)
  return g
}

it('debug boolean', () => {
  const a = box(0, 0, 0, 2, 2, 2)
  const b = box(1, 1, 1, 2, 2, 2)
  const lines: string[] = []
  lines.push(`volA=${solidVolume(a)} volB=${solidVolume(b)}`)
  const segs = crossIntersectionSegments(a, b)
  lines.push(`segments=${segs.length}`)
  for (const s of segs) {
    lines.push(`  (${s[0].x.toFixed(2)},${s[0].y.toFixed(2)},${s[0].z.toFixed(2)}) -> (${s[1].x.toFixed(2)},${s[1].y.toFixed(2)},${s[1].z.toFixed(2)})`)
  }
  lines.push(`facesA before=${faceIds(a).length}`)
  for (const s of segs) addEdge(a, s[0], s[1])
  lines.push(`facesA after=${faceIds(a).length}`)
  for (const id of faceIds(a)) {
    const f = a.faces[id]
    lines.push(`  A ${id} n=(${f.normal.x},${f.normal.y},${f.normal.z}) d=${f.plane.d} area=${faceArea(a, id).toFixed(2)}`)
  }
  lines.push(`cls (1.5,1.5,2) vs b = ${classifyPoint(b, { x: 1.5, y: 1.5, z: 2 })}`)
  lines.push(`cls (0.5,0.5,2) vs b = ${classifyPoint(b, { x: 0.5, y: 0.5, z: 2 })}`)
  throw new Error('\n' + lines.join('\n'))
})
