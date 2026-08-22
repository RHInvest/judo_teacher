import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { exportObj } from '@/io/exporters/obj'
import { GeomBuilder } from '@/io/common/geom'
import { emptyDoc, rootGeometry } from './helpers'

it('nur Kanten', async () => {
  const doc = emptyDoc('Linien')
  const g = new GeomBuilder(rootGeometry(doc))
  g.edgePoints({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 })
  g.edgePoints({ x: 3, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })
  const text = await exportObj(doc, { includeEdges: true }).blob.text()
  writeFileSync('/tmp/claude-0/-home-user-judo-teacher/bb6b2040-e0d0-5f76-b1d5-f29c15a1a5e9/scratchpad/edges.obj', text)
  expect(1).toBe(1)
})
