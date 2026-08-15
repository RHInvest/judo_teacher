/**
 * Szenengraph-Synchronisation.
 *
 * Zwei getrennte Stufen, genau wie im Rendering-Protokoll (ARCHITECTURE.md, 7):
 *
 *  1. GEOMETRIE-CACHE - pro Definition ein Satz `BufferGeometry` (nach
 *     Materialpaar gruppiert) plus die vier Kantenpuffer. Wird nur neu gebaut,
 *     wenn sich `geometryRevision` aendert bzw. ein `geometry:changed`-Event
 *     fuer genau diese Definition eintrifft.
 *  2. INSTANZBAUM - eine flache Liste aus `InstanceRecord`s mit fertig
 *     akkumulierter Welttransformation. `scene:changed` baut nur diese Stufe
 *     neu, ohne eine einzige Flaeche erneut zu triangulieren.
 *
 * Der Baum wird bewusst FLACH gehalten: die Weltmatrizen sind bereits
 * ausmultipliziert, dadurch braucht das Picking keine Hierarchie zu traversieren
 * und Instanzen ausserhalb des aktiven Kontexts lassen sich einzeln abblenden.
 *
 * Ab `LIMITS.instancingThreshold` Instanzen derselben Blattdefinition (gleiche
 * Abblendung, gleiches Instanzmaterial) wird auf `InstancedMesh` umgestellt und
 * die Kantenpuffer werden zu einem einzigen Zeichenaufruf zusammengebacken.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import * as core from '@/core'
import { B, M, P, V } from '@/core/math'
import type {
  BBox3Like,
  Definition,
  Face,
  Geometry,
  Id,
  InstanceEntity,
  Mat4Like,
  Material,
  SketchDocument,
  StyleSettings,
  UvMapping,
  Vec3Like,
} from '@/shared/types'
import { LIMITS } from './defaults'
import {
  EDGE_CLASSES,
  type EdgeClass,
  type EdgeExtraction,
  buildEndpoints,
  buildLineGeometry,
  createLineObject,
  edgeColors,
  emptyExtraction,
  extractEdges,
  lineGeometryFromPositions,
} from './edges'
import type { EdgeMaterials } from './edges'
import type { MaterialCache } from './materials'
import type { RenderSnapshot } from './snapshot'
import { attempt, clearGroup, isPathPrefix, warnOnce } from './util'

/* ------------------------------------------------------------------ */
/* Datenstrukturen                                                     */
/* ------------------------------------------------------------------ */

export interface FaceGroup {
  frontMaterialId: Id | null
  backMaterialId: Id | null
  geometry: THREE.BufferGeometry
  triangles: number
  /** Rohpositionen der Gruppe - vom Picking direkt genutzt */
  positions: Float32Array
  indices: Uint32Array
  /** Flaechen-Id je Dreieck (`faceIds[i]` gehoert zu `indices[i*3 .. i*3+2]`) */
  faceIds: Id[]
}

export interface DefinitionBuild {
  id: Id
  /** Signatur, aus der hervorgeht ob neu gebaut werden muss */
  signature: string
  faceGroups: FaceGroup[]
  edges: EdgeExtraction
  lineGeometries: Partial<Record<EdgeClass, LineSegmentsGeometry>>
  endpoints: Float32Array
  /** Vertexpositionen dieser Definition (3 Werte je Vertex), fuer das Picking */
  vertexPositions: Float32Array
  vertexIds: Id[]
  /** Huelle der EIGENEN Geometrie dieser Definition, in Definitionsraum */
  localBounds: BBox3Like
  /** Dreiecke der Triangulierung (Zeichenaufwand) */
  triangles: number
  /** Anzahl der sichtbaren `Face`-Objekte (Modellkennwert, NICHT die Dreiecke) */
  faceCount: number
  edgeCount: number
  hasChildInstances: boolean
}

/** Eine konkrete Platzierung: Definition + fertige Welttransformation. */
export interface InstanceRecord {
  /** null fuer die Modellwurzel */
  entityId: Id | null
  definitionId: Id
  /** Instanz-Ids von der Modellwurzel bis hierher */
  instancePath: Id[]
  worldTransform: Mat4Like
  worldMatrix: THREE.Matrix4
  inverseMatrix: THREE.Matrix4
  /** gleichmaessiger Skalierungsfaktor der Welttransformation (fuer Toleranzen) */
  scale: number
  depth: number
  materialOverride: Id | null
  /** ausserhalb des aktiven Kontexts */
  dimmed: boolean
  /** direkt im aktiven Kontext editierbar */
  inContext: boolean
  /** oberste Instanz des Pfades, fuer Gruppenauswahl */
  topInstanceId: Id | null
  /** Weltraum-Huelle der eigenen Geometrie (Vorfilter fuers Picking) */
  bounds: BBox3Like
  locked: boolean
}

export interface SceneStats {
  /** Dreiecke der Triangulierung - Zeichenaufwand, kein Modellkennwert */
  triangles: number
  /** sichtbare `Face`-Objekte des Modells (das, was die Statuszeile zeigt) */
  faces: number
  edges: number
  /** platzierte Instanzen; die Modellwurzel zaehlt NICHT mit */
  instances: number
  definitions: number
  drawCalls: number
}

function emptyStats(): SceneStats {
  return { triangles: 0, faces: 0, edges: 0, instances: 0, definitions: 0, drawCalls: 0 }
}

/* ------------------------------------------------------------------ */
/* SceneSync                                                           */
/* ------------------------------------------------------------------ */

export class SceneSync {
  readonly root = new THREE.Group()

  private builds = new Map<Id, DefinitionBuild>()
  private dirtyDefinitions = new Set<Id>()
  private allDirty = true
  private treeDirty = true
  private lastGeometrySignature = ''
  private lastTreeSignature = ''

  private recordList: InstanceRecord[] = []
  private definitionBoundsCache = new Map<Id, BBox3Like>()

  stats: SceneStats = emptyStats()
  modelBounds: BBox3Like = B.empty()

  constructor(
    private readonly materials: MaterialCache,
    private readonly edgeMaterials: EdgeMaterials,
  ) {
    this.root.name = 'modelRoot'
    this.root.matrixAutoUpdate = false
  }

  get records(): readonly InstanceRecord[] {
    return this.recordList
  }

  /** Nur diese Definition neu triangulieren. */
  markDefinitionDirty(definitionId: Id): void {
    this.dirtyDefinitions.add(definitionId)
    this.treeDirty = true
  }

  /** Alle Definitionen neu triangulieren. */
  markAllDirty(): void {
    this.allDirty = true
    this.treeDirty = true
  }

  /** Nur den Instanzbaum neu aufbauen (Geometrie bleibt im Cache). */
  markTreeDirty(): void {
    this.treeDirty = true
  }

  /**
   * Bringt Cache und Baum auf den Stand des Schnappschusses.
   * Gibt true zurueck, wenn sich etwas geaendert hat.
   */
  update(snapshot: RenderSnapshot): boolean {
    const doc = snapshot.doc
    if (!doc || !doc.definitions || !doc.definitions[doc.rootId]) {
      if (this.recordList.length > 0 || this.root.children.length > 0) {
        this.disposeTree()
        this.recordList = []
        this.stats = emptyStats()
        this.modelBounds = B.empty()
        return true
      }
      return false
    }

    const geometrySignature = this.geometrySignature(snapshot)
    if (geometrySignature !== this.lastGeometrySignature) {
      this.lastGeometrySignature = geometrySignature
      this.allDirty = true
    }

    let changed = false
    if (this.allDirty || this.dirtyDefinitions.size > 0) {
      this.rebuildGeometry(snapshot, doc)
      changed = true
      this.treeDirty = true
    }

    const treeSignature = this.treeSignature(snapshot)
    if (treeSignature !== this.lastTreeSignature) {
      this.lastTreeSignature = treeSignature
      this.treeDirty = true
    }

    if (this.treeDirty) {
      this.rebuildTree(snapshot, doc)
      this.treeDirty = false
      changed = true
    }

    return changed
  }

  /* ---------------------------------------------------------------- */
  /* Signaturen                                                       */
  /* ---------------------------------------------------------------- */

  private geometrySignature(s: RenderSnapshot): string {
    const style = s.style
    const hiddenTags = this.hiddenTagKey(s)
    return [
      s.revisions.geometry,
      s.revisions.material,
      style.showHiddenGeometry ? 1 : 0,
      style.displayEndpoints ? 1 : 0,
      style.edgeColorMode,
      hiddenTags,
    ].join('|')
  }

  private treeSignature(s: RenderSnapshot): string {
    const style = s.style
    return [
      s.revisions.scene,
      s.revisions.style,
      s.context ? s.context.instancePath.join('>') : '',
      style.faceStyle,
      style.displayEdges ? 1 : 0,
      style.displayProfiles ? 1 : 0,
      style.displayEndpoints ? 1 : 0,
      style.jitterEdges ? 1 : 0,
      this.hiddenTagKey(s),
    ].join('|')
  }

  private hiddenTagKey(s: RenderSnapshot): string {
    const doc = s.doc
    if (!doc || !doc.tags) return ''
    const hidden: string[] = []
    for (const id of Object.keys(doc.tags)) if (!s.isTagVisible(id)) hidden.push(id)
    hidden.sort()
    return hidden.join(',')
  }

  /* ---------------------------------------------------------------- */
  /* Stufe 1: Geometrie                                               */
  /* ---------------------------------------------------------------- */

  private rebuildGeometry(snapshot: RenderSnapshot, doc: SketchDocument): void {
    const reachable = this.reachableDefinitions(doc)
    const rebuildAll = this.allDirty

    for (const defId of reachable) {
      if (!rebuildAll && !this.dirtyDefinitions.has(defId) && this.builds.has(defId)) continue
      const def = doc.definitions[defId]
      if (!def) continue
      const previous = this.builds.get(defId)
      if (previous) disposeBuild(previous)
      this.builds.set(defId, this.buildDefinition(def, snapshot, doc))
    }

    // nicht mehr erreichbare Definitionen freigeben
    for (const [defId, build] of Array.from(this.builds.entries())) {
      if (!reachable.has(defId)) {
        disposeBuild(build)
        this.builds.delete(defId)
      }
    }

    this.allDirty = false
    this.dirtyDefinitions.clear()
    this.definitionBoundsCache.clear()
  }

  private reachableDefinitions(doc: SketchDocument): Set<Id> {
    const out = new Set<Id>()
    const stack: Id[] = [doc.rootId]
    while (stack.length > 0) {
      const id = stack.pop() as Id
      if (out.has(id)) continue
      const def = doc.definitions[id]
      if (!def) continue
      out.add(id)
      for (const childId of def.children ?? []) {
        const entity = doc.entities?.[childId]
        if (entity && entity.type === 'instance') stack.push(entity.definitionId)
      }
    }
    return out
  }

  private buildDefinition(def: Definition, snapshot: RenderSnapshot, doc: SketchDocument): DefinitionBuild {
    const style = snapshot.style
    const geom: Geometry = def.geometry ?? { vertices: {}, edges: {}, faces: {} }

    const faceResult = attempt(
      `sceneSync.faces(${def.id})`,
      () => buildFaceGroups(geom, snapshot, doc),
      { groups: [] as FaceGroup[], triangles: 0, faces: 0, bounds: B.empty() },
    )

    const edges = attempt(`sceneSync.edges(${def.id})`, () =>
      extractEdges(geom, {
        isTagVisible: snapshot.isTagVisible,
        showHiddenGeometry: style.showHiddenGeometry === true,
        collectEndpoints: style.displayEndpoints === true,
      }),
    emptyExtraction())

    const lineGeometries: Partial<Record<EdgeClass, LineSegmentsGeometry>> = {}
    for (const cls of EDGE_CLASSES) {
      const bucket = edges.buckets[cls]
      const colors = edgeColors(bucket, style, doc)
      const geometry = buildLineGeometry(bucket, colors)
      if (geometry) lineGeometries[cls] = geometry
    }

    // Huelle: Flaechen + alle Kantenendpunkte (auch bei fehlender Triangulierung korrekt)
    // In einem Durchgang entsteht dabei auch die Vertexliste fuers Picking.
    const bounds = B.clone(faceResult.bounds)
    const vertexIds: Id[] = []
    const vertexKeys = Object.keys(geom.vertices)
    const vertexPositions = new Float32Array(vertexKeys.length * 3)
    let vertexCursor = 0
    for (const vertexId of vertexKeys) {
      const vertex = geom.vertices[vertexId]
      if (!vertex || !vertex.p) continue
      B.expandByPointMut(bounds, vertex.p)
      vertexPositions[vertexCursor * 3] = vertex.p.x
      vertexPositions[vertexCursor * 3 + 1] = vertex.p.y
      vertexPositions[vertexCursor * 3 + 2] = vertex.p.z
      vertexIds.push(vertexId)
      vertexCursor++
    }

    const hasChildInstances = (def.children ?? []).some((id) => doc.entities?.[id]?.type === 'instance')

    return {
      id: def.id,
      signature: this.lastGeometrySignature,
      faceGroups: faceResult.groups,
      edges,
      lineGeometries,
      endpoints: edges.endpoints,
      vertexPositions: vertexPositions.subarray(0, vertexCursor * 3),
      vertexIds,
      localBounds: bounds,
      triangles: faceResult.triangles,
      faceCount: faceResult.faces,
      edgeCount: edges.total,
      hasChildInstances,
    }
  }

  /* ---------------------------------------------------------------- */
  /* Stufe 2: Instanzbaum                                             */
  /* ---------------------------------------------------------------- */

  private rebuildTree(snapshot: RenderSnapshot, doc: SketchDocument): void {
    this.disposeTree()

    const records = this.collectRecords(snapshot, doc)
    this.recordList = records

    const style = snapshot.style
    const drawEdges = style.displayEdges !== false || style.faceStyle === 'wireframe'
    const drawFaces = this.materials.drawsFaces

    // Instanzierbare Definitionen finden
    const byKey = new Map<string, InstanceRecord[]>()
    for (const record of records) {
      const build = this.builds.get(record.definitionId)
      if (!build || build.hasChildInstances) continue
      const key = `${record.definitionId}|${record.dimmed ? 1 : 0}|${record.materialOverride ?? '-'}`
      const list = byKey.get(key)
      if (list) list.push(record)
      else byKey.set(key, [record])
    }

    const instanced = new Set<InstanceRecord>()
    let drawCalls = 0
    for (const list of byKey.values()) {
      if (list.length < LIMITS.instancingThreshold) continue
      const build = this.builds.get(list[0].definitionId)
      if (!build) continue
      drawCalls += this.addInstanced(build, list, snapshot, drawFaces, drawEdges)
      for (const record of list) instanced.add(record)
    }

    let triangles = 0
    let faceCount = 0
    let edgeCount = 0
    let instanceCount = 0
    const modelBounds = B.empty()

    for (const record of records) {
      // Die Modellwurzel ist ein Datensatz ohne Entity - sie ist KEINE
      // platzierte Instanz und darf die Statuszeile nicht auf 1 hochziehen.
      if (record.entityId !== null) instanceCount++
      const build = this.builds.get(record.definitionId)
      if (!build) continue
      triangles += build.triangles
      faceCount += build.faceCount
      edgeCount += build.edgeCount
      if (!B.isEmpty(record.bounds)) {
        B.expandByPointMut(modelBounds, record.bounds.min)
        B.expandByPointMut(modelBounds, record.bounds.max)
      }
      if (instanced.has(record)) continue
      drawCalls += this.addRecordNode(build, record, snapshot, drawFaces, drawEdges)
    }

    this.modelBounds = modelBounds
    this.stats = {
      triangles,
      faces: faceCount,
      edges: edgeCount,
      instances: instanceCount,
      definitions: this.builds.size,
      drawCalls,
    }
  }

  private collectRecords(snapshot: RenderSnapshot, doc: SketchDocument): InstanceRecord[] {
    const out: InstanceRecord[] = []
    const contextPath = snapshot.context?.instancePath ?? []
    const identity = M.identity()

    const pushRecord = (
      entityId: Id | null,
      definitionId: Id,
      path: Id[],
      transform: Mat4Like,
      depth: number,
      materialOverride: Id | null,
      locked: boolean,
    ): void => {
      const build = this.builds.get(definitionId)
      const matrix = new THREE.Matrix4().fromArray(transform as unknown as number[])
      const inverse = matrix.clone().invert()
      const scaleVec = M.getScale(transform)
      const scale = (Math.abs(scaleVec.x) + Math.abs(scaleVec.y) + Math.abs(scaleVec.z)) / 3 || 1
      const bounds = build && !B.isEmpty(build.localBounds) ? B.transform(build.localBounds, transform) : B.empty()
      const inContext = pathsEqual(path, contextPath)
      const dimmed = contextPath.length > 0 && !isPathPrefix(path, contextPath) && !isPathPrefix(contextPath, path)
      out.push({
        entityId,
        definitionId,
        instancePath: path,
        worldTransform: transform,
        worldMatrix: matrix,
        inverseMatrix: inverse,
        scale,
        depth,
        materialOverride,
        dimmed,
        inContext,
        topInstanceId: path.length > 0 ? path[0] : null,
        bounds,
        locked,
      })
    }

    const walk = (definitionId: Id, path: Id[], transform: Mat4Like, depth: number, override: Id | null, locked: boolean): void => {
      if (depth > LIMITS.maxDepth || out.length > LIMITS.maxInstances) return
      const def = doc.definitions[definitionId]
      if (!def) return
      pushRecord(path.length > 0 ? path[path.length - 1] : null, definitionId, path, transform, depth, override, locked)

      for (const childId of def.children ?? []) {
        const entity = doc.entities?.[childId]
        if (!entity || entity.type !== 'instance') continue
        if (entity.hidden) continue
        if (!snapshot.isTagVisible(entity.tagId)) continue
        const instance = entity as InstanceEntity
        const local = Array.isArray(instance.transform) && instance.transform.length === 16 ? instance.transform : identity
        const next = M.multiply(transform, local)
        walk(
          instance.definitionId,
          path.concat(instance.id),
          next,
          depth + 1,
          instance.materialId ?? override,
          locked || entity.locked === true,
        )
      }
    }

    walk(doc.rootId, [], identity, 0, null, false)
    return out
  }

  private addRecordNode(
    build: DefinitionBuild,
    record: InstanceRecord,
    snapshot: RenderSnapshot,
    drawFaces: boolean,
    drawEdges: boolean,
  ): number {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.matrix.copy(record.worldMatrix)
    group.matrixWorldNeedsUpdate = true
    group.userData.definitionId = record.definitionId
    group.userData.instancePath = record.instancePath

    let drawCalls = 0
    if (drawFaces) {
      for (const fg of build.faceGroups) {
        const front = new THREE.Mesh(
          fg.geometry,
          this.materials.face(fg.frontMaterialId, 'front', { dim: record.dimmed, override: record.materialOverride }),
        )
        front.matrixAutoUpdate = false
        front.castShadow = true
        front.receiveShadow = true
        group.add(front)

        const back = new THREE.Mesh(
          fg.geometry,
          this.materials.face(fg.backMaterialId, 'back', { dim: record.dimmed, override: record.materialOverride }),
        )
        back.matrixAutoUpdate = false
        back.castShadow = false
        back.receiveShadow = true
        group.add(back)
        drawCalls += 2
      }
    }

    if (drawEdges) drawCalls += this.addEdgeObjects(group, build, snapshot, record.dimmed)

    this.root.add(group)
    return drawCalls
  }

  private addEdgeObjects(
    target: THREE.Object3D,
    build: DefinitionBuild,
    snapshot: RenderSnapshot,
    dimmed: boolean,
  ): number {
    const style = snapshot.style
    let drawCalls = 0
    for (const cls of EDGE_CLASSES) {
      const geometry = build.lineGeometries[cls]
      if (!geometry) continue
      const material = this.edgeMaterials.materialFor(cls, style)
      const line = createLineObject(geometry, material, cls === 'hidden' || cls === 'guide')
      line.visible = !dimmed || cls !== 'guide'
      target.add(line)
      drawCalls++

      if (style.jitterEdges && (cls === 'normal' || cls === 'profile')) {
        const jitterLine = createLineObject(geometry, this.edgeMaterials.jitter, false)
        target.add(jitterLine)
        drawCalls++
      }
    }

    if (style.displayEndpoints && build.endpoints.length >= 3 && build.edgeCount <= LIMITS.maxEndpointEdges) {
      const points = buildEndpoints(build.endpoints, this.edgeMaterials.endpointMaterial)
      if (points) {
        points.matrixAutoUpdate = false
        target.add(points)
        drawCalls++
      }
    }
    return drawCalls
  }

  private addInstanced(
    build: DefinitionBuild,
    records: InstanceRecord[],
    snapshot: RenderSnapshot,
    drawFaces: boolean,
    drawEdges: boolean,
  ): number {
    const first = records[0]
    let drawCalls = 0

    if (drawFaces) {
      for (const fg of build.faceGroups) {
        for (const side of ['front', 'back'] as const) {
          const material = this.materials.face(side === 'front' ? fg.frontMaterialId : fg.backMaterialId, side, {
            dim: first.dimmed,
            override: first.materialOverride,
          })
          const mesh = new THREE.InstancedMesh(fg.geometry, material, records.length)
          for (let i = 0; i < records.length; i++) mesh.setMatrixAt(i, records[i].worldMatrix)
          mesh.instanceMatrix.needsUpdate = true
          mesh.castShadow = side === 'front'
          mesh.receiveShadow = true
          mesh.computeBoundingSphere()
          this.root.add(mesh)
          drawCalls++
        }
      }
    }

    if (drawEdges) {
      const style = snapshot.style
      for (const cls of EDGE_CLASSES) {
        const bucket = build.edges.buckets[cls]
        if (bucket.segments === 0) continue
        if (bucket.segments * records.length > LIMITS.maxBakedEdgeSegments) {
          // zu gross zum Backen - dann lieber pro Instanz zeichnen
          const geometry = build.lineGeometries[cls]
          if (!geometry) continue
          for (const record of records) {
            const line = createLineObject(geometry, this.edgeMaterials.materialFor(cls, style), cls === 'hidden' || cls === 'guide')
            line.matrixAutoUpdate = false
            line.matrix.copy(record.worldMatrix)
            line.matrixWorldNeedsUpdate = true
            this.root.add(line)
            drawCalls++
          }
          continue
        }
        const baked = bakeEdgePositions(bucket.positions, bucket.segments, records)
        const geometry = lineGeometryFromPositions(baked)
        if (!geometry) continue
        const line = createLineObject(geometry, this.edgeMaterials.materialFor(cls, style), cls === 'hidden' || cls === 'guide')
        line.userData.ownGeometry = true
        this.root.add(line)
        drawCalls++
      }
    }
    return drawCalls
  }

  /* ---------------------------------------------------------------- */
  /* Abfragen fuer andere Module                                      */
  /* ---------------------------------------------------------------- */

  getBuild(definitionId: Id): DefinitionBuild | undefined {
    return this.builds.get(definitionId)
  }

  /** Huelle einer Definition inklusive aller verschachtelten Instanzen. */
  definitionBounds(doc: SketchDocument, definitionId: Id, depth = 0): BBox3Like {
    if (depth === 0) {
      const cached = this.definitionBoundsCache.get(definitionId)
      if (cached) return cached
    }
    if (depth > LIMITS.maxDepth) return B.empty()
    const def = doc.definitions[definitionId]
    if (!def) return B.empty()
    const build = this.builds.get(definitionId)
    let bounds = build ? B.clone(build.localBounds) : B.empty()
    for (const childId of def.children ?? []) {
      const entity = doc.entities?.[childId]
      if (!entity || entity.type !== 'instance') continue
      const child = this.definitionBounds(doc, entity.definitionId, depth + 1)
      if (B.isEmpty(child)) continue
      bounds = B.union(bounds, B.transform(child, entity.transform))
    }
    if (depth === 0) this.definitionBoundsCache.set(definitionId, bounds)
    return bounds
  }

  /* ---------------------------------------------------------------- */

  private disposeTree(): void {
    for (const child of this.root.children.slice()) {
      child.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (node.userData.ownGeometry && mesh.geometry) mesh.geometry.dispose()
        const instancedMesh = node as THREE.InstancedMesh
        if (instancedMesh.isInstancedMesh) instancedMesh.dispose()
      })
      child.removeFromParent()
    }
    this.root.clear()
  }

  dispose(): void {
    this.disposeTree()
    for (const build of this.builds.values()) disposeBuild(build)
    this.builds.clear()
    this.recordList = []
  }
}

function disposeBuild(build: DefinitionBuild): void {
  for (const fg of build.faceGroups) fg.geometry.dispose()
  for (const cls of EDGE_CLASSES) build.lineGeometries[cls]?.dispose()
  build.faceGroups = []
  build.lineGeometries = {}
}

function pathsEqual(a: readonly Id[], b: readonly Id[]): boolean {
  return a.length === b.length && isPathPrefix(a, b)
}

function bakeEdgePositions(positions: Float32Array, segments: number, records: InstanceRecord[]): Float32Array {
  const out = new Float32Array(segments * 6 * records.length)
  const p = new THREE.Vector3()
  let o = 0
  for (const record of records) {
    const m = record.worldMatrix
    for (let i = 0; i < segments * 2; i++) {
      p.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyMatrix4(m)
      out[o++] = p.x
      out[o++] = p.y
      out[o++] = p.z
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Flaechen                                                            */
/* ------------------------------------------------------------------ */

interface GroupAccum {
  frontMaterialId: Id | null
  backMaterialId: Id | null
  positions: number[]
  normals: number[]
  uv: number[]
  uv1: number[]
  indices: number[]
  /** Flaechen-Id je Dreieck */
  faceIds: Id[]
  vertexCount: number
}

interface FaceBuildResult {
  groups: FaceGroup[]
  /** Dreiecke der Triangulierung */
  triangles: number
  /** gezeichnete `Face`-Objekte */
  faces: number
  bounds: BBox3Like
}

function buildFaceGroups(geom: Geometry, snapshot: RenderSnapshot, doc: SketchDocument): FaceBuildResult {
  const style = snapshot.style
  const groups = new Map<string, GroupAccum>()
  const bounds = B.empty()
  let triangles = 0
  let faces = 0

  const smoothNormals = buildSmoothNormals(geom)
  const vertexByKey = smoothNormals ? buildVertexKeyMap(geom) : null

  for (const faceId of Object.keys(geom.faces)) {
    const face = geom.faces[faceId]
    if (!face) continue
    if (face.hidden && !style.showHiddenGeometry) continue
    if (!snapshot.isTagVisible(face.tagId)) continue

    const tri = attempt<{ positions: Float32Array; normals: Float32Array; indices: Uint32Array } | null>(
      'core.triangulateFace',
      () => core.triangulateFace(geom, faceId),
      null,
    )
    if (!tri || !tri.positions || tri.positions.length < 9 || !tri.indices || tri.indices.length < 3) continue

    const key = `${face.frontMaterialId ?? '-'}|${face.backMaterialId ?? '-'}`
    let group = groups.get(key)
    if (!group) {
      group = {
        frontMaterialId: face.frontMaterialId ?? null,
        backMaterialId: face.backMaterialId ?? null,
        positions: [],
        normals: [],
        uv: [],
        uv1: [],
        indices: [],
        faceIds: [],
        vertexCount: 0,
      }
      groups.set(key, group)
    }

    const frontUv = makeUvProjector(face, 'front', doc.materials?.[face.frontMaterialId ?? ''] ?? undefined)
    const backUv = makeUvProjector(face, 'back', doc.materials?.[face.backMaterialId ?? ''] ?? undefined)

    const base = group.vertexCount
    const count = Math.floor(tri.positions.length / 3)
    const hasNormals = tri.normals && tri.normals.length >= count * 3

    for (let i = 0; i < count; i++) {
      const x = tri.positions[i * 3]
      const y = tri.positions[i * 3 + 1]
      const z = tri.positions[i * 3 + 2]
      const point: Vec3Like = { x, y, z }
      group.positions.push(x, y, z)
      B.expandByPointMut(bounds, point)

      let nx = hasNormals ? tri.normals[i * 3] : face.normal.x
      let ny = hasNormals ? tri.normals[i * 3 + 1] : face.normal.y
      let nz = hasNormals ? tri.normals[i * 3 + 2] : face.normal.z
      if (smoothNormals && vertexByKey) {
        const vertexId = vertexByKey.get(V.key(point))
        if (vertexId) {
          const smooth = smoothNormals.get(`${vertexId}|${faceId}`)
          if (smooth) {
            nx = smooth.x
            ny = smooth.y
            nz = smooth.z
          }
        }
      }
      group.normals.push(nx, ny, nz)

      const uvFront = frontUv(point)
      group.uv.push(uvFront[0], uvFront[1])
      const uvBack = backUv(point)
      group.uv1.push(uvBack[0], uvBack[1])
    }

    for (let i = 0; i < tri.indices.length; i++) group.indices.push(base + tri.indices[i])
    const faceTriangles = Math.floor(tri.indices.length / 3)
    for (let i = 0; i < faceTriangles; i++) group.faceIds.push(faceId)
    group.vertexCount += count
    triangles += faceTriangles
    faces++
  }

  const out: FaceGroup[] = []
  for (const group of groups.values()) {
    if (group.vertexCount === 0 || group.indices.length < 3) continue
    // Positionen und Indizes werden EINMAL als typisierte Arrays angelegt und
    // sowohl an three.js als auch an das Picking weitergereicht.
    const positions = new Float32Array(group.positions)
    const indices = new Uint32Array(group.indices)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(group.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(group.uv, 2))
    geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(group.uv1, 2))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    out.push({
      frontMaterialId: group.frontMaterialId,
      backMaterialId: group.backMaterialId,
      geometry,
      triangles: Math.floor(group.indices.length / 3),
      positions,
      indices,
      faceIds: group.faceIds,
    })
  }

  return { groups: out, triangles, faces, bounds }
}

/* ------------------------------------------------------------------ */
/* Glaettung                                                           */
/* ------------------------------------------------------------------ */

function buildVertexKeyMap(geom: Geometry): Map<string, Id> {
  const map = new Map<string, Id>()
  for (const vertexId of Object.keys(geom.vertices)) {
    const vertex = geom.vertices[vertexId]
    if (vertex && vertex.p) map.set(V.key(vertex.p), vertexId)
  }
  return map
}

/**
 * Gemittelte Normalen fuer geglaettete Kanten.
 *
 * Pro Vertex werden die angrenzenden Flaechen ueber `smooth`-Kanten in Gruppen
 * zusammengefasst (Union-Find); innerhalb einer Gruppe wird die Normale
 * gemittelt. Ergebnis ist eine Zuordnung `"vertexId|faceId" -> Normale`.
 * Liefert null, wenn die Geometrie gar keine geglaetteten Kanten hat.
 */
function buildSmoothNormals(geom: Geometry): Map<string, Vec3Like> | null {
  let hasSmooth = false
  for (const edgeId of Object.keys(geom.edges)) {
    if (geom.edges[edgeId]?.smooth) {
      hasSmooth = true
      break
    }
  }
  if (!hasSmooth) return null

  const out = new Map<string, Vec3Like>()

  for (const vertexId of Object.keys(geom.vertices)) {
    const vertex = geom.vertices[vertexId]
    if (!vertex || !Array.isArray(vertex.edges)) continue

    const faces: Id[] = []
    const faceIndex = new Map<Id, number>()
    for (const edgeId of vertex.edges) {
      const edge = geom.edges[edgeId]
      if (!edge) continue
      for (const faceId of edge.faces ?? []) {
        if (!faceIndex.has(faceId) && geom.faces[faceId]) {
          faceIndex.set(faceId, faces.length)
          faces.push(faceId)
        }
      }
    }
    if (faces.length < 2) continue

    const parent = faces.map((_, i) => i)
    const find = (i: number): number => {
      let root = i
      while (parent[root] !== root) root = parent[root]
      while (parent[i] !== root) {
        const next = parent[i]
        parent[i] = root
        i = next
      }
      return root
    }
    const union = (a: number, b: number): void => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent[ra] = rb
    }

    let joined = false
    for (const edgeId of vertex.edges) {
      const edge = geom.edges[edgeId]
      if (!edge || !edge.smooth || (edge.faces?.length ?? 0) !== 2) continue
      const i0 = faceIndex.get(edge.faces[0])
      const i1 = faceIndex.get(edge.faces[1])
      if (i0 === undefined || i1 === undefined) continue
      union(i0, i1)
      joined = true
    }
    if (!joined) continue

    const sums = new Map<number, Vec3Like>()
    for (let i = 0; i < faces.length; i++) {
      const normal = geom.faces[faces[i]]?.normal
      if (!normal) continue
      const root = find(i)
      const current = sums.get(root)
      sums.set(
        root,
        current
          ? { x: current.x + normal.x, y: current.y + normal.y, z: current.z + normal.z }
          : { x: normal.x, y: normal.y, z: normal.z },
      )
    }

    for (let i = 0; i < faces.length; i++) {
      const faceNormal = geom.faces[faces[i]]?.normal
      if (!faceNormal) continue
      const sum = sums.get(find(i))
      if (!sum) continue
      out.set(`${vertexId}|${faces[i]}`, V.normalizeOr(sum, faceNormal))
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* UV                                                                  */
/* ------------------------------------------------------------------ */

type UvProjector = (p: Vec3Like) => [number, number]

/**
 * Baut die UV-Projektion einer Flaechenseite.
 *
 * Vorrang hat ein explizites `UvMapping` (SketchUp-Texturpositionierung mit
 * vier Punkten), sonst wird planar in der Flaechenebene projiziert, wobei
 * `material.textureWidth/Height` die Kachelgroesse in Metern angeben.
 */
function makeUvProjector(face: Face, side: 'front' | 'back', material: Material | undefined): UvProjector {
  const mapping: UvMapping | undefined = side === 'front' ? face.uvFront : face.uvBack
  const tileW = positiveOr(material?.textureWidth, 1)
  const tileH = positiveOr(material?.textureHeight, 1)

  if (mapping && mapping.origin && mapping.xAxis && mapping.yAxis) {
    const origin = mapping.origin
    const xAxis = V.normalizeOr(mapping.xAxis, V.AXIS_X)
    const yAxis = V.normalizeOr(mapping.yAxis, V.AXIS_Y)
    const m = Array.isArray(mapping.m) && mapping.m.length >= 6 ? mapping.m : null

    if (m) {
      return (p: Vec3Like) => {
        const rel = V.sub(p, origin)
        const s = V.dot(rel, xAxis)
        const t = V.dot(rel, yAxis)
        return [m[0] * s + m[1] * t + m[2], m[3] * s + m[4] * t + m[5]]
      }
    }

    const scaleU = positiveOr(mapping.scaleU, tileW)
    const scaleV = positiveOr(mapping.scaleV, tileH)
    const rot = Number.isFinite(mapping.rotation) ? mapping.rotation : 0
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const offsetU = Number.isFinite(mapping.offsetU) ? mapping.offsetU : 0
    const offsetV = Number.isFinite(mapping.offsetV) ? mapping.offsetV : 0
    const flipU = mapping.flipU === true ? -1 : 1
    const flipV = mapping.flipV === true ? -1 : 1

    return (p: Vec3Like) => {
      const rel = V.sub(p, origin)
      const s = V.dot(rel, xAxis)
      const t = V.dot(rel, yAxis)
      const u = (s * cos + t * sin) / scaleU + offsetU
      const v = (-s * sin + t * cos) / scaleV + offsetV
      return [u * flipU, v * flipV]
    }
  }

  // planare Standardprojektion in der Flaechenebene
  const plane = face.plane && face.plane.n ? face.plane : P.fromNormalAndPoint(face.normal, V.ORIGIN)
  const frame = P.basis(plane)
  const origin = V.mul(plane.n, plane.d)
  const u = frame.u
  const v = frame.v
  // Rueckseite spiegeln, damit die Textur von hinten nicht seitenverkehrt wirkt
  const uSign = side === 'back' ? -1 : 1

  return (p: Vec3Like) => {
    const rel = V.sub(p, origin)
    return [(V.dot(rel, u) / tileW) * uSign, V.dot(rel, v) / tileH]
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 1e-9 ? Math.abs(value) : fallback
}
