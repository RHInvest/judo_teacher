/**
 * Nachpruefung der Picking-Divergenz zwischen Kernel und Render-Puffern.
 *
 * Vorgeschichte: ein Klick genau auf eine Flaechenkante lieferte ueber den
 * Kernel 'none', ueber die Render-Puffer 'face'. Die Ursache lag nicht im
 * Dreieckstest - den teilen sich beide Pfade - sondern in der Kandidatensuche
 * der BVH (Kantenpfad weitete um `max(tolerance, POINT_TOL)` auf, Flaechenpfad
 * um 0) und darin, dass `faceTriangles()` aus dem Float32-Puffer las, waehrend
 * die BVH-Boxen float64 fuehrten.
 *
 * Diese Tests halten den behobenen Zustand fest. Sie pruefen absichtlich
 * `core.raycast` DIREKT, nicht ueber den `Picker` - sonst wuerde der Rueckfall
 * auf die Render-Puffer (picking.ts) einen Rueckfall der Kernel-Korrektur
 * verdecken.
 */

import { describe, expect, it } from 'vitest'
import * as core from '@/core'
import type { Geometry, Vec3Like } from '@/shared/types'
import { emptyGeometry } from '@/shared/types'

/** Rechteck 4x3 m in der XY-Ebene, linke untere Ecke bei `origin`. */
function rectangle(origin: Vec3Like = { x: 0, y: 0, z: 0 }): Geometry {
  const geom = emptyGeometry()
  core.addFacePolygon(geom, [
    { x: origin.x, y: origin.y, z: origin.z },
    { x: origin.x + 4, y: origin.y, z: origin.z },
    { x: origin.x + 4, y: origin.y + 3, z: origin.z },
    { x: origin.x, y: origin.y + 3, z: origin.z },
  ])
  return geom
}

function downRay(x: number, y: number): { origin: Vec3Like; dir: Vec3Like } {
  return { origin: { x, y, z: 10 }, dir: { x: 0, y: 0, z: -1 } }
}

describe('core.raycast am Flaechenrand', () => {
  it('trifft die Flaeche noch bei 1e-14 ausserhalb der Kante', () => {
    const geom = rectangle()
    const hits = core.raycast(geom, downRay(4 + 1e-14, 1.5), { kinds: ['face'] })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].kind).toBe('face')
    expect(hits[0].id).toBe(Object.keys(geom.faces)[0])
    expect(hits[0].point.z).toBeCloseTo(0, 9)
    expect(hits[0].distance).toBeCloseTo(10, 9)
  })

  it('trifft sie auch bei grossen Koordinaten (frueher Float32-Versatz)', () => {
    // Bei 1234,5678 lag die Float32-Triangulierung 0,05 mm neben den float64
    // BVH-Boxen - das Fuenffache von POINT_TOL und damit genug, um die Flaeche
    // aus der Kandidatensuche zu werfen.
    const base = { x: 1234.5678, y: 987.6543, z: 0 }
    const geom = rectangle(base)
    const hits = core.raycast(geom, downRay(base.x + 4 + 1e-14, base.y + 1.5), { kinds: ['face'] })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].kind).toBe('face')
  })

  it('trifft in der Mitte unveraendert', () => {
    const geom = rectangle()
    const hits = core.raycast(geom, downRay(2, 1.5), { kinds: ['face'] })
    expect(hits.map((h) => h.kind)).toContain('face')
  })

  /**
   * Bewusst NICHT behoben: `tolerance` weitet nur Kanten und Vertices auf.
   * Wer 5 cm neben der Flaeche klickt, bekommt bei 10 cm Toleranz die Kante,
   * aber keine Flaeche. Der Rueckfall in `picking.ts` aendert daran nichts, er
   * greift nur bei komplett leerem Kernel-Ergebnis.
   */
  it('weitet Flaechen NICHT um die Toleranz auf', () => {
    const geom = rectangle()
    const hits = core.raycast(geom, downRay(4.05, 1.5), { kinds: ['face', 'edge'], tolerance: 0.1 })
    expect(hits.map((h) => h.kind)).toContain('edge')
    expect(hits.map((h) => h.kind)).not.toContain('face')
  })
})
