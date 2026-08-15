/**
 * Kamerasteuerung.
 *
 * Die Tests pruefen die Eigenschaften, die das SketchUp-Gefuehl ausmachen:
 * waagerechter Horizont beim Orbit, kein Ueberkippen, distanzabhaengiges
 * Schwenken, Zoomen mit festem Punkt unter dem Cursor, Projektionswechsel mit
 * erhaltenem Bildausschnitt und die Zwei-Punkt-Perspektive.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { B, V } from '@/core/math'
import type { BBox3Like, Vec3Like } from '@/shared/types'
import { CameraController } from '../camera'

const WIDTH = 800
const HEIGHT = 600

let changes = 0
let cam: CameraController

beforeEach(() => {
  changes = 0
  cam = new CameraController(() => {
    changes++
  })
  cam.setSize(WIDTH, HEIGHT)
  cam.setState({
    eye: { x: 0, y: 0, z: 10 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    fov: 35,
    projection: 'perspective',
    orthoHeight: 5,
  })
})

/** Schnittpunkt eines Bildschirmpunkts mit der Ebene z = 0. */
function groundAt(controller: CameraController, x: number, y: number): Vec3Like | null {
  const ray = controller.screenToRay(x, y)
  if (Math.abs(ray.dir.z) < 1e-9) return null
  const t = -ray.origin.z / ray.dir.z
  return V.addScaled(ray.origin, ray.dir, t)
}

describe('Grundzustand', () => {
  it('meldet jede Aenderung', () => {
    const before = changes
    cam.orbit(10, 0)
    expect(changes).toBeGreaterThan(before)
  })

  it('liefert Kopien des Zustands', () => {
    const a = cam.getState()
    a.eye.x = 999
    expect(cam.getState().eye.x).toBe(0)
  })

  it('kennt Distanz und Blickrichtung', () => {
    expect(cam.distance).toBeCloseTo(10, 9)
    const dir = cam.viewDirection
    expect(dir.z).toBeCloseTo(-1, 9)
  })
})

describe('orbit', () => {
  it('haelt Abstand und Ziel fest', () => {
    cam.setState({ eye: { x: 8, y: -8, z: 6 }, target: { x: 1, y: 1, z: 1 } })
    const distance = cam.distance
    cam.orbit(120, 60)
    const s = cam.getState()
    expect(cam.distance).toBeCloseTo(distance, 6)
    expect(s.target.x).toBeCloseTo(1, 9)
    expect(s.target.y).toBeCloseTo(1, 9)
    expect(s.target.z).toBeCloseTo(1, 9)
  })

  it('haelt den Horizont waagerecht', () => {
    cam.setState({ eye: { x: 6, y: -6, z: 4 }, target: { x: 0, y: 0, z: 0 } })
    cam.orbit(37, 23)
    const up = cam.getState().up
    expect(up.x).toBeCloseTo(0, 9)
    expect(up.y).toBeCloseTo(0, 9)
    expect(up.z).toBeCloseTo(1, 9)
  })

  it('kippt nicht ueber den Pol', () => {
    cam.setState({ eye: { x: 0, y: -10, z: 0 }, target: { x: 0, y: 0, z: 0 } })
    cam.orbit(0, 100000)
    const above = cam.getState().eye.z
    expect(above).toBeGreaterThan(0)
    cam.orbit(0, -100000)
    expect(cam.getState().eye.z).toBeLessThan(0)
  })
})

describe('pan', () => {
  it('verschiebt Auge und Ziel gleich', () => {
    const before = cam.getState()
    cam.pan(50, 25)
    const after = cam.getState()
    const deltaEye = V.sub(after.eye, before.eye)
    const deltaTarget = V.sub(after.target, before.target)
    expect(deltaEye.x).toBeCloseTo(deltaTarget.x, 9)
    expect(deltaEye.y).toBeCloseTo(deltaTarget.y, 9)
    expect(deltaEye.z).toBeCloseTo(deltaTarget.z, 9)
    expect(V.length(deltaEye)).toBeGreaterThan(0)
  })

  it('schwenkt in groesserer Entfernung weiter', () => {
    cam.pan(100, 0)
    const near = V.length(V.sub(cam.getState().target, { x: 0, y: 0, z: 0 }))

    cam.setState({ eye: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 } })
    cam.pan(100, 0)
    const far = V.length(V.sub(cam.getState().target, { x: 0, y: 0, z: 0 }))
    expect(far).toBeGreaterThan(near * 5)
  })
})

describe('dolly', () => {
  it('zoomt heran und heraus', () => {
    const start = cam.distance
    cam.dolly(1)
    expect(cam.distance).toBeLessThan(start)
    cam.dolly(-1)
    expect(cam.distance).toBeCloseTo(start, 6)
  })

  it('haelt den Punkt unter dem Cursor fest', () => {
    const screen = { x: 220, y: 180 }
    const before = groundAt(cam, screen.x, screen.y) as Vec3Like
    cam.dolly(3, screen)
    const after = cam.worldToScreen(before)
    expect(after.x).toBeCloseTo(screen.x, 3)
    expect(after.y).toBeCloseTo(screen.y, 3)
  })

  it('haelt den Punkt auch in der Parallelprojektion fest', () => {
    cam.setProjection('parallel')
    const screen = { x: 600, y: 120 }
    const before = groundAt(cam, screen.x, screen.y) as Vec3Like
    cam.dolly(2, screen)
    const after = cam.worldToScreen(before)
    expect(after.x).toBeCloseTo(screen.x, 3)
    expect(after.y).toBeCloseTo(screen.y, 3)
  })

  it('ignoriert unsinnige Werte', () => {
    const before = cam.getState()
    cam.dolly(Number.NaN)
    expect(cam.getState().eye.z).toBeCloseTo(before.eye.z, 9)
  })
})

describe('Projektion', () => {
  it('behaelt den Bildausschnitt beim Wechsel bei', () => {
    const probe: Vec3Like = { x: 1.5, y: 0.8, z: 0 }
    const before = cam.worldToScreen(probe)
    cam.setProjection('parallel')
    const parallel = cam.worldToScreen(probe)
    expect(parallel.x).toBeCloseTo(before.x, 0)
    expect(parallel.y).toBeCloseTo(before.y, 0)

    cam.setProjection('perspective')
    const back = cam.worldToScreen(probe)
    expect(back.x).toBeCloseTo(before.x, 3)
    expect(back.y).toBeCloseTo(before.y, 3)
    expect(cam.distance).toBeCloseTo(10, 3)
  })

  it('haelt Senkrechte in der Zwei-Punkt-Perspektive senkrecht', () => {
    cam.setState({ eye: { x: 10, y: -10, z: 6 }, target: { x: 0, y: 0, z: 0 } })
    const bottom: Vec3Like = { x: 2, y: 1, z: 0 }
    const top: Vec3Like = { x: 2, y: 1, z: 4 }

    const normalBottom = cam.worldToScreen(bottom)
    const normalTop = cam.worldToScreen(top)
    expect(Math.abs(normalTop.x - normalBottom.x)).toBeGreaterThan(1)

    cam.setTwoPointPerspective(true)
    const twoBottom = cam.worldToScreen(bottom)
    const twoTop = cam.worldToScreen(top)
    expect(Math.abs(twoTop.x - twoBottom.x)).toBeLessThan(0.001)
  })
})

describe('Einpassen', () => {
  const box: BBox3Like = { min: { x: -3, y: -2, z: 0 }, max: { x: 3, y: 2, z: 5 } }

  it('bringt die ganze Huelle ins Bild', () => {
    cam.zoomToBounds(box, false)
    for (const corner of B.corners(box)) {
      const screen = cam.worldToScreen(corner)
      expect(screen.x).toBeGreaterThanOrEqual(-1)
      expect(screen.x).toBeLessThanOrEqual(WIDTH + 1)
      expect(screen.y).toBeGreaterThanOrEqual(-1)
      expect(screen.y).toBeLessThanOrEqual(HEIGHT + 1)
    }
    const center = B.center(box)
    const projected = cam.worldToScreen(center)
    expect(projected.x).toBeCloseTo(WIDTH / 2, 3)
    expect(projected.y).toBeCloseTo(HEIGHT / 2, 3)
  })

  it('ignoriert leere Huellen', () => {
    const before = cam.getState()
    cam.zoomToBounds(B.empty(), false)
    expect(cam.getState().eye.z).toBeCloseTo(before.eye.z, 9)
  })

  it('zoomt ein Fenster auf', () => {
    const before = cam.distance
    cam.zoomWindow(300, 200, 500, 400)
    expect(cam.distance).toBeLessThan(before)
  })

  it('ignoriert zu kleine Fenster', () => {
    const before = cam.distance
    cam.zoomWindow(300, 200, 302, 202)
    expect(cam.distance).toBeCloseTo(before, 9)
  })
})

describe('Standardansichten', () => {
  it('setzt die Draufsicht ueber das Ziel', () => {
    cam.setState({ eye: { x: 5, y: -5, z: 5 }, target: { x: 0, y: 0, z: 0 } })
    const distance = cam.distance
    cam.setStandardView('top', false)
    const s = cam.getState()
    expect(s.eye.x).toBeCloseTo(0, 6)
    expect(s.eye.y).toBeCloseTo(0, 6)
    expect(s.eye.z).toBeCloseTo(distance, 6)
    expect(s.up.y).toBeCloseTo(1, 6)
  })

  it('setzt die Vorderansicht in -Y', () => {
    cam.setStandardView('front', false)
    const s = cam.getState()
    expect(s.eye.y).toBeLessThan(0)
    expect(s.eye.z).toBeCloseTo(0, 6)
    expect(s.up.z).toBeCloseTo(1, 6)
  })
})

describe('Animation', () => {
  it('laeuft von der Start- zur Zielstellung', () => {
    const to = { ...cam.getState(), eye: { x: 0, y: -20, z: 0 } }
    cam.animateTo(to, 400)
    expect(cam.animating).toBe(true)

    const start = performance.now()
    expect(cam.tick(start + 200)).toBe(true)
    const mid = cam.getState().eye
    expect(mid.y).toBeLessThan(0)
    expect(cam.distance).toBeCloseTo(10, 3)

    expect(cam.tick(start + 1000)).toBe(false)
    expect(cam.animating).toBe(false)
    const end = cam.getState().eye
    expect(end.y).toBeCloseTo(-20, 6)
  })

  it('springt bei sehr kurzer Dauer sofort', () => {
    const to = { ...cam.getState(), eye: { x: 3, y: 3, z: 3 } }
    cam.animateTo(to, 0)
    expect(cam.animating).toBe(false)
    expect(cam.getState().eye.x).toBeCloseTo(3, 9)
  })

  it('bricht bei Navigation ab', () => {
    cam.animateTo({ ...cam.getState(), eye: { x: 0, y: -30, z: 0 } }, 500)
    cam.orbit(10, 0)
    expect(cam.animating).toBe(false)
  })
})

describe('Projektionshilfen', () => {
  it('bildet Bildschirmmitte auf die Blickrichtung ab', () => {
    const ray = cam.screenToRay(WIDTH / 2, HEIGHT / 2)
    const dir = cam.viewDirection
    expect(ray.dir.x).toBeCloseTo(dir.x, 6)
    expect(ray.dir.y).toBeCloseTo(dir.y, 6)
    expect(ray.dir.z).toBeCloseTo(dir.z, 6)
  })

  it('projiziert das Ziel in die Bildmitte', () => {
    const screen = cam.worldToScreen(cam.getState().target)
    expect(screen.x).toBeCloseTo(WIDTH / 2, 6)
    expect(screen.y).toBeCloseTo(HEIGHT / 2, 6)
    expect(screen.visible).toBe(true)
  })

  it('rechnet Modelleinheiten in Pixel um', () => {
    const ppu = cam.pixelsPerUnit({ x: 0, y: 0, z: 0 })
    const expected = HEIGHT / (2 * Math.tan((35 * Math.PI) / 360) * 10)
    expect(ppu).toBeCloseTo(expected, 6)

    // Zwei Punkte im Abstand einer Einheit liegen ppu Pixel auseinander
    const a = cam.worldToScreen({ x: 0, y: 0, z: 0 })
    const b = cam.worldToScreen({ x: 1, y: 0, z: 0 })
    expect(Math.abs(b.x - a.x)).toBeCloseTo(ppu, 3)
  })

  it('rechnet in der Parallelprojektion unabhaengig von der Tiefe', () => {
    cam.setProjection('parallel')
    const near = cam.pixelsPerUnit({ x: 0, y: 0, z: 0 })
    const far = cam.pixelsPerUnit({ x: 0, y: 0, z: -50 })
    expect(near).toBeCloseTo(far, 9)
  })
})

describe('positionCamera', () => {
  it('setzt den Augenpunkt auf Augenhoehe und blickt waagerecht', () => {
    cam.positionCamera({ x: 1, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }, 1.7)
    const s = cam.getState()
    expect(s.eye.z).toBeCloseTo(1.7, 9)
    expect(s.target.z).toBeCloseTo(1.7, 9)
    expect(s.projection).toBe('perspective')
  })
})
