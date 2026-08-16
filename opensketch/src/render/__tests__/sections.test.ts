/**
 * Schnittebenen: Clipping, Fuellung und der Stencil-Durchgang.
 *
 * Geprueft wird vor allem, ob der Stencil-Durchgang wirklich ALLE Platzierungen
 * erfasst - auch instanzierte Definitionen. Genau das war im letzten Bericht als
 * Einschraenkung notiert.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { M } from '@/core/math'
import type { SectionPlaneEntity, SketchDocument } from '@/shared/types'
import { DEFAULT_STYLE } from '../defaults'
import { EdgeMaterials } from '../edges'
import { MaterialCache } from '../materials'
import { SceneSync } from '../sceneSync'
import { SectionManager } from '../sections'
import { addEntity, addInstance, documentWithSquare, snapshotOf, squareGeometry } from './helpers'

/** Nur das, was `SectionManager.update` vom Renderer anfasst. */
function fakeRenderer(): THREE.WebGLRenderer {
  return { clippingPlanes: [] as THREE.Plane[] } as unknown as THREE.WebGLRenderer
}

function sectionPlane(active = true): SectionPlaneEntity {
  return {
    id: 'sec-1',
    type: 'sectionPlane',
    name: 'Schnitt',
    tagId: null,
    hidden: false,
    locked: false,
    plane: { n: { x: 0, y: 0, z: 1 }, d: 0.5 },
    active,
    symbolSize: 2,
    color: '#3366aa',
  }
}

interface Fixture {
  doc: SketchDocument
  sync: SceneSync
  sections: SectionManager
}

function makeFixture(withInstance: boolean): Fixture {
  const doc = documentWithSquare(2)
  if (withInstance) addInstance(doc, 'def-a', squareGeometry(1), M.translation({ x: 4, y: 0, z: 0 }))
  addEntity(doc, sectionPlane())

  const materials = new MaterialCache({ ...DEFAULT_STYLE }, () => {})
  const sync = new SceneSync(materials, new EdgeMaterials())
  sync.update(snapshotOf(doc))
  return { doc, sync, sections: new SectionManager() }
}

/** Meshes des Stencil-Durchgangs, gruppiert nach Weltposition x. */
function stencilOriginsX(sections: SectionManager): number[] {
  const out: number[] = []
  for (const child of sections.group.children) {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) continue
    out.push(Math.round(mesh.matrix.elements[12] * 1000) / 1000)
  }
  return out
}

describe('SectionManager', () => {
  it('meldet die aktive Ebene als Clipping-Ebene an den Renderer', () => {
    const { doc, sync, sections } = makeFixture(false)
    const renderer = fakeRenderer()
    sections.update(snapshotOf(doc), sync, renderer)

    expect(renderer.clippingPlanes.length).toBe(1)
    // three.js behaelt die Haelfte, in die die Normale zeigt - geschnitten wird
    // aber genau die andere. Die Normale ist deshalb umgedreht.
    expect(renderer.clippingPlanes[0].normal.z).toBeCloseTo(-1, 9)
    expect(renderer.clippingPlanes[0].constant).toBeCloseTo(0.5, 9)
    sections.dispose()
  })

  it('schneidet nicht, wenn der Stil Schnitte ausblendet', () => {
    const { doc, sync, sections } = makeFixture(false)
    const renderer = fakeRenderer()
    const snapshot = snapshotOf(doc, { style: { ...DEFAULT_STYLE, showSectionCuts: false } })
    sections.update(snapshot, sync, renderer)

    expect(renderer.clippingPlanes.length).toBe(0)
    sections.dispose()
  })

  it('nimmt instanzierte Definitionen in den Stencil-Durchgang auf', () => {
    const withoutInstance = makeFixture(false)
    withoutInstance.sections.update(snapshotOf(withoutInstance.doc), withoutInstance.sync, fakeRenderer())
    const base = stencilOriginsX(withoutInstance.sections)

    const withInstance = makeFixture(true)
    withInstance.sections.update(snapshotOf(withInstance.doc), withInstance.sync, fakeRenderer())
    const all = stencilOriginsX(withInstance.sections)

    // Die Instanz steht bei x = 4 und muss eigene Stencil-Meshes beisteuern
    // (Vorder- und Rueckseite, also zwei je Flaechengruppe).
    expect(all.length).toBeGreaterThan(base.length)
    expect(all.filter((x) => Math.abs(x - 4) < 1e-6).length).toBe(2)

    withoutInstance.sections.dispose()
    withInstance.sections.dispose()
  })

  it('baut nur bei geaenderter Signatur neu', () => {
    const { doc, sync, sections } = makeFixture(false)
    const snapshot = snapshotOf(doc)
    sections.update(snapshot, sync, fakeRenderer())
    const first = sections.group.children.length

    const renderer = fakeRenderer()
    renderer.clippingPlanes = [new THREE.Plane()]
    sections.update(snapshot, sync, renderer)

    expect(sections.group.children.length).toBe(first)
    // unveraenderte Signatur -> der Renderer wird nicht angefasst
    expect(renderer.clippingPlanes.length).toBe(1)
    sections.dispose()
  })
})
