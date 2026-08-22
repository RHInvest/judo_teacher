/**
 * Einzelklick auf Annotationen.
 *
 * Vorgeschichte: `pickEntities` kannte nur `guidePoint` und `guideLine`. Auf
 * eine Bemassung, einen Text oder ein Bild zu klicken lieferte 'ground' - was
 * niemandem auffiel, solange man die Dinger gar nicht sehen konnte. Ueber die
 * Rahmenauswahl (`pickRect`, ueber `entityAnchor`) gingen sie schon immer.
 *
 * Aufbau: Kamera 10 m senkrecht ueber dem Ursprung, 800x600.
 */

import { describe, expect, it } from 'vitest'
import { M } from '@/core/math'
import type { DimensionEntity, ImageEntity, SketchDocument, TextEntity, Vec3Like } from '@/shared/types'
import { AnnotationLayer } from '../annotations'
import { CameraController } from '../camera'
import { DEFAULT_STYLE } from '../defaults'
import { EdgeMaterials } from '../edges'
import { MaterialCache } from '../materials'
import { Picker } from '../picking'
import { SceneSync } from '../sceneSync'
import type { RenderSnapshot } from '../snapshot'
import { addEntity, documentWithSquare, emptyDocument, snapshotOf } from './helpers'

const WIDTH = 800
const HEIGHT = 600

interface Fixture {
  snapshot: RenderSnapshot
  camera: CameraController
  picker: Picker
  layer: AnnotationLayer
}

function makeFixture(doc: SketchDocument, patch: Partial<RenderSnapshot> = {}): Fixture {
  const materials = new MaterialCache(DEFAULT_STYLE, () => undefined)
  const sync = new SceneSync(materials, new EdgeMaterials())
  const snapshot = snapshotOf(doc, patch)
  materials.update(doc, snapshot.style, true)
  sync.update(snapshot)

  const camera = new CameraController(() => undefined)
  camera.setSize(WIDTH, HEIGHT)
  camera.setState({
    eye: { x: 0, y: 0, z: 10 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    fov: 35,
    projection: 'perspective',
  })

  const layer = new AnnotationLayer()
  layer.setResolution(WIDTH, HEIGHT)
  layer.update(snapshot, sync)

  return { snapshot, camera, picker: new Picker(sync, camera, layer), layer }
}

function dimension(patch: Partial<DimensionEntity> = {}): DimensionEntity {
  return {
    id: 'dim-1',
    type: 'dimension',
    name: 'Mass',
    tagId: null,
    hidden: false,
    locked: false,
    kind: 'linear',
    start: { x: -2, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 0 },
    offset: { x: 0, y: 1, z: 0 },
    text: null,
    fontSize: 14,
    color: '#333333',
    screenSpace: true,
    arrowStyle: 'closedArrow',
    ...patch,
  }
}

/* ================================================================== */

describe('Klick auf eine Bemassung', () => {
  it('trifft die Masslinie', () => {
    const f = makeFixture(withEntity(dimension()))
    // Mitte der Masslinie: sie liegt um den Versatz verschoben bei y = 1
    const hit = pickAt(f, { x: 0, y: 1, z: 0 })
    expect(hit.kind).toBe('entity')
    expect(hit.id).toBe('dim-1')
  })

  it('trifft den Masstext', () => {
    const f = makeFixture(withEntity(dimension()))
    // Der Text sitzt oberhalb der Masslinie, um seine eigene Hoehe versetzt -
    // fuer den Nutzer das groesste sichtbare Element der Bemassung.
    const line = f.camera.worldToScreen({ x: 0, y: 1, z: 0 })
    const hit = f.picker.pick(f.snapshot, line.x, line.y - 14 * 0.85)
    expect(hit.kind).toBe('entity')
    expect(hit.id).toBe('dim-1')
  })

  it('trifft die Hilfslinie am Messpunkt', () => {
    const f = makeFixture(withEntity(dimension()))
    const hit = pickAt(f, { x: -2, y: 0.5, z: 0 })
    expect(hit.kind).toBe('entity')
    expect(hit.id).toBe('dim-1')
  })

  it('trifft weit daneben nicht', () => {
    const f = makeFixture(withEntity(dimension()))
    const hit = pickAt(f, { x: 0, y: -3, z: 0 })
    expect(hit.id).not.toBe('dim-1')
  })

  it('haelt die Trefferzone unabhaengig vom Zoom', () => {
    // Die Toleranz ist in PIXELN gedacht: 5 px neben der Masslinie muss in
    // jeder Zoomstufe treffen, ein fester Weltabstand taete das nicht.
    const f = makeFixture(withEntity(dimension()))
    for (const distance of [4, 10, 40]) {
      f.camera.setState({ eye: { x: 0, y: 0, z: distance }, target: { x: 0, y: 0, z: 0 } })
      const line = f.camera.worldToScreen({ x: 0.5, y: 1, z: 0 })
      const hit = f.picker.pick(f.snapshot, line.x + 5, line.y)
      expect(hit.id).toBe('dim-1')
    }
  })

  it('trifft den Winkelbogen', () => {
    const f = makeFixture(
      withEntity(
        dimension({
          kind: 'angular',
          center: { x: 0, y: 0, z: 0 },
          start: { x: 2, y: 0, z: 0 },
          end: { x: 0, y: 2, z: 0 },
        }),
      ),
    )
    // Bogen bei Radius 1,5 (0,75 * 2), auf der Winkelhalbierenden
    const r = 1.5 / Math.SQRT2
    const hit = pickAt(f, { x: r, y: r, z: 0 })
    expect(hit.kind).toBe('entity')
    expect(hit.id).toBe('dim-1')
  })

  it('achtet auf die Ignorierliste', () => {
    const f = makeFixture(withEntity(dimension()))
    const s = f.camera.worldToScreen({ x: 0, y: 1, z: 0 })
    const hit = f.picker.pick(f.snapshot, s.x, s.y, { ignore: ['dim-1'] })
    expect(hit.id).not.toBe('dim-1')
  })

  it('ueberspringt versteckte Bemassungen', () => {
    const f = makeFixture(withEntity(dimension({ hidden: true })))
    expect(pickAt(f, { x: 0, y: 1, z: 0 }).id).not.toBe('dim-1')
  })

  it('folgt der Tag-Sichtbarkeit', () => {
    const f = makeFixture(withEntity(dimension({ tagId: 'tag-mass' })), { isTagVisible: (id) => id !== 'tag-mass' })
    expect(pickAt(f, { x: 0, y: 1, z: 0 }).id).not.toBe('dim-1')
  })
})

describe('Klick auf einen Text', () => {
  const text: TextEntity = {
    id: 'txt-1',
    type: 'text',
    name: 'Text',
    tagId: null,
    hidden: false,
    locked: false,
    anchor: { x: 0, y: 0, z: 0 },
    position: { x: 2, y: 2, z: 0 },
    text: 'Wohnzimmer',
    fontSize: 16,
    color: '#222222',
    screenSpace: true,
    leader: 'viewBased',
  }

  it('trifft den Textkoerper', () => {
    const f = makeFixture(withEntity(text))
    const hit = pickAt(f, { x: 2, y: 2, z: 0 })
    expect(hit.kind).toBe('entity')
    expect(hit.id).toBe('txt-1')
  })

  it('trifft die Fuehrungslinie', () => {
    const f = makeFixture(withEntity(text))
    const hit = pickAt(f, { x: 1, y: 1, z: 0 })
    expect(hit.kind).toBe('entity')
    expect(hit.id).toBe('txt-1')
  })

  it('trifft ohne Fuehrungslinie weiterhin den Textpunkt', () => {
    const f = makeFixture(withEntity({ ...text, leader: 'none' }))
    const hit = pickAt(f, { x: 2, y: 2, z: 0 })
    expect(hit.id).toBe('txt-1')
  })
})

describe('Klick auf ein Bild', () => {
  const image: ImageEntity = {
    id: 'img-1',
    type: 'image',
    name: 'Bild',
    tagId: null,
    hidden: false,
    locked: false,
    textureId: 'tex-1',
    transform: M.translation({ x: -1, y: -1, z: 0 }),
    width: 2,
    height: 2,
    usage: 'model',
  }

  it('trifft die Bildflaeche', () => {
    const f = makeFixture(withEntity(image))
    const hit = pickAt(f, { x: 0, y: 0, z: 0 })
    expect(hit.kind).toBe('entity')
    expect(hit.id).toBe('img-1')
  })

  it('trifft neben dem Bild nicht', () => {
    const f = makeFixture(withEntity(image))
    expect(pickAt(f, { x: 3, y: 3, z: 0 }).id).not.toBe('img-1')
  })

  it('ignoriert Wasserzeichen - sie werden auch nicht gezeichnet', () => {
    const f = makeFixture(withEntity({ ...image, usage: 'watermark' }))
    expect(pickAt(f, { x: 0, y: 0, z: 0 }).id).not.toBe('img-1')
  })
})

describe('ohne Annotationsebene', () => {
  it('trifft die Linien weiterhin, nur den Text nicht', () => {
    const doc = withEntity(dimension())
    const materials = new MaterialCache(DEFAULT_STYLE, () => undefined)
    const sync = new SceneSync(materials, new EdgeMaterials())
    const snapshot = snapshotOf(doc)
    sync.update(snapshot)
    const camera = new CameraController(() => undefined)
    camera.setSize(WIDTH, HEIGHT)
    camera.setState({ eye: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } })

    const picker = new Picker(sync, camera)
    const line = camera.worldToScreen({ x: 0, y: 1, z: 0 })
    expect(picker.pick(snapshot, line.x, line.y).id).toBe('dim-1')
    // Ohne die Ebene weiss das Picking nichts von der Textgroesse - der Klick
    // auf den Text liegt dann ausserhalb der Toleranz der Masslinie. Genau das
    // belegt, dass der Texttreffer weiter oben nicht zufaellig gelingt.
    expect(picker.pick(snapshot, line.x, line.y - 14 * 0.85).id).not.toBe('dim-1')
  })
})

describe('Geometrie hat weiterhin Vorrang', () => {
  it('liefert die Flaeche, wenn dort keine Annotation liegt', () => {
    const doc = documentWithSquare(2)
    addEntity(doc, dimension({ start: { x: -4, y: -4, z: 0 }, end: { x: -2, y: -4, z: 0 } }))
    const f = makeFixture(doc)
    const hit = pickAt(f, { x: 0, y: 0, z: 0 })
    expect(hit.kind).toBe('face')
  })
})

/* ------------------------------------------------------------------ */

function withEntity(entity: DimensionEntity | TextEntity | ImageEntity): SketchDocument {
  const doc = emptyDocument()
  addEntity(doc, entity)
  return doc
}

function pickAt(f: Fixture, p: Vec3Like) {
  const s = f.camera.worldToScreen(p)
  return f.picker.pick(f.snapshot, s.x, s.y)
}
