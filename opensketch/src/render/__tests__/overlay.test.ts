/**
 * Overlay im Immediate-Mode.
 *
 * Der Renderer leert das Overlay vor jedem `draw()` (ARCHITECTURE.md, 7).
 * Entscheidend ist deshalb: die Puffer wachsen ueber Frames hinweg NICHT, die
 * Segmentzahl steht nach `flush()` korrekt in der Geometrie, und ungueltige
 * Eingaben der Werkzeuge landen nie im Puffer.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { OverlayRenderer } from '../overlay'
import { vec } from './helpers'

function newOverlay(): OverlayRenderer {
  const overlay = new OverlayRenderer({
    worldToScreen: (p) => ({ x: p.x * 10 + 400, y: 300 - p.y * 10, depth: 0, visible: true }),
    pixelsPerUnit: () => 10,
    getSize: () => ({ width: 800, height: 600 }),
  })
  overlay.setSize(800, 600)
  return overlay
}

/** Summe der Instanzen aller Liniensammlungen - das, was die GPU zeichnet. */
function segmentCount(overlay: OverlayRenderer): number {
  let total = 0
  for (const child of overlay.group.children) {
    const line = child as LineSegments2
    const geometry = line.geometry as THREE.InstancedBufferGeometry | undefined
    if (!geometry || typeof geometry.instanceCount !== 'number') continue
    if (line.visible) total += geometry.instanceCount
  }
  return total
}

/** Dreiecke aller Fuellungen - die Puffer sind unindiziert und nutzen drawRange. */
function fillTriangles(overlay: OverlayRenderer): number {
  let total = 0
  for (const child of overlay.group.children) {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) continue
    total += mesh.geometry.drawRange.count / 3
  }
  return total
}

/** Minimaler 2D-Kontext, der nur mitschreibt. */
function fakeContext(): CanvasRenderingContext2D {
  const calls: string[] = []
  const handler = new Proxy(
    { calls },
    {
      get(target: { calls: string[] }, prop: string) {
        if (prop === 'calls') return target.calls
        return (...args: unknown[]) => {
          target.calls.push(`${prop}(${args.join(',')})`)
        }
      },
      set() {
        return true
      },
    },
  )
  return handler as unknown as CanvasRenderingContext2D
}

describe('OverlayRenderer - Linienpuffer', () => {
  it('sammelt Segmente und meldet sie erst nach flush an die Geometrie', () => {
    const overlay = newOverlay()
    overlay.line(vec(0, 0, 0), vec(1, 0, 0))
    overlay.line(vec(1, 0, 0), vec(1, 1, 0))
    expect(segmentCount(overlay)).toBe(0)

    overlay.flush()
    expect(segmentCount(overlay)).toBe(2)
    overlay.dispose()
  })

  it('wiederverwendet den Puffer, statt ihn pro Frame wachsen zu lassen', () => {
    const overlay = newOverlay()
    for (let frame = 0; frame < 5; frame++) {
      overlay.clear()
      overlay.polyline([vec(0, 0, 0), vec(1, 0, 0), vec(1, 1, 0)], true, { width: 2 })
      overlay.flush()
      // geschlossener Zug aus 3 Punkten = 3 Segmente, in JEDEM Frame
      expect(segmentCount(overlay)).toBe(3)
    }
    // ein einziges Linienobjekt fuer alle Frames
    expect(overlay.group.children.length).toBe(1)
    overlay.dispose()
  })

  it('trennt Sammlungen nach Stil, aber nicht innerhalb desselben Stils', () => {
    const overlay = newOverlay()
    overlay.line(vec(0, 0, 0), vec(1, 0, 0), { width: 1 })
    overlay.line(vec(0, 1, 0), vec(1, 1, 0), { width: 1 })
    overlay.line(vec(0, 2, 0), vec(1, 2, 0), { width: 3, dashed: true })
    overlay.flush()

    expect(overlay.group.children.length).toBe(2)
    expect(segmentCount(overlay)).toBe(3)
    overlay.dispose()
  })

  it('verwirft unendliche Punkte, statt NaN in den Puffer zu schreiben', () => {
    const overlay = newOverlay()
    overlay.line(vec(0, 0, 0), vec(Number.NaN, 0, 0))
    overlay.line(vec(0, 0, 0), vec(Number.POSITIVE_INFINITY, 0, 0))
    overlay.polyline([vec(0, 0, 0)], false)
    overlay.flush()

    expect(segmentCount(overlay)).toBe(0)
    overlay.dispose()
  })

  it('zeichnet die zwoelf Kanten einer Huelle', () => {
    const overlay = newOverlay()
    overlay.box({ min: vec(0, 0, 0), max: vec(1, 2, 3) })
    overlay.flush()
    expect(segmentCount(overlay)).toBe(12)

    // leere Huelle liefert nichts
    overlay.clear()
    overlay.box({ min: vec(1, 1, 1), max: vec(-1, -1, -1) })
    overlay.flush()
    expect(segmentCount(overlay)).toBe(0)
    overlay.dispose()
  })
})

describe('OverlayRenderer - Fuellungen', () => {
  it('trianguliert ein Vieleck als Faecher', () => {
    const overlay = newOverlay()
    overlay.polygonFill([vec(0, 0, 0), vec(1, 0, 0), vec(1, 1, 0), vec(0, 1, 0)])
    overlay.flush()
    expect(fillTriangles(overlay)).toBe(2)

    overlay.clear()
    overlay.flush()
    expect(fillTriangles(overlay)).toBe(0)
    overlay.dispose()
  })

  it('uebernimmt rohe Vorschau-Meshes und weist unbrauchbare ab', () => {
    const overlay = newOverlay()
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    overlay.ghost(positions, new Uint32Array([0, 1, 2]))
    overlay.ghost(new Float32Array([0, 0, 0]), new Uint32Array([0, 1, 2]))
    overlay.flush()
    expect(fillTriangles(overlay)).toBe(1)
    overlay.dispose()
  })
})

describe('OverlayRenderer - Bildschirmebene', () => {
  it('meldet Bildschirminhalt nur, wenn welcher da ist', () => {
    const overlay = newOverlay()
    expect(overlay.hasScreenContent).toBe(false)

    overlay.line(vec(0, 0, 0), vec(1, 0, 0))
    expect(overlay.hasScreenContent).toBe(false)

    overlay.text(vec(0, 0, 0), 'Laenge 1,5 m')
    expect(overlay.hasScreenContent).toBe(true)

    overlay.clear()
    expect(overlay.hasScreenContent).toBe(false)
    overlay.dispose()
  })

  it('ignoriert leeren Text und Marker "none"', () => {
    const overlay = newOverlay()
    overlay.text(vec(0, 0, 0), '')
    overlay.point(vec(0, 0, 0), 'none')
    expect(overlay.hasScreenContent).toBe(false)

    overlay.point(vec(0, 0, 0), 'square')
    expect(overlay.hasScreenContent).toBe(true)
    overlay.dispose()
  })

  it('zeichnet Rechteck, Marker und Text in den 2D-Kontext', () => {
    const overlay = newOverlay()
    overlay.screenRect(10, 20, 110, 70, { fill: '#ffffff33' })
    overlay.point(vec(0, 0, 0), 'square')
    overlay.text(vec(0, 0, 0), 'Ecke')

    const ctx = fakeContext()
    overlay.draw2d(ctx)
    const calls = (ctx as unknown as { calls: string[] }).calls.join(' ')

    expect(calls).toContain('moveTo(10,20)')
    expect(calls).toContain('fill(')
    expect(calls).toContain('fillText(Ecke')
    overlay.dispose()
  })

  it('zeichnet einen gestrichelten Bildschirmzug mit Strichmuster', () => {
    const overlay = newOverlay()
    overlay.screenPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      false,
      { dashed: true },
    )
    const ctx = fakeContext()
    overlay.draw2d(ctx)
    const calls = (ctx as unknown as { calls: string[] }).calls.join(' ')

    expect(calls).toContain('setLineDash(')
    expect(calls).toContain('stroke(')
    overlay.dispose()
  })
})
