import { it, expect } from 'vitest'
import { exportObj } from '@/io/exporters/obj'
import { GeomBuilder } from '@/io/common/geom'
import { emptyDoc, rootGeometry } from './helpers'

it('nur Kanten, keine Flaechen', async () => {
  const doc = emptyDoc('Linien')
  const g = new GeomBuilder(rootGeometry(doc))
  g.edgePoints({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 })
  g.edgePoints({ x: 3, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })
  const text = await exportObj(doc, { includeEdges: true }).blob.text()
  expect(text).toBe('SIEHE OBEN\n' + text)
})
