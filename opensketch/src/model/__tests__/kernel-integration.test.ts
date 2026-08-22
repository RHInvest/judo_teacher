/**
 * Zusammenspiel Store <-> Geometriekern.
 *
 * Prueft, dass der Store den echten Kernel benutzt (nicht die Fallbacks in
 * `geometry-utils.ts`), dass Weltkoordinaten korrekt umgerechnet ankommen und
 * dass noch fehlende Kernelfunktionen sauber als Hinweis durchgereicht werden.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { emptySelection } from '@/shared/types'
import { M } from '@/core/math'
import * as core from '@/core'
import { useStore, resetStoreForTests } from '../store'
import { isSolid, solidVolume } from '../geometry-utils'
import { buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
})

const geom = () => useStore.getState().getActiveGeometry()

describe('Der Kern wird wirklich benutzt', () => {
  it('bildet aus einem geschlossenen Linienzug automatisch eine Flaeche', () => {
    // Der Fallback in geometry-utils erzeugt KEINE Flaechen - dieser Test
    // schlaegt also fehl, sobald der Kernel nicht mehr greift.
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      true,
    )
    const g = geom()
    expect(Object.keys(g.vertices)).toHaveLength(4)
    expect(Object.keys(g.edges)).toHaveLength(4)
    expect(Object.keys(g.faces)).toHaveLength(1)

    const faceId = Object.keys(g.faces)[0]
    expect(core.faceArea(g, faceId)).toBeCloseTo(4, 6)
  })

  it('teilt sich kreuzende Kanten am Schnittpunkt', () => {
    const s = useStore.getState()
    s.addEdge({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })
    useStore.getState().addEdge({ x: 2, y: -2, z: 0 }, { x: 2, y: 2, z: 0 })

    const g = geom()
    // Aus zwei Kanten werden vier, mit einem gemeinsamen Punkt in der Mitte
    expect(Object.keys(g.edges).length).toBeGreaterThanOrEqual(4)
    const crossing = Object.keys(g.vertices).find((id) => g.vertices[id].edges.length === 4)
    expect(crossing).toBeDefined()
  })

  it('pushPull macht aus einer Flaeche einen geschlossenen Koerper', () => {
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      true,
    )
    const faceId = Object.keys(geom().faces)[0]
    const change = useStore.getState().pushPull(faceId, 4)

    expect(change.addedFaces.length).toBeGreaterThan(0)
    const g = geom()
    expect(isSolid(g)).toBe(true)
    expect(solidVolume(g)).toBeCloseTo(24, 4)
    expect(useStore.getState().ui.toasts).toHaveLength(0)
  })

  it('pushPull laesst sich rueckgaengig machen', () => {
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      true,
    )
    const before = Object.keys(geom().faces).length
    const faceId = Object.keys(geom().faces)[0]
    useStore.getState().pushPull(faceId, 2)
    expect(Object.keys(geom().faces).length).toBeGreaterThan(before)

    useStore.getState().undo()
    expect(Object.keys(geom().faces)).toHaveLength(before)
    expect(isSolid(geom())).toBe(false)
  })

  it('pushPull rechnet eine Weltrichtung in den Kontextraum um', () => {
    // Gruppe bei (5,5,0) betreten und darin nach oben ziehen
    installGeometry(buildQuad({ x: 5, y: 5, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Klotz') as string
    useStore.getState().enterContext(instanceId)

    const faceId = Object.keys(geom().faces)[0]
    useStore.getState().pushPull(faceId, 2, { direction: { x: 0, y: 0, z: 1 } })

    const g = geom()
    expect(isSolid(g)).toBe(true)
    // Der Koerper steht lokal zwischen z=0 und z=2 ...
    const zs = Object.keys(g.vertices).map((id) => g.vertices[id].p.z)
    expect(Math.min(...zs)).toBeCloseTo(0, 6)
    expect(Math.max(...zs)).toBeCloseTo(2, 6)
    // ... und in der Welt an x=5, y=5
    useStore.getState().selectAll()
    const bounds = useStore.getState().getSelectionBounds()
    expect(bounds?.min.x).toBeCloseTo(5, 6)
    expect(bounds?.min.y).toBeCloseTo(5, 6)
  })

  it('mergeGeometry beim Aufloesen kommt aus dem Kern und verschweisst Punkte', () => {
    // Zwei Rechtecke, die eine Kante teilen: eines in einer Gruppe
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      true,
    )
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Teil') as string

    useStore.getState().addPolyline(
      [
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      true,
    )
    expect(Object.keys(geom().vertices)).toHaveLength(4)

    useStore.getState().explode([instanceId])
    const g = geom()
    // Die gemeinsame Kante wird verschweisst: 6 statt 8 Punkte
    expect(Object.keys(g.vertices)).toHaveLength(6)
    expect(Object.keys(g.faces)).toHaveLength(2)
  })
})

describe('Kernel-Luecken', () => {
  it('offsetFace liefert echte Geometrie - keine Luecke mehr', async () => {
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      true,
    )
    const faceId = Object.keys(geom().faces)[0]
    const change = useStore.getState().offsetFace(faceId, -0.5)
    expect(change.addedEdges.length).toBeGreaterThan(0)

    // Kein Hinweis-Toast: der Kern kennt die Funktion (Toast kaeme als Microtask)
    await Promise.resolve()
    await Promise.resolve()
    expect(useStore.getState().ui.toasts.filter((t) => t.kind === 'warn')).toHaveLength(0)
    expect(useStore.getState().canUndo()).toBe(true)
  })

  it('eine nicht vorhandene Kernelfunktion wuerde sauber als Hinweis enden', async () => {
    // Simuliert eine Luecke ueber eine Flaechen-Id, die es nicht gibt: der Store
    // darf weder werfen noch einen leeren Undo-Schritt erzeugen.
    installGeometry(buildQuad())
    useStore.getState().clearHistory()
    const change = useStore.getState().pushPull('gibtesnicht', 1)
    expect(change.addedFaces).toHaveLength(0)
    expect(useStore.getState().canUndo()).toBe(false)
  })
})

describe('Cache-Invalidierung', () => {
  it('Triangulierung folgt einer Verschiebung der Geometrie', () => {
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      true,
    )
    const faceId = Object.keys(geom().faces)[0]
    const before = core.triangulateFace(geom(), faceId)
    expect(before.positions.length).toBeGreaterThan(0)
    const zBefore = before.positions[2]

    useStore.getState().selectAll()
    useStore.getState().transformPrimitives(
      useStore.getState().selection,
      M.translation({ x: 0, y: 0, z: 5 }),
      false,
    )

    const after = core.triangulateFace(geom(), faceId)
    expect(after.positions[2]).toBeCloseTo(zBefore + 5, 6)
  })

  it('Undo stellt auch die Triangulierung wieder her', () => {
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      true,
    )
    const faceId = Object.keys(geom().faces)[0]
    const zBefore = core.triangulateFace(geom(), faceId).positions[2]

    useStore.getState().selectAll()
    useStore.getState().transformPrimitives(
      useStore.getState().selection,
      M.translation({ x: 0, y: 0, z: 7 }),
      false,
    )
    core.triangulateFace(geom(), faceId)

    useStore.getState().undo()
    expect(core.triangulateFace(geom(), faceId).positions[2]).toBeCloseTo(zBefore, 6)
  })

  it('Raycast trifft die Geometrie nach einer Aenderung an der neuen Stelle', () => {
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      true,
    )
    const down = { origin: { x: 1, y: 1, z: 10 }, dir: { x: 0, y: 0, z: -1 } }
    const first = core.raycast(geom(), down, { kinds: ['face'] })
    expect(first.length).toBeGreaterThan(0)
    expect(first[0].point.z).toBeCloseTo(0, 6)

    useStore.getState().selectAll()
    useStore.getState().transformPrimitives(
      useStore.getState().selection,
      M.translation({ x: 0, y: 0, z: 3 }),
      false,
    )
    useStore.getState().setSelection(emptySelection())

    const second = core.raycast(geom(), down, { kinds: ['face'] })
    expect(second.length).toBeGreaterThan(0)
    expect(second[0].point.z).toBeCloseTo(3, 6)
  })

  it('auch wenn sich die Anzahl der Primitive gar nicht aendert', () => {
    // Der raeumliche Index ist nur ueber die Primitivanzahlen signiert - eine
    // reine Punktverschiebung wuerde er ohne Verwerfen nicht bemerken.
    useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      true,
    )
    const down = { origin: { x: 1, y: 1, z: 10 }, dir: { x: 0, y: 0, z: -1 } }
    expect(core.raycast(geom(), down, { kinds: ['face'] })[0].point.z).toBeCloseTo(0, 6)

    const countBefore = {
      vertices: Object.keys(geom().vertices).length,
      edges: Object.keys(geom().edges).length,
      faces: Object.keys(geom().faces).length,
    }
    useStore.getState().moveVertices(Object.keys(geom().vertices), { x: 0, y: 0, z: 4 })
    expect({
      vertices: Object.keys(geom().vertices).length,
      edges: Object.keys(geom().edges).length,
      faces: Object.keys(geom().faces).length,
    }).toEqual(countBefore)

    const moved = core.raycast(geom(), down, { kinds: ['face'] })
    expect(moved.length).toBeGreaterThan(0)
    expect(moved[0].point.z).toBeCloseTo(4, 6)

    useStore.getState().undo()
    const back = core.raycast(geom(), down, { kinds: ['face'] })
    expect(back.length).toBeGreaterThan(0)
    expect(back[0].point.z).toBeCloseTo(0, 6)
  })
})
