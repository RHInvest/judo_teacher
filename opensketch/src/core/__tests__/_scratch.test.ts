import { describe, expect, it } from 'vitest'
import { addPolyline, faceArea, followMe, isSolid, solidVolume, orderEdgePath, validate } from '@/core'
import { countFaces, edgeIds, faceIds, geom, p } from './helpers'

function bau(reihenfolge: 'normal' | 'verkehrt', knick: boolean) {
  const g = geom()
  addPolyline(g, [p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], true)
  const profile = faceIds(g)[0]
  const pts = knick
    ? [p(0, 0.5, 0.5), p(3, 0.5, 0.5), p(3, 3, 0.5)]
    : [p(0, 0.5, 0.5), p(3, 0.5, 0.5), p(6, 0.5, 0.5)]
  addPolyline(g, pts, false, { guide: true })
  const path = edgeIds(g).filter((id) => g.edges[id].guide === true)
  const arg = reihenfolge === 'normal' ? path : [path[1], path[0]]
  followMe(g, profile, arg)
  return g
}

describe('scratch', () => {
  it('followMe Varianten', () => {
    for (const knick of [false, true]) {
      for (const r of ['normal', 'verkehrt'] as const) {
        const g = bau(r, knick)
        const nonGuide = edgeIds(g).filter((id) => !g.edges[id].guide)
        console.log(
          `knick=${knick} ${r}: faces=${countFaces(g)} solid=${isSolid(g)} vol=${solidVolume(g).toFixed(3)} ` +
            `offeneKanten=${nonGuide.filter((id) => g.edges[id].faces.length !== 2).length}/${nonGuide.length} ` +
            `validate=${validate(g).length} areas=${faceIds(g).map((id) => faceArea(g, id).toFixed(2)).join(',')}`,
        )
      }
    }
    // Kontrolle: ein einziges Segment
    const g = geom()
    addPolyline(g, [p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], true)
    addPolyline(g, [p(0, 0.5, 0.5), p(6, 0.5, 0.5)], false, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)
    followMe(g, faceIds(g)[0], path)
    console.log(`ein Segment: faces=${countFaces(g)} solid=${isSolid(g)} vol=${solidVolume(g)}`)
    expect(true).toBe(true)
  })
})
