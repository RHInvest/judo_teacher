/**
 * Auswahl- und Hover-Darstellung.
 *
 * Alles wird aus den bereits vorhandenen Puffern von `sceneSync` gefiltert -
 * es wird nichts neu trianguliert:
 *
 *  - Kanten: Segmente aus den Kantenpuffern der Definition
 *  - Flaechen: Dreiecke aus den Flaechengruppen, ueber `faceIds` gefiltert
 *  - Vertices: Punkte aus der Vertexliste
 *  - Instanzen: blauer Huellkoerper-Kaefig
 *
 * Dazu kommt der gestrichelte Rahmen um den betretenen Kontext.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { B } from '@/core/math'
import type { BBox3Like, Id, Selection } from '@/shared/types'
import { CONTEXT_FRAME_COLOR, HOVER_COLOR, SELECT_COLOR } from './defaults'
import { SketchLineMaterial } from './lineMaterial'
import type { InstanceRecord, SceneSync } from './sceneSync'
import type { RenderSnapshot } from './snapshot'
import { attempt, clearGroup } from './util'

export class SelectionView {
  readonly group = new THREE.Group()

  private readonly selectedLine: SketchLineMaterial
  private readonly hoverLine: SketchLineMaterial
  private readonly contextLine: SketchLineMaterial
  private readonly faceMaterial: THREE.MeshBasicMaterial
  private readonly hoverFaceMaterial: THREE.MeshBasicMaterial
  private readonly pointMaterial: THREE.PointsMaterial

  private dirty = true
  private signature = ''

  constructor(private readonly sync: SceneSync) {
    this.group.name = 'selection'
    this.group.matrixAutoUpdate = false

    this.selectedLine = new SketchLineMaterial({
      color: SELECT_COLOR,
      linewidth: 3,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
    })
    this.hoverLine = new SketchLineMaterial({
      color: HOVER_COLOR,
      linewidth: 3,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
    })
    this.contextLine = new SketchLineMaterial({
      color: CONTEXT_FRAME_COLOR,
      linewidth: 1.4,
      dashed: true,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    })
    this.contextLine.dashSize = 0.25
    this.contextLine.gapSize = 0.15

    this.faceMaterial = new THREE.MeshBasicMaterial({
      color: SELECT_COLOR,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    })
    this.hoverFaceMaterial = this.faceMaterial.clone()
    this.hoverFaceMaterial.color.set(HOVER_COLOR)
    this.hoverFaceMaterial.opacity = 0.18

    this.pointMaterial = new THREE.PointsMaterial({
      color: SELECT_COLOR,
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
    })
  }

  invalidate(): void {
    this.dirty = true
  }

  setResolution(width: number, height: number): void {
    for (const material of [this.selectedLine, this.hoverLine, this.contextLine]) {
      material.resolution.set(Math.max(1, width), Math.max(1, height))
    }
  }

  update(snapshot: RenderSnapshot): void {
    const signature = this.signatureOf(snapshot)
    if (!this.dirty && signature === this.signature) return
    this.dirty = false
    this.signature = signature

    clearGroup(this.group, { geometries: true })

    const record = this.contextRecord(snapshot)
    if (!record) return

    attempt('selection.build', () => this.build(snapshot, record), undefined)
  }

  /* ---------------------------------------------------------------- */

  private build(snapshot: RenderSnapshot, record: InstanceRecord): void {
    const selection = snapshot.selection
    const build = this.sync.getBuild(record.definitionId)
    const hover = snapshot.hover

    if (build) {
      /* --- Kanten --- */
      const edgeIds = new Set<Id>(selection.edgeIds)
      const positions = this.edgeSegments(record, edgeIds)
      if (positions.length >= 6) this.addLine(positions, this.selectedLine)

      /* --- Flaechen --- */
      const faceIds = new Set<Id>(selection.faceIds)
      const faceMesh = this.faceGeometry(record, faceIds)
      if (faceMesh) this.addMesh(faceMesh, record, this.faceMaterial)

      /* --- Vertices --- */
      const vertexIds = new Set<Id>(selection.vertexIds)
      if (vertexIds.size > 0) {
        const points: number[] = []
        for (let i = 0; i < build.vertexIds.length; i++) {
          if (!vertexIds.has(build.vertexIds[i])) continue
          points.push(build.vertexPositions[i * 3], build.vertexPositions[i * 3 + 1], build.vertexPositions[i * 3 + 2])
        }
        if (points.length >= 3) {
          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
          const object = new THREE.Points(geometry, this.pointMaterial)
          object.matrixAutoUpdate = false
          object.matrix.copy(record.worldMatrix)
          object.matrixWorldNeedsUpdate = true
          object.renderOrder = 6
          object.frustumCulled = false
          this.group.add(object)
        }
      }

      /* --- Hover --- */
      if (hover && hover.id && hover.definitionId === record.definitionId) {
        if (hover.kind === 'edge') {
          const hoverPositions = this.edgeSegments(record, new Set([hover.id]))
          if (hoverPositions.length >= 6) this.addLine(hoverPositions, this.hoverLine)
        } else if (hover.kind === 'face') {
          const mesh = this.faceGeometry(record, new Set([hover.id]))
          if (mesh) this.addMesh(mesh, record, this.hoverFaceMaterial)
        }
      }
    }

    /* --- ausgewaehlte Instanzen --- */
    const entityIds = new Set<Id>(selection.entityIds)
    if (hover && hover.kind === 'entity' && hover.id) entityIds.add(hover.id)
    if (entityIds.size > 0) {
      const boxes: number[] = []
      for (const other of this.sync.records) {
        if (!other.entityId || !entityIds.has(other.entityId)) continue
        pushBox(boxes, other.bounds)
      }
      if (boxes.length >= 6) this.addLine(boxes, this.selectedLine, false)
    }

    /* --- Rahmen um den betretenen Kontext --- */
    if ((snapshot.context?.instancePath.length ?? 0) > 0 && !B.isEmpty(record.bounds)) {
      const frame: number[] = []
      pushBox(frame, B.expandByScalar(record.bounds, Math.max(B.diagonal(record.bounds) * 0.02, 0.01)))
      const line = this.addLine(frame, this.contextLine, false)
      if (line) line.computeLineDistances()
    }
  }

  /** Kantensegmente der Definition, gefiltert nach Ids. */
  private edgeSegments(record: InstanceRecord, ids: Set<Id>): number[] {
    const out: number[] = []
    if (ids.size === 0) return out
    const build = this.sync.getBuild(record.definitionId)
    if (!build) return out
    const matrix = record.worldMatrix
    const point = new THREE.Vector3()
    for (const cls of ['normal', 'profile', 'hidden', 'guide'] as const) {
      const bucket = build.edges.buckets[cls]
      for (let i = 0; i < bucket.segments; i++) {
        if (!ids.has(bucket.edgeIds[i])) continue
        for (let end = 0; end < 2; end++) {
          const o = (i * 2 + end) * 3
          point.set(bucket.positions[o], bucket.positions[o + 1], bucket.positions[o + 2]).applyMatrix4(matrix)
          out.push(point.x, point.y, point.z)
        }
      }
    }
    return out
  }

  /** Dreiecke der ausgewaehlten Flaechen als eigene Geometrie. */
  private faceGeometry(record: InstanceRecord, ids: Set<Id>): THREE.BufferGeometry | null {
    if (ids.size === 0) return null
    const build = this.sync.getBuild(record.definitionId)
    if (!build) return null

    const positions: number[] = []
    for (const group of build.faceGroups) {
      const triangles = Math.floor(group.indices.length / 3)
      for (let t = 0; t < triangles; t++) {
        if (!ids.has(group.faceIds[t])) continue
        for (let k = 0; k < 3; k++) {
          const index = group.indices[t * 3 + k] * 3
          positions.push(group.positions[index], group.positions[index + 1], group.positions[index + 2])
        }
      }
    }
    if (positions.length < 9) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeBoundingSphere()
    return geometry
  }

  private addLine(positions: number[], material: SketchLineMaterial, dashed = false): LineSegments2 | null {
    if (positions.length < 6) return null
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    const line = new LineSegments2(geometry, material)
    if (dashed) line.computeLineDistances()
    line.renderOrder = 5
    line.frustumCulled = false
    line.userData.ownGeometry = true
    this.group.add(line)
    return line
  }

  private addMesh(geometry: THREE.BufferGeometry, record: InstanceRecord, material: THREE.Material): void {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(record.worldMatrix)
    mesh.matrixWorldNeedsUpdate = true
    mesh.renderOrder = 4
    mesh.frustumCulled = false
    mesh.userData.ownGeometry = true
    this.group.add(mesh)
  }

  private contextRecord(snapshot: RenderSnapshot): InstanceRecord | null {
    const path = snapshot.context?.instancePath ?? []
    for (const record of this.sync.records) {
      if (record.instancePath.length === path.length) return record
    }
    return null
  }

  private signatureOf(snapshot: RenderSnapshot): string {
    const s: Selection = snapshot.selection
    const hover = snapshot.hover
    return [
      snapshot.revisions.selection,
      snapshot.revisions.geometry,
      snapshot.revisions.scene,
      s.edgeIds.length,
      s.faceIds.length,
      s.vertexIds.length,
      s.entityIds.length,
      hover ? `${hover.kind}:${hover.id ?? '-'}` : '-',
      snapshot.context?.instancePath.join('>') ?? '',
    ].join('|')
  }

  dispose(): void {
    clearGroup(this.group, { geometries: true })
    this.selectedLine.dispose()
    this.hoverLine.dispose()
    this.contextLine.dispose()
    this.faceMaterial.dispose()
    this.hoverFaceMaterial.dispose()
    this.pointMaterial.dispose()
    this.group.removeFromParent()
  }
}

/** Zwoelf Kanten eines Huellkoerpers an eine Positionsliste anhaengen. */
function pushBox(out: number[], box: BBox3Like): void {
  if (B.isEmpty(box)) return
  for (const [a, b] of B.edgeSegments(box)) {
    out.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
}
