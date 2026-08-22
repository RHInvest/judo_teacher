import { describe, expect, it } from 'vitest'
import * as core from '@/core'
import { emptyGeometry } from '@/shared/types'

function rect(): ReturnType<typeof emptyGeometry> {
  const g = emptyGeometry()
  core.addFacePolygon(g, [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 3, z: 0 },
    { x: 0, y: 3, z: 0 },
  ])
  return g
}

describe('probe', () => {
  it('kante', () => {
    const g = rect()
    const ray = { origin: { x: 4 + 1e-14, y: 1.5, z: 10 }, dir: { x: 0, y: 0, z: -1 } }
    const hits = core.raycast(g, ray, { kinds: ['face'] })
    console.log('face@4+1e-14', JSON.stringify(hits))
    const hits2 = core.raycast(g, ray, { kinds: ['face'], tolerance: 0 })
    console.log('tol0', JSON.stringify(hits2))
    const far = { origin: { x: 4.05, y: 1.5, z: 10 }, dir: { x: 0, y: 0, z: -1 } }
    console.log('5cm/10cm', JSON.stringify(core.raycast(g, far, { kinds: ['face', 'edge'], tolerance: 0.1 })))
    console.log('coord1234', JSON.stringify(core.raycast(rect(), { origin: { x: 2, y: 1.5, z: 10 }, dir: { x: 0, y: 0, z: -1 } }, { kinds: ['face'] })))
  })
})
