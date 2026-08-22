import { describe, expect, it } from 'vitest'
import { CameraController } from '../camera'
import { DEFAULT_STYLE } from '../defaults'
import { EdgeMaterials } from '../edges'
import { MaterialCache } from '../materials'
import { Picker } from '../picking'
import { SceneSync } from '../sceneSync'
import { addEntity, emptyDocument, snapshotOf } from './helpers'

describe('probe: Klick auf Bemassung', () => {
  it('trifft?', () => {
    const doc = emptyDocument()
    addEntity(doc, {
      id: 'dim-1', type: 'dimension', name: 'M', tagId: null, hidden: false, locked: false,
      kind: 'linear', start: { x: -2, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 }, offset: { x: 0, y: 1, z: 0 },
      text: null, fontSize: 12, color: '#333', screenSpace: true, arrowStyle: 'closedArrow',
    })
    const materials = new MaterialCache(DEFAULT_STYLE, () => undefined)
    const sync = new SceneSync(materials, new EdgeMaterials())
    const snapshot = snapshotOf(doc)
    sync.update(snapshot)
    const camera = new CameraController(() => undefined)
    camera.setSize(800, 600)
    camera.setState({ eye: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 35, projection: 'perspective' })
    const picker = new Picker(sync, camera)
    // Mitte der Masslinie: Weltpunkt (0, 1, 0)
    const s = camera.worldToScreen({ x: 0, y: 1, z: 0 })
    const hit = picker.pick(snapshot, s.x, s.y)
    console.log('KLICK AUF MASSLINIE ->', hit.kind, hit.id)
    expect(true).toBe(true)
  })
})
