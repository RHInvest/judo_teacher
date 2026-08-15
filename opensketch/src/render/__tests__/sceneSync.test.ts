/**
 * Szenensync: Kennwerte und Neuaufbau nach Geometrieaenderungen.
 *
 * Der zweite Block prueft genau den Browser-Befund "Statuszeile friert ein":
 * nach einem `pushPull` muss der Szenengraph die neuen Dreiecke wirklich
 * enthalten - egal ob der Anstoss ueber den Revisionszaehler oder ueber das
 * `geometry:changed`-Event kommt.
 */

import { describe, expect, it } from 'vitest'
import * as core from '@/core'
import { M } from '@/core/math'
import type { Id, SketchDocument } from '@/shared/types'
import { EdgeMaterials } from '../edges'
import { MaterialCache } from '../materials'
import { SceneSync } from '../sceneSync'
import type { RenderSnapshot } from '../snapshot'
import { DEFAULT_STYLE } from '../defaults'
import { addInstance, documentWithSquare, firstId, snapshotOf, squareGeometry } from './helpers'

function newSync(): SceneSync {
  const materials = new MaterialCache({ ...DEFAULT_STYLE }, () => {})
  return new SceneSync(materials, new EdgeMaterials())
}

/** Schnappschuss mit hochgezaehltem Geometriestand. */
function bumped(doc: SketchDocument, geometry: number): RenderSnapshot {
  return snapshotOf(doc, { revisions: { geometry, scene: 1, material: 1, style: 1, selection: 1 } })
}

describe('SceneSync.stats', () => {
  it('zaehlt Flaechen als Flaechen, nicht als Dreiecke', () => {
    const sync = newSync()
    const doc = documentWithSquare(2)
    sync.update(snapshotOf(doc))

    // Ein Quadrat: genau EINE Flaeche, aber zwei Dreiecke.
    expect(sync.stats.faces).toBe(1)
    expect(sync.stats.triangles).toBe(2)
    expect(sync.stats.edges).toBe(4)
    sync.dispose()
  })

  it('zaehlt die Modellwurzel nicht als Instanz', () => {
    const sync = newSync()
    const doc = documentWithSquare(2)
    sync.update(snapshotOf(doc))
    expect(sync.stats.instances).toBe(0)

    addInstance(doc, 'def-a', squareGeometry(1), M.translation({ x: 5, y: 0, z: 0 }))
    sync.markAllDirty()
    sync.update(bumped(doc, 2))
    expect(sync.stats.instances).toBe(1)
    // Wurzelquadrat + Instanzquadrat
    expect(sync.stats.faces).toBe(2)
    sync.dispose()
  })
})

describe('SceneSync nach pushPull', () => {
  it('baut die Geometrie neu, wenn die Revision steigt', () => {
    const sync = newSync()
    const doc = documentWithSquare(2)
    sync.update(bumped(doc, 1))

    const before = sync.stats.triangles
    expect(before).toBe(2)

    const geom = doc.definitions[doc.rootId].geometry
    const faceId: Id = firstId(geom.faces)
    core.pushPull(geom, faceId, 1)

    // Nur die Revision steigt - kein markAllDirty, wie im echten Store.
    const changed = sync.update(bumped(doc, 2))

    expect(changed).toBe(true)
    // Quader: 6 Flaechen, 12 Dreiecke, 12 Kanten
    expect(sync.stats.faces).toBe(6)
    expect(sync.stats.triangles).toBe(12)
    expect(sync.stats.edges).toBe(12)

    // und die Dreiecke liegen wirklich im Szenengraph
    expect(trianglesInGraph(sync)).toBe(12)
    sync.dispose()
  })

  it('baut auch neu, wenn nur `markDefinitionDirty` kommt (Bus-Weg)', () => {
    const sync = newSync()
    const doc = documentWithSquare(2)
    sync.update(bumped(doc, 1))

    const geom = doc.definitions[doc.rootId].geometry
    core.pushPull(geom, firstId(geom.faces), 1)

    // gleiche Revision, nur das Event - so meldet es der Bus.
    sync.markDefinitionDirty(doc.rootId)
    const changed = sync.update(bumped(doc, 1))

    expect(changed).toBe(true)
    expect(sync.stats.faces).toBe(6)
    expect(trianglesInGraph(sync)).toBe(12)
    sync.dispose()
  })

  it('liefert die Huelle des extrudierten Koerpers', () => {
    const sync = newSync()
    const doc = documentWithSquare(2)
    sync.update(bumped(doc, 1))
    expect(sync.modelBounds.max.z).toBeCloseTo(0, 6)

    const geom = doc.definitions[doc.rootId].geometry
    core.pushPull(geom, firstId(geom.faces), 3)
    sync.update(bumped(doc, 2))

    expect(Math.abs(sync.modelBounds.max.z - sync.modelBounds.min.z)).toBeCloseTo(3, 6)
    sync.dispose()
  })
})

/** Summiert die Dreiecke aller Flaechenpuffer im aufgebauten Szenengraph. */
function trianglesInGraph(sync: SceneSync): number {
  let count = 0
  const seen = new Set<unknown>()
  sync.root.traverse((node) => {
    // LineSegments2 ist ebenfalls ein Mesh - Kantenpuffer hier ausklammern.
    const mesh = node as {
      isMesh?: boolean
      isLineSegments2?: boolean
      geometry?: { getIndex(): { count: number } | null }
    }
    if (!mesh.isMesh || mesh.isLineSegments2 || !mesh.geometry) return
    // Vorder- und Rueckseite teilen sich einen Puffer - nur einmal zaehlen.
    if (seen.has(mesh.geometry)) return
    seen.add(mesh.geometry)
    const index = mesh.geometry.getIndex()
    if (index) count += index.count / 3
  })
  return count
}
