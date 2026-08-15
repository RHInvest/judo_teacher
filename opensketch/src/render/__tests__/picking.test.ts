/**
 * Picking.
 *
 * Aufbau: ein 2x2-Quadrat in der XY-Ebene, Kamera 10 Einheiten senkrecht
 * darueber. Dadurch sind Bildschirm- und Modellkoordinaten leicht nachzurechnen
 * (`pixelsPerUnit` ~ 95 px je Meter bei 600 px Hoehe und 35 Grad Blickwinkel).
 *
 * Jeder Kerntest laeuft zweimal: einmal ueber den Kernel-Raycast und einmal
 * ueber die eigenen Render-Puffer. Beide Pfade muessen dasselbe liefern.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { M } from '@/core/math'
import type { Id, SketchDocument, Vec3Like } from '@/shared/types'
import { CameraController } from '../camera'
import { DEFAULT_STYLE } from '../defaults'
import { EdgeMaterials } from '../edges'
import { MaterialCache } from '../materials'
import { Picker, intersectGround, setKernelRaycastEnabled } from '../picking'
import { SceneSync } from '../sceneSync'
import type { RenderSnapshot } from '../snapshot'
import { addInstance, documentWithSquare, firstId, snapshotOf, squareGeometry } from './helpers'

const WIDTH = 800
const HEIGHT = 600

interface Fixture {
  doc: SketchDocument
  snapshot: RenderSnapshot
  sync: SceneSync
  camera: CameraController
  picker: Picker
  faceId: Id
}

function makeFixture(doc: SketchDocument): Fixture {
  const materials = new MaterialCache(DEFAULT_STYLE, () => undefined)
  const edgeMaterials = new EdgeMaterials()
  const sync = new SceneSync(materials, edgeMaterials)
  const snapshot = snapshotOf(doc)
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
  camera.setSceneBounds(sync.modelBounds)

  return {
    doc,
    snapshot,
    sync,
    camera,
    picker: new Picker(sync, camera),
    faceId: firstId(doc.definitions[doc.rootId].geometry.faces),
  }
}

let fixture: Fixture

beforeEach(() => {
  fixture = makeFixture(documentWithSquare(2))
})

afterEach(() => {
  setKernelRaycastEnabled(true)
})

/** Bildschirmposition eines Weltpunkts. */
function screenOf(p: Vec3Like): { x: number; y: number } {
  const s = fixture.camera.worldToScreen(p)
  return { x: s.x, y: s.y }
}

function pickAt(p: Vec3Like) {
  const s = screenOf(p)
  return fixture.picker.pick(fixture.snapshot, s.x, s.y)
}

describe('Aufbau', () => {
  it('haelt Geometrie und Huelle im Cache', () => {
    const build = fixture.sync.getBuild('root')
    expect(build).toBeDefined()
    expect(build?.faceGroups.length).toBe(1)
    // je Dreieck genau eine Flaechen-Id
    expect(build?.faceGroups[0].faceIds.length).toBe((build?.faceGroups[0].indices.length ?? 0) / 3)
    expect(build?.vertexIds.length).toBe(4)
    expect(fixture.sync.records.length).toBe(1)
    expect(fixture.sync.modelBounds.min.x).toBeCloseTo(-1, 6)
    expect(fixture.sync.modelBounds.max.y).toBeCloseTo(1, 6)
  })
})

for (const kernel of [true, false]) {
  describe(`pick (${kernel ? 'Kernel-Raycast' : 'Render-Puffer'})`, () => {
    beforeEach(() => setKernelRaycastEnabled(kernel))

    it('trifft die Flaeche in der Mitte', () => {
      const hit = pickAt({ x: 0, y: 0, z: 0 })
      expect(hit.kind).toBe('face')
      expect(hit.id).toBe(fixture.faceId)
      expect(hit.point.x).toBeCloseTo(0, 4)
      expect(hit.point.y).toBeCloseTo(0, 4)
      expect(hit.point.z).toBeCloseTo(0, 4)
      expect(hit.normal?.z).toBeCloseTo(1, 4)
      expect(hit.distance).toBeCloseTo(10, 3)
      expect(hit.inContext).toBe(true)
      expect(hit.definitionId).toBe('root')
      expect(hit.instancePath).toEqual([])
      expect(hit.topInstanceId).toBeNull()
    })

    it('bevorzugt den Vertex an der Ecke', () => {
      const hit = pickAt({ x: 1, y: 1, z: 0 })
      expect(hit.kind).toBe('vertex')
      expect(hit.point.x).toBeCloseTo(1, 4)
      expect(hit.point.y).toBeCloseTo(1, 4)
    })

    it('bevorzugt die Kante auf der Kantenmitte', () => {
      const hit = pickAt({ x: 1, y: 0, z: 0 })
      expect(hit.kind).toBe('edge')
      const edge = fixture.doc.definitions.root.geometry.edges[hit.id as Id]
      expect(edge).toBeDefined()
      expect(hit.point.x).toBeCloseTo(1, 3)
    })

    it('respektiert die eingeschraenkten Trefferarten', () => {
      const s = screenOf({ x: 1, y: 1, z: 0 })
      const hit = fixture.picker.pick(fixture.snapshot, s.x, s.y, { kinds: ['face'] })
      expect(hit.kind).toBe('face')
    })

    it('ignoriert Primitive aus der Ignorierliste', () => {
      const s = screenOf({ x: 1, y: 1, z: 0 })
      const geometry = fixture.doc.definitions.root.geometry
      const vertexIds = Object.keys(geometry.vertices)
      const hit = fixture.picker.pick(fixture.snapshot, s.x, s.y, { ignore: vertexIds })
      expect(hit.kind).not.toBe('vertex')
    })

    it('faellt neben dem Modell auf die Bodenebene zurueck', () => {
      const hit = pickAt({ x: 4, y: 4, z: 0 })
      expect(hit.kind).toBe('ground')
      expect(hit.point.z).toBeCloseTo(0, 6)
      expect(hit.normal?.z).toBeCloseTo(1, 9)
    })

    it('haelt die Pixeltoleranz unabhaengig vom Zoom', () => {
      // Ein Punkt 5 px neben der Ecke muss in jeder Zoomstufe den Vertex treffen
      for (const distance of [3, 10, 40]) {
        fixture.camera.setState({ eye: { x: 0, y: 0, z: distance }, target: { x: 0, y: 0, z: 0 } })
        const corner = screenOf({ x: 1, y: 1, z: 0 })
        const hit = fixture.picker.pick(fixture.snapshot, corner.x - 5, corner.y + 5)
        expect(hit.kind).toBe('vertex')
      }
    })
  })
}

describe('verschachtelte Instanzen', () => {
  beforeEach(() => {
    const doc = documentWithSquare(2)
    addInstance(doc, 'wand', squareGeometry(2), M.translation({ x: 5, y: 0, z: 0 }))
    fixture = makeFixture(doc)
  })

  it('liefert ausserhalb des Kontexts die Instanz', () => {
    const hit = pickAt({ x: 5, y: 0, z: 0 })
    expect(hit.kind).toBe('instance')
    expect(hit.id).toBe('inst-wand')
    expect(hit.topInstanceId).toBe('inst-wand')
    expect(hit.definitionId).toBe('wand')
    expect(hit.instancePath).toEqual(['inst-wand'])
    expect(hit.inContext).toBe(false)
    expect(hit.point.x).toBeCloseTo(5, 3)
  })

  it('liefert mit deep das Primitiv', () => {
    const s = screenOf({ x: 5, y: 0, z: 0 })
    const hit = fixture.picker.pick(fixture.snapshot, s.x, s.y, { deep: true })
    expect(hit.kind).toBe('face')
    expect(hit.definitionId).toBe('wand')
    expect(hit.inContext).toBe(false)
    // Der Punkt wird in den Weltraum zurueckgerechnet
    expect(hit.point.x).toBeCloseTo(5, 3)
  })

  it('trifft weiterhin die Geometrie des aktiven Kontexts', () => {
    const hit = pickAt({ x: 0, y: 0, z: 0 })
    expect(hit.kind).toBe('face')
    expect(hit.inContext).toBe(true)
  })
})

describe('groundHit', () => {
  it('schneidet die Bodenebene', () => {
    const point = fixture.picker.groundHit(WIDTH / 2, HEIGHT / 2)
    expect(point).not.toBeNull()
    expect(point?.z).toBeCloseTo(0, 9)
  })

  it('liefert null, wenn der Strahl parallel zum Boden laeuft', () => {
    fixture.camera.setState({ eye: { x: 0, y: -10, z: 5 }, target: { x: 0, y: 0, z: 5 } })
    const point = fixture.picker.groundHit(WIDTH / 2, HEIGHT / 2)
    expect(point).toBeNull()
  })
})

describe('intersectGround', () => {
  it('rechnet den Schnittpunkt aus', () => {
    const point = intersectGround({ origin: { x: 0, y: 0, z: 4 }, dir: { x: 0, y: 0, z: -1 } })
    expect(point?.z).toBeCloseTo(0, 9)
  })

  it('ignoriert Strahlen, die vom Boden wegzeigen', () => {
    expect(intersectGround({ origin: { x: 0, y: 0, z: 4 }, dir: { x: 0, y: 0, z: 1 } })).toBeNull()
    expect(intersectGround({ origin: { x: 0, y: 0, z: 4 }, dir: { x: 1, y: 0, z: 0 } })).toBeNull()
  })
})

describe('pickRect', () => {
  it('waehlt bei umschliessendem Rahmen alles aus', () => {
    const selection = fixture.picker.pickRect(fixture.snapshot, 0, 0, WIDTH, HEIGHT, false)
    expect(selection.vertexIds.length).toBe(4)
    expect(selection.edgeIds.length).toBe(4)
    expect(selection.faceIds).toEqual([fixture.faceId])
  })

  it('nimmt beim Umschliessen nur vollstaendig enthaltene Kanten', () => {
    const corner = screenOf({ x: 1, y: 1, z: 0 })
    const selection = fixture.picker.pickRect(
      fixture.snapshot,
      corner.x - 20,
      corner.y - 20,
      corner.x + 20,
      corner.y + 20,
      false,
    )
    expect(selection.vertexIds.length).toBe(1)
    expect(selection.edgeIds.length).toBe(0)
    expect(selection.faceIds.length).toBe(0)
  })

  it('nimmt beim Beruehren auch angeschnittene Kanten', () => {
    const corner = screenOf({ x: 1, y: 1, z: 0 })
    const selection = fixture.picker.pickRect(
      fixture.snapshot,
      corner.x - 20,
      corner.y - 20,
      corner.x + 20,
      corner.y + 20,
      true,
    )
    expect(selection.vertexIds.length).toBe(1)
    expect(selection.edgeIds.length).toBe(2)
    expect(selection.faceIds.length).toBe(1)
  })

  it('waehlt nichts, wenn der Rahmen daneben liegt', () => {
    const selection = fixture.picker.pickRect(fixture.snapshot, 5, 5, 25, 25, true)
    expect(selection.vertexIds.length).toBe(0)
    expect(selection.edgeIds.length).toBe(0)
    expect(selection.faceIds.length).toBe(0)
  })

  it('waehlt Instanzen des aktiven Kontexts', () => {
    const doc = documentWithSquare(2)
    addInstance(doc, 'wand', squareGeometry(2), M.translation({ x: 5, y: 0, z: 0 }))
    fixture = makeFixture(doc)
    const selection = fixture.picker.pickRect(fixture.snapshot, 0, 0, WIDTH, HEIGHT, true)
    expect(selection.entityIds).toContain('inst-wand')
  })
})

describe('pickLasso', () => {
  it('waehlt aus, was im Polygon liegt', () => {
    const selection = fixture.picker.pickLasso(
      fixture.snapshot,
      [
        { x: 0, y: 0 },
        { x: WIDTH, y: 0 },
        { x: WIDTH, y: HEIGHT },
        { x: 0, y: HEIGHT },
      ],
      false,
    )
    expect(selection.vertexIds.length).toBe(4)
    expect(selection.faceIds.length).toBe(1)
  })

  it('ignoriert entartete Polygone', () => {
    const selection = fixture.picker.pickLasso(fixture.snapshot, [{ x: 1, y: 1 }], true)
    expect(selection.vertexIds.length).toBe(0)
  })

  it('waehlt nichts ausserhalb', () => {
    const selection = fixture.picker.pickLasso(
      fixture.snapshot,
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
      true,
    )
    expect(selection.vertexIds.length).toBe(0)
    expect(selection.edgeIds.length).toBe(0)
  })
})

describe('leeres Dokument', () => {
  it('liefert einen leeren Treffer', () => {
    const materials = new MaterialCache(DEFAULT_STYLE, () => undefined)
    const sync = new SceneSync(materials, new EdgeMaterials())
    const camera = new CameraController(() => undefined)
    camera.setSize(WIDTH, HEIGHT)
    const picker = new Picker(sync, camera)
    const snapshot = snapshotOf(null)
    const hit = picker.pick(snapshot, 400, 300)
    expect(['none', 'ground']).toContain(hit.kind)
    expect(picker.pickRect(snapshot, 0, 0, 100, 100, true).faceIds.length).toBe(0)
  })
})
