/**
 * Schnittebenen.
 *
 * Zwei Aufgaben:
 *
 *  1. CLIPPING - jede aktive `SectionPlaneEntity` wird in eine `THREE.Plane` im
 *     Weltraum umgerechnet und dem Renderer als globale Clipping-Ebene
 *     uebergeben. Geschnitten wird die Haelfte, in die die Ebenennormale zeigt.
 *  2. SCHNITTFLAECHE - ein aufgeschnittener Koerper waere sonst hohl. Mit der
 *     klassischen Stencil-Technik wird die Schnittflaeche gefuellt:
 *     Rueckseiten erhoehen den Stencil, Vorderseiten verringern ihn; wo danach
 *     etwas stehen bleibt, liegt Material - dort wird ein Quad in der
 *     Schnittebene mit `sectionCutFill` gezeichnet.
 *
 * Dazu kommt das Schnittebenensymbol: ein Rahmen mit Eckgriffen.
 *
 * BEKANNTE EINSCHRAENKUNGEN des Stencil-Durchgangs:
 *
 *  - Gefuellt wird nur die ERSTE aktive Ebene (siehe `rebuild`). Weitere aktive
 *    Ebenen schneiden mit, bekommen aber keine eigene Fuellung - wie in
 *    SketchUp, wo pro Kontext eine Schnittebene aktiv ist.
 *  - Der Durchgang zeichnet jede Platzierung EINZELN, auch wenn `sceneSync`
 *    dieselbe Definition sonst als `InstancedMesh` zusammenfasst. Bei sehr
 *    vielen Instanzen kostet die Fuellung deshalb spuerbar Zeichenaufrufe.
 *
 * Instanzierte Definitionen FEHLEN dagegen nicht: `addStencilPass` laeuft ueber
 * `sync.records`, also ueber alle Platzierungen samt Welttransformation - eine
 * frueher notierte Einschraenkung, die auf den aktuellen Stand nicht mehr
 * zutrifft. Abgesichert in `__tests__/sections.test.ts`.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { B, M, P, V } from '@/core/math'
import type { Id, PlaneLike, SectionPlaneEntity, Vec3Like } from '@/shared/types'
import { SketchLineMaterial } from './lineMaterial'
import type { InstanceRecord, SceneSync } from './sceneSync'
import type { RenderSnapshot } from './snapshot'
import { clearGroup, parseColor } from './util'

/** Eine Schnittebene mit ihrer Herkunft. */
export interface ActiveSection {
  entityId: Id
  /** Ebene im WELTRAUM */
  plane: PlaneLike
  color: string
  symbolSize: number
  active: boolean
}

export class SectionManager {
  readonly group = new THREE.Group()

  private readonly capMaterial: THREE.MeshBasicMaterial
  private readonly symbolMaterial: SketchLineMaterial
  private readonly activeSymbolMaterial: SketchLineMaterial
  private readonly stencilMaterials: THREE.Material[] = []

  private planes: THREE.Plane[] = []
  private activePlanes: PlaneLike[] = []
  private signature = ''

  constructor() {
    this.group.name = 'sections'
    this.group.matrixAutoUpdate = false

    this.capMaterial = new THREE.MeshBasicMaterial({
      color: 0xd9d2c2,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    })

    this.symbolMaterial = new SketchLineMaterial({
      color: 0xf59e0b,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    })
    this.activeSymbolMaterial = new SketchLineMaterial({
      color: 0xea580c,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    })
  }

  setResolution(width: number, height: number): void {
    this.symbolMaterial.resolution.set(Math.max(1, width), Math.max(1, height))
    this.activeSymbolMaterial.resolution.set(Math.max(1, width), Math.max(1, height))
  }

  /** Aktive Schnittebenen im Weltraum. */
  collect(snapshot: RenderSnapshot, sync: SceneSync): ActiveSection[] {
    const doc = snapshot.doc
    if (!doc) return []
    const out: ActiveSection[] = []
    for (const record of sync.records) {
      const def = doc.definitions[record.definitionId]
      if (!def) continue
      for (const childId of def.children ?? []) {
        const entity = doc.entities?.[childId]
        if (!entity || entity.type !== 'sectionPlane' || entity.hidden) continue
        if (!snapshot.isTagVisible(entity.tagId)) continue
        const section = entity as SectionPlaneEntity
        const plane = transformPlane(section.plane, record)
        if (!plane) continue
        out.push({
          entityId: section.id,
          plane,
          color: section.color,
          symbolSize: Number.isFinite(section.symbolSize) && section.symbolSize > 0 ? section.symbolSize : 2,
          active: section.active === true,
        })
      }
    }
    return out
  }

  update(snapshot: RenderSnapshot, sync: SceneSync, renderer: THREE.WebGLRenderer): void {
    const style = snapshot.style
    const sections = this.collect(snapshot, sync)
    const active = sections.filter((s) => s.active)

    const signature = [
      snapshot.revisions.scene,
      snapshot.revisions.style,
      snapshot.revisions.geometry,
      style.showSectionPlanes ? 1 : 0,
      style.showSectionCuts ? 1 : 0,
      style.sectionCutFill,
      sections
        .map((s) => `${s.entityId}:${s.active ? 1 : 0}:${round(s.plane.n.x)},${round(s.plane.n.y)},${round(s.plane.n.z)},${round(s.plane.d)}`)
        .join(';'),
    ].join('|')

    if (signature === this.signature) return
    this.signature = signature

    this.rebuild(snapshot, sync, active, sections)

    // Clipping ist unabhaengig von der Fuellung: ohne `showSectionCuts` bleibt
    // das Modell ungeschnitten, die Symbole sind aber weiter sichtbar.
    const clipping = style.showSectionCuts === false ? [] : active
    this.activePlanes = clipping.map((s) => s.plane)
    this.planes = clipping.map((s) => toThreePlane(s.plane))
    renderer.clippingPlanes = this.planes
  }

  /**
   * Die tatsaechlich schneidenden Ebenen im Weltraum.
   *
   * Der Renderer schneidet damit jedes Material selbst. Wer AUSSERHALB von
   * WebGL zeichnet - die Textebene der Annotationen - bekommt davon nichts mit
   * und muss hier nachfragen.
   */
  get clippingPlanes(): readonly PlaneLike[] {
    return this.activePlanes
  }

  /* ---------------------------------------------------------------- */

  private rebuild(
    snapshot: RenderSnapshot,
    sync: SceneSync,
    active: ActiveSection[],
    all: ActiveSection[],
  ): void {
    clearGroup(this.group, { geometries: true })
    for (const material of this.stencilMaterials) material.dispose()
    this.stencilMaterials.length = 0

    const style = snapshot.style
    if (style.showSectionPlanes !== false) {
      for (const section of all) this.addSymbol(section, sync)
    }

    if (style.showSectionCuts === false || active.length === 0) return

    this.capMaterial.color.copy(parseColor(style.sectionCutFill, '#d9d2c2'))

    // Die Fuellung wird fuer die ERSTE aktive Ebene gebaut - genau wie in
    // SketchUp, wo pro Kontext eine Schnittebene aktiv ist. Weitere aktive
    // Ebenen schneiden weiterhin mit, bekommen aber keine eigene Fuellung.
    const primary = active[0]
    const clipPlane = toThreePlane(primary.plane)
    const others = active.slice(1).map((s) => toThreePlane(s.plane))

    this.addStencilPass(sync, clipPlane)
    this.addCap(primary, sync, others)
  }

  /** Vorder- und Rueckseiten in den Stencil-Puffer zaehlen. */
  private addStencilPass(sync: SceneSync, clipPlane: THREE.Plane): void {
    const base = new THREE.MeshBasicMaterial()
    base.depthWrite = false
    base.depthTest = false
    base.colorWrite = false
    base.stencilWrite = true
    base.stencilFunc = THREE.AlwaysStencilFunc
    base.clippingPlanes = [clipPlane]

    const back = base.clone()
    back.side = THREE.BackSide
    back.clippingPlanes = [clipPlane]
    back.stencilFail = THREE.IncrementWrapStencilOp
    back.stencilZFail = THREE.IncrementWrapStencilOp
    back.stencilZPass = THREE.IncrementWrapStencilOp

    const front = base.clone()
    front.side = THREE.FrontSide
    front.clippingPlanes = [clipPlane]
    front.stencilFail = THREE.DecrementWrapStencilOp
    front.stencilZFail = THREE.DecrementWrapStencilOp
    front.stencilZPass = THREE.DecrementWrapStencilOp

    base.dispose()
    this.stencilMaterials.push(back, front)

    for (const record of sync.records) {
      const build = sync.getBuild(record.definitionId)
      if (!build) continue
      for (const group of build.faceGroups) {
        for (const material of [back, front]) {
          const mesh = new THREE.Mesh(group.geometry, material)
          mesh.matrixAutoUpdate = false
          mesh.matrix.copy(record.worldMatrix)
          mesh.matrixWorldNeedsUpdate = true
          mesh.renderOrder = 1
          mesh.frustumCulled = false
          this.group.add(mesh)
        }
      }
    }
  }

  /** Quad in der Schnittebene, maskiert durch den Stencil-Puffer. */
  private addCap(section: ActiveSection, sync: SceneSync, otherPlanes: THREE.Plane[]): void {
    const bounds = B.isEmpty(sync.modelBounds)
      ? { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } }
      : sync.modelBounds
    const size = Math.max(B.diagonal(bounds) * 1.5, 1)

    const geometry = new THREE.PlaneGeometry(size, size)
    const material = this.capMaterial.clone()
    material.clippingPlanes = otherPlanes
    this.stencilMaterials.push(material)

    const mesh = new THREE.Mesh(geometry, material)
    orientToPlane(mesh, section.plane)
    mesh.renderOrder = 1.5
    mesh.frustumCulled = false
    mesh.userData.ownGeometry = true
    this.group.add(mesh)
  }

  /** Rahmen mit Eckgriffen als Symbol der Schnittebene. */
  private addSymbol(section: ActiveSection, sync: SceneSync): void {
    const bounds = sync.modelBounds
    const extent = B.isEmpty(bounds) ? section.symbolSize * 2 : Math.max(B.diagonal(bounds) * 0.35, section.symbolSize)
    const half = Math.max(extent, 0.2)
    const handle = half * 0.22

    const frame = P.frame(section.plane, V.mul(section.plane.n, section.plane.d))
    const origin = frame.origin
    const u = frame.u
    const v = frame.v

    const corner = (su: number, sv: number): Vec3Like => V.add(origin, V.add(V.mul(u, su * half), V.mul(v, sv * half)))

    const positions: number[] = []
    const push = (a: Vec3Like, b: Vec3Like): void => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }

    const c00 = corner(-1, -1)
    const c10 = corner(1, -1)
    const c11 = corner(1, 1)
    const c01 = corner(-1, 1)
    push(c00, c10)
    push(c10, c11)
    push(c11, c01)
    push(c01, c00)

    // Eckgriffe leicht nach innen versetzt
    for (const [c, du, dv] of [
      [c00, 1, 1],
      [c10, -1, 1],
      [c11, -1, -1],
      [c01, 1, -1],
    ] as [Vec3Like, number, number][]) {
      push(c, V.add(c, V.mul(u, du * handle)))
      push(c, V.add(c, V.mul(v, dv * handle)))
    }

    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    const material = section.active ? this.activeSymbolMaterial : this.symbolMaterial
    const line = new LineSegments2(geometry, material)
    line.renderOrder = 3
    line.frustumCulled = false
    line.userData.ownGeometry = true
    line.userData.entityId = section.entityId
    this.group.add(line)
  }

  dispose(): void {
    clearGroup(this.group, { geometries: true })
    for (const material of this.stencilMaterials) material.dispose()
    this.stencilMaterials.length = 0
    this.capMaterial.dispose()
    this.symbolMaterial.dispose()
    this.activeSymbolMaterial.dispose()
    this.group.removeFromParent()
  }
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

/** Ebene aus dem Definitionsraum in den Weltraum bringen. */
function transformPlane(plane: PlaneLike, record: InstanceRecord): PlaneLike | null {
  if (!plane || !plane.n) return null
  const normal = V.normalizeOr(M.transformNormal(record.worldTransform, plane.n), plane.n)
  const point = M.transformPoint(record.worldTransform, V.mul(plane.n, plane.d))
  if (!Number.isFinite(normal.x) || !Number.isFinite(point.x)) return null
  return { n: normal, d: V.dot(normal, point) }
}

/**
 * `PlaneLike` (`dot(n,p) - d = 0`, sichtbar ist die Rueckseite) in eine
 * three.js-Clipping-Ebene (`dot(n,p) + constant >= 0` bleibt stehen).
 */
export function toThreePlane(plane: PlaneLike): THREE.Plane {
  return new THREE.Plane(new THREE.Vector3(-plane.n.x, -plane.n.y, -plane.n.z), plane.d)
}

/** Objekt in die Ebene drehen und verschieben. */
function orientToPlane(object: THREE.Object3D, plane: PlaneLike): void {
  const normal = new THREE.Vector3(plane.n.x, plane.n.y, plane.n.z).normalize()
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
  object.quaternion.copy(quaternion)
  object.position.set(normal.x * plane.d, normal.y * plane.d, normal.z * plane.d)
  object.updateMatrix()
  object.matrixWorldNeedsUpdate = true
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}
