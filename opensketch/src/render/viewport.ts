/**
 * Der Viewport - Implementierung von `ViewportApi`.
 *
 * Er haelt den WebGL-Renderer, die Szene und alle Untersysteme zusammen und
 * steuert den Frame-Takt. Gezeichnet wird strikt ON DEMAND: `requestRender()`
 * plant genau EIN `requestAnimationFrame` ein; eine Dauerschleife laeuft nur,
 * solange eine Kamerafahrt aktiv ist.
 *
 * Aufbau der Szene:
 *
 *   scene
 *   ├── environment   Himmel, Boden, Raster, Achsen   (folgt der Kamera)
 *   ├── lights        Sonne oder neutrale Beleuchtung
 *   ├── modelRoot     Flaechen und Kanten aus `sceneSync`
 *   ├── sections      Schnittflaechen-Fuellung (Stencil)
 *   ├── annotations   Bemassungen, Texte, Hilfslinien, Bilder (Dokumentinhalt)
 *   ├── selection     Auswahl, Hover, Kontextrahmen
 *   └── overlay       Werkzeug-Feedback im Immediate-Mode
 *
 * Ueber dem WebGL-Canvas liegt eine zweite Canvas-2D-Ebene fuer Text, Marker und
 * Bildschirmformen - dadurch bleibt Text pixelgenau scharf. Sie traegt zwei
 * Dinge: den Annotationstext (Dokumentinhalt) und das Werkzeug-Overlay. Nur der
 * Annotationstext gehoert auch in `captureImage`.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { B, M } from '@/core/math'
import { bus } from '@/shared/events'
import type { StoreHandle, ViewportApi } from '@/shared/store-api'
import type {
  BBox3Like,
  CameraState,
  Cursor,
  Id,
  PickHit,
  PickOptions,
  Scene as SceneEntity,
  Selection,
  StandardView,
  Vec2Like,
  Vec3Like,
} from '@/shared/types'
import { AnnotationLayer, type AnnotationHost } from './annotations'
import { CameraController } from './camera'
import { LIMITS } from './defaults'
import { EdgeMaterials } from './edges'
import { LightRig } from './lights'
import { MaterialCache } from './materials'
import { OverlayRenderer } from './overlay'
import { Picker } from './picking'
import { SceneSync } from './sceneSync'
import { SectionManager } from './sections'
import { SelectionView } from './selection'
import { readSnapshot, revisionsEqual, zeroRevisions, type RenderSnapshot, type Revisions } from './snapshot'
import { Environment } from './styles'
import { attempt, clamp, warnOnce } from './util'

export interface ViewportDeps {
  store: StoreHandle
}

/** Wie lange eine Szenenfahrt dauert, wenn die Szene nichts vorgibt. */
const DEFAULT_SCENE_TRANSITION_S = 0.8

/** Kleinster Abstand zwischen zwei Renderwert-Aktualisierungen der Statuszeile. */
const STATS_INTERVAL_MS = 1000

export class Viewport implements ViewportApi {
  readonly overlay: OverlayRenderer

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly cameraController: CameraController
  private readonly materials: MaterialCache
  private readonly edgeMaterials = new EdgeMaterials()
  private readonly sync: SceneSync
  private readonly environment = new Environment()
  private readonly lights = new LightRig()
  private readonly sections = new SectionManager()
  private readonly annotations: AnnotationLayer
  private readonly selectionView: SelectionView
  private readonly picker: Picker

  private readonly canvas: HTMLCanvasElement
  private readonly layer: HTMLCanvasElement | null
  private readonly layerContext: CanvasRenderingContext2D | null
  private readonly resizeObserver: ResizeObserver | null
  private readonly unsubscribe: (() => void)[] = []

  private snapshot: RenderSnapshot
  /** Stand, den `syncScene` zuletzt VERARBEITET hat */
  private lastRevisions: Revisions = zeroRevisions()
  /** Stand, den das Store-Abonnement zuletzt GESEHEN hat (nur zur Frame-Anforderung) */
  private seenRevisions: Revisions = zeroRevisions()

  private width = 1
  private height = 1
  private pixelRatio = 1

  private rafHandle = 0
  private disposed = false
  private lastFrameTime = 0
  private fps = 0
  /** Kennwerte des letzten Modell-Pushs, als Vergleichsschluessel */
  private lastStatsKey = ''
  private lastRenderStatsPush = 0
  private renderStatsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(canvas: HTMLCanvasElement, private readonly store: StoreHandle) {
    this.canvas = canvas

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0xffffff, 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.localClippingEnabled = true
    this.renderer.autoClear = true

    this.snapshot = readSnapshot(store)

    this.cameraController = new CameraController(() => {
      bus.emit('camera:changed', this.cameraController.getState())
      this.requestRender()
    })

    this.materials = new MaterialCache(this.snapshot.style, () => this.requestRender())
    this.sync = new SceneSync(this.materials, this.edgeMaterials)
    this.annotations = new AnnotationLayer(() => this.requestRender())
    this.selectionView = new SelectionView(this.sync)
    this.picker = new Picker(this.sync, this.cameraController)

    this.overlay = new OverlayRenderer({
      worldToScreen: (p) => this.cameraController.worldToScreen(p),
      pixelsPerUnit: (p) => this.cameraController.pixelsPerUnit(p),
      getSize: () => this.getSize(),
    })

    this.scene.add(
      this.environment.group,
      this.lights.group,
      this.sync.root,
      this.sections.group,
      this.annotations.group,
      this.selectionView.group,
      this.overlay.group,
    )

    /* ---------------- 2D-Ebene ueber dem Canvas ---------------- */
    const layer = createLayerCanvas(canvas)
    this.layer = layer
    this.layerContext = layer ? layer.getContext('2d') : null
    if (!layer) warnOnce('overlay2d', new Error('Kein Elternelement fuer die Textebene gefunden'))

    /* ---------------- Groessenaenderung ---------------- */
    this.resizeObserver = createResizeObserver(() => this.requestRender())
    const observed = canvas.parentElement ?? canvas
    this.resizeObserver?.observe(observed)

    this.updateSize(true)
    this.subscribe()
    this.requestRender()
  }

  /* ================================================================ */
  /* Abonnements                                                      */
  /* ================================================================ */

  private subscribe(): void {
    const unsubscribeStore = attempt(
      'store.subscribe',
      () =>
        this.store.subscribe((state) => {
          const revisions: Revisions = {
            geometry: state.geometryRevision ?? 0,
            scene: state.sceneRevision ?? 0,
            material: state.materialRevision ?? 0,
            style: state.styleRevision ?? 0,
            selection: state.selectionRevision ?? 0,
          }
          // NICHT `lastRevisions` schreiben: der Vergleich in `syncScene` waere
          // sonst immer schon erfuellt, bevor der Frame ueberhaupt laeuft.
          if (revisionsEqual(revisions, this.seenRevisions)) return
          this.seenRevisions = revisions
          this.requestRender()
        }),
      null,
    )
    if (unsubscribeStore) this.unsubscribe.push(unsubscribeStore)

    this.unsubscribe.push(
      bus.on('geometry:changed', ({ definitionId, full }) => {
        if (full || !definitionId) this.sync.markAllDirty()
        else this.sync.markDefinitionDirty(definitionId)
        this.selectionView.invalidate()
        this.annotations.invalidate()
        this.requestRender()
      }),
      bus.on('scene:changed', () => {
        this.sync.markTreeDirty()
        this.selectionView.invalidate()
        this.annotations.invalidate()
        this.requestRender()
      }),
      bus.on('material:changed', () => {
        this.sync.markTreeDirty()
        this.annotations.invalidate()
        this.requestRender()
      }),
      bus.on('style:changed', () => {
        this.sync.markTreeDirty()
        this.annotations.invalidate()
        this.requestRender()
      }),
      bus.on('selection:changed', () => {
        this.selectionView.invalidate()
        this.annotations.invalidate()
        this.requestRender()
      }),
      bus.on('context:changed', () => {
        this.sync.markTreeDirty()
        this.selectionView.invalidate()
        this.annotations.invalidate()
        this.requestRender()
      }),
      bus.on('document:loaded', () => {
        this.sync.markAllDirty()
        this.selectionView.invalidate()
        this.annotations.invalidate()
        this.requestRender()
      }),
      bus.on('scene:activate', (scene) => this.animateToScene(scene)),
      bus.on('camera:command', ({ command, view }) => {
        switch (command) {
          case 'zoomExtents':
            this.zoomExtents(true)
            break
          case 'zoomSelection':
            this.zoomSelection(true)
            break
          case 'standardView':
            this.setStandardView(view ?? 'iso', true)
            break
          case 'toggleProjection':
            this.setProjection(this.cameraController.isPerspective ? 'parallel' : 'perspective')
            break
          default:
            break
        }
      }),
    )
  }

  /* ================================================================ */
  /* Frame-Steuerung                                                  */
  /* ================================================================ */

  requestRender(): void {
    if (this.disposed || this.rafHandle !== 0) return
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(() => fn(nowMs()), 16) as unknown as number
    this.rafHandle = schedule(() => this.frame())
  }

  private frame(): void {
    this.rafHandle = 0
    if (this.disposed) return

    const now = nowMs()
    const animating = attempt('camera.tick', () => this.cameraController.tick(now), false)

    this.updateSize(false)
    this.syncScene()
    this.renderFrame(now)

    if (animating) this.requestRender()
  }

  /** Bringt alle Untersysteme auf den Stand des Stores. */
  private syncScene(): void {
    const snapshot = readSnapshot(this.store)
    this.snapshot = snapshot

    const materialsChanged = snapshot.revisions.material !== this.lastRevisions.material
    if (attempt('materials.update', () => this.materials.update(snapshot.doc, snapshot.style, materialsChanged), false)) {
      this.sync.markTreeDirty()
    }

    const changed = attempt('sceneSync.update', () => this.sync.update(snapshot), false)
    if (changed) {
      this.cameraController.setSceneBounds(this.sync.modelBounds)
      this.selectionView.invalidate()
      this.annotations.invalidate()
    }

    const lights = attempt(
      'lights.apply',
      () => this.lights.apply(snapshot.sun, this.sync.modelBounds, this.cameraController.viewDirection),
      null,
    )

    attempt(
      'environment.apply',
      () => this.environment.apply(this.scene, snapshot.style, snapshot.fog, lights?.groundShadows === true),
      undefined,
    )

    const depth = this.cameraController.depthRange()
    const worldScale = Math.max(this.cameraController.distance, 1e-3)
    attempt('edgeMaterials.apply', () => this.edgeMaterials.apply(snapshot.style, worldScale, depth.near, depth.far), undefined)

    attempt('sections.update', () => this.sections.update(snapshot, this.sync, this.renderer), undefined)
    attempt('annotations.update', () => this.annotations.update(snapshot, this.sync), undefined)
    attempt('selection.update', () => this.selectionView.update(snapshot), undefined)

    this.lastRevisions = { ...snapshot.revisions }
  }

  private renderFrame(now: number): void {
    const cameraPosition = new THREE.Vector3()
    const state = this.cameraController.getState()
    cameraPosition.set(state.eye.x, state.eye.y, state.eye.z)
    const viewRadius = Math.max(
      this.cameraController.distance,
      B.isEmpty(this.sync.modelBounds) ? 10 : B.diagonal(this.sync.modelBounds),
    )
    this.environment.follow(cameraPosition, viewRadius)
    this.overlay.flush()

    try {
      this.renderer.render(this.scene, this.cameraController.camera)
    } catch (err) {
      warnOnce('renderer.render', err)
    }

    this.draw2dLayer()

    const delta = now - this.lastFrameTime
    this.lastFrameTime = now
    if (delta > 0 && delta < 2000) {
      const instant = 1000 / delta
      this.fps = this.fps === 0 ? instant : this.fps * 0.85 + instant * 0.15
    }

    const stats = this.sync.stats
    bus.emit('render:frame', {
      fps: Math.round(this.fps),
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
    })

    this.pushModelStats()
    this.pushRenderStats(now)
  }

  /* ================================================================ */
  /* Statuszeile                                                      */
  /* ================================================================ */

  /**
   * Modellkennwerte in den Store schreiben.
   *
   * Bewusst NICHT zeitgedrosselt, sondern an den Inhalt gehaengt: die Werte
   * aendern sich nur, wenn `sceneSync` neu gebaut hat, also hoechstens einmal
   * pro Bearbeitungsschritt. Eine Zeitdrosselung wuerde hier die letzte
   * Aktualisierung verschlucken, weil nach einer Aenderung genau EIN Frame
   * laeuft und danach keiner mehr kommt, der sie nachholen koennte.
   */
  private pushModelStats(): void {
    const stats = this.sync.stats
    const key = `${stats.faces}|${stats.edges}|${stats.instances}`
    if (key === this.lastStatsKey) return
    this.lastStatsKey = key
    this.writeStats({ faces: stats.faces, edges: stats.edges, instances: stats.instances })
  }

  /**
   * Renderwerte (Dreiecke, FPS) getrennt und gedrosselt schreiben - hoechstens
   * einmal pro Sekunde, damit die Oberflaeche nicht bei jedem Frame neu
   * rendert. Greift die Drosselung, wird der Push per Timer ans Ende des
   * Fensters NACHGEHOLT; verworfen wird er nie. Genau daran hing der
   * eingefrorene Zaehler: nach einer Aenderung laeuft ein einziger Frame, ein
   * verworfener Push wird also von keinem spaeteren Frame nachgeholt.
   */
  private pushRenderStats(now: number): void {
    const wait = STATS_INTERVAL_MS - (now - this.lastRenderStatsPush)
    if (wait > 0) {
      this.scheduleRenderStats(wait)
      return
    }
    this.clearRenderStatsTimer()
    this.lastRenderStatsPush = now
    this.writeRenderStats()
  }

  private scheduleRenderStats(delayMs: number): void {
    if (this.renderStatsTimer !== null || this.disposed) return
    this.renderStatsTimer = setTimeout(() => {
      this.renderStatsTimer = null
      if (this.disposed) return
      this.lastRenderStatsPush = nowMs()
      this.writeRenderStats()
    }, Math.max(0, delayMs))
  }

  private writeRenderStats(): void {
    this.writeStats({ triangles: this.sync.stats.triangles, fps: Math.round(this.fps) })
  }

  private clearRenderStatsTimer(): void {
    if (this.renderStatsTimer === null) return
    clearTimeout(this.renderStatsTimer)
    this.renderStatsTimer = null
  }

  private writeStats(patch: Partial<{ faces: number; edges: number; instances: number; triangles: number; fps: number }>): void {
    attempt('store.setStats', () => this.store.getState().setStats(patch), undefined)
  }

  /**
   * Textebene neu zeichnen. Reihenfolge zaehlt: erst der Annotationstext
   * (Dokumentinhalt), darueber das Werkzeug-Overlay.
   */
  private draw2dLayer(): void {
    const ctx = this.layerContext
    if (!ctx) return
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)

    if (this.annotations.hasScreenContent) {
      try {
        this.annotations.draw2d(ctx, this.annotationHost())
      } catch (err) {
        warnOnce('annotations.draw2d', err)
      }
    }

    if (!this.overlay.hasScreenContent) return
    try {
      this.overlay.draw2d(ctx)
    } catch (err) {
      warnOnce('overlay.draw2d', err)
    }
  }

  /** Projektion fuer die Textebene - folgt immer der aktuellen Kameragroesse. */
  private annotationHost(): AnnotationHost {
    return {
      worldToScreen: (p) => this.cameraController.worldToScreen(p),
      pixelsPerUnit: (p) => this.cameraController.pixelsPerUnit(p),
      getSize: () => this.getSize(),
    }
  }

  /* ================================================================ */
  /* Groesse                                                          */
  /* ================================================================ */

  private updateSize(force: boolean): void {
    const parent = this.canvas.parentElement
    const width = Math.max(1, Math.round(this.canvas.clientWidth || parent?.clientWidth || 1))
    const height = Math.max(1, Math.round(this.canvas.clientHeight || parent?.clientHeight || 1))
    const ratio = clamp(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1, LIMITS.maxPixelRatio)

    if (!force && width === this.width && height === this.height && ratio === this.pixelRatio) return

    this.width = width
    this.height = height
    this.pixelRatio = ratio

    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(width, height, false)
    this.cameraController.setSize(width, height)
    this.edgeMaterials.setResolution(width * ratio, height * ratio)
    this.environment.setResolution(width * ratio, height * ratio)
    this.selectionView.setResolution(width * ratio, height * ratio)
    this.sections.setResolution(width * ratio, height * ratio)
    this.annotations.setResolution(width * ratio, height * ratio)
    this.overlay.setSize(width * ratio, height * ratio)

    if (this.layer) {
      this.layer.width = Math.round(width * ratio)
      this.layer.height = Math.round(height * ratio)
      this.layer.style.width = `${width}px`
      this.layer.style.height = `${height}px`
    }
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  /* ================================================================ */
  /* Kamera                                                           */
  /* ================================================================ */

  getCamera(): CameraState {
    return this.cameraController.getState()
  }

  setCamera(camera: Partial<CameraState>, animate?: boolean): void {
    this.cameraController.setState(camera, animate === true)
  }

  setStandardView(view: StandardView, animate?: boolean): void {
    this.cameraController.setStandardView(view, animate !== false)
  }

  setProjection(mode: 'perspective' | 'parallel'): void {
    this.cameraController.setProjection(mode)
  }

  /** Zwei-Punkt-Perspektive (kein Teil von `ViewportApi`, von der UI genutzt). */
  setTwoPointPerspective(enabled: boolean): void {
    this.cameraController.setTwoPointPerspective(enabled)
  }

  zoomExtents(animate?: boolean): void {
    const bounds = this.modelBounds()
    if (B.isEmpty(bounds)) {
      this.cameraController.zoomToBounds({ min: { x: -5, y: -5, z: 0 }, max: { x: 5, y: 5, z: 3 } }, animate === true)
      return
    }
    this.cameraController.zoomToBounds(bounds, animate === true)
  }

  zoomSelection(animate?: boolean): void {
    const bounds = this.selectionBounds()
    if (!bounds || B.isEmpty(bounds)) {
      this.zoomExtents(animate)
      return
    }
    this.cameraController.zoomToBounds(bounds, animate === true, 1.35)
  }

  zoomWindow(x0: number, y0: number, x1: number, y1: number): void {
    this.cameraController.zoomWindow(x0, y0, x1, y1)
  }

  orbit(dx: number, dy: number): void {
    this.cameraController.orbit(dx, dy)
  }

  pan(dx: number, dy: number): void {
    this.cameraController.pan(dx, dy)
  }

  dolly(amount: number, screen?: { x: number; y: number }): void {
    this.cameraController.dolly(amount, screen)
  }

  setFov(fov: number): void {
    this.cameraController.setFov(fov)
  }

  positionCamera(eye: Vec3Like, target: Vec3Like, eyeHeight?: number): void {
    this.cameraController.positionCamera(eye, target, eyeHeight)
  }

  animateToScene(scene: SceneEntity): void {
    if (!scene || !scene.camera) return
    const seconds = Number.isFinite(scene.transitionTime) ? scene.transitionTime : DEFAULT_SCENE_TRANSITION_S
    this.cameraController.animateTo(
      {
        ...this.cameraController.getState(),
        ...scene.camera,
      },
      Math.max(0, seconds) * 1000,
    )
    this.requestRender()
  }

  /* ================================================================ */
  /* Projektionshilfen                                                */
  /* ================================================================ */

  screenToRay(x: number, y: number): { origin: Vec3Like; dir: Vec3Like } {
    return this.cameraController.screenToRay(x, y)
  }

  worldToScreen(p: Vec3Like): { x: number; y: number; depth: number; visible: boolean } {
    return this.cameraController.worldToScreen(p)
  }

  pixelsPerUnit(p: Vec3Like): number {
    return this.cameraController.pixelsPerUnit(p)
  }

  /* ================================================================ */
  /* Picking                                                          */
  /* ================================================================ */

  pick(x: number, y: number, options?: PickOptions): PickHit {
    return attempt('picker.pick', () => this.picker.pick(this.snapshot, x, y, options), fallbackHit(this.screenToRay(x, y).origin))
  }

  pickRect(x0: number, y0: number, x1: number, y1: number, crossing: boolean): Selection {
    return attempt('picker.pickRect', () => this.picker.pickRect(this.snapshot, x0, y0, x1, y1, crossing), {
      edgeIds: [],
      faceIds: [],
      vertexIds: [],
      entityIds: [],
    })
  }

  pickLasso(points: Vec2Like[], crossing: boolean): Selection {
    return attempt('picker.pickLasso', () => this.picker.pickLasso(this.snapshot, points, crossing), {
      edgeIds: [],
      faceIds: [],
      vertexIds: [],
      entityIds: [],
    })
  }

  groundHit(x: number, y: number): Vec3Like | null {
    return this.picker.groundHit(x, y)
  }

  /* ================================================================ */
  /* Bild und Cursor                                                  */
  /* ================================================================ */

  async captureImage(opts?: { width?: number; height?: number; transparent?: boolean }): Promise<string> {
    const width = Math.max(1, Math.round(opts?.width ?? this.width))
    const height = Math.max(1, Math.round(opts?.height ?? this.height))
    const transparent = opts?.transparent === true

    const target = new THREE.WebGLRenderTarget(width, height, {
      samples: 4,
      colorSpace: THREE.SRGBColorSpace,
    })

    const previousBackground = this.scene.background
    const previousSize = { width: this.width, height: this.height }

    try {
      this.cameraController.setSize(width, height)
      if (transparent) this.scene.background = null
      this.overlay.flush()
      this.renderer.setRenderTarget(target)
      this.renderer.setClearAlpha(transparent ? 0 : 1)
      this.renderer.clear()
      this.renderer.render(this.scene, this.cameraController.camera)

      const buffer = new Uint8Array(width * height * 4)
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer)

      const canvas = pixelsToCanvas(buffer, width, height)
      if (!canvas) return ''

      // Annotationstext lebt auf der 2D-Ebene und waere im WebGL-Puffer nicht
      // enthalten. Die Kamera steht hier bereits auf Bildgroesse, `draw2d`
      // rechnet also direkt in Bildkoordinaten - ohne Pixelverhaeltnis.
      const ctx = canvas.getContext('2d')
      if (ctx && this.annotations.hasScreenContent) {
        attempt('annotations.capture', () => this.annotations.draw2d(ctx, this.annotationHost()), undefined)
      }
      return canvas.toDataURL('image/png')
    } catch (err) {
      warnOnce('captureImage', err)
      return ''
    } finally {
      this.renderer.setRenderTarget(null)
      this.renderer.setClearAlpha(1)
      this.scene.background = previousBackground
      target.dispose()
      this.cameraController.setSize(previousSize.width, previousSize.height)
      this.requestRender()
    }
  }

  setCursor(cursor: Cursor): void {
    this.canvas.style.cursor = cursor === 'none' ? 'none' : cursor
  }

  /* ================================================================ */
  /* Hilfen                                                           */
  /* ================================================================ */

  /** Modell-Huelle: bevorzugt aus dem Store, sonst aus dem eigenen Cache. */
  private modelBounds(): BBox3Like {
    const fromStore = attempt<BBox3Like | null>('store.getModelBounds', () => this.store.getState().getModelBounds(), null)
    if (fromStore && !B.isEmpty(fromStore)) return fromStore
    return this.sync.modelBounds
  }

  /** Huelle der Auswahl; faellt auf die eigenen Caches zurueck. */
  private selectionBounds(): BBox3Like | null {
    const fromStore = attempt<BBox3Like | null>(
      'store.getSelectionBounds',
      () => this.store.getState().getSelectionBounds(),
      null,
    )
    if (fromStore && !B.isEmpty(fromStore)) return fromStore

    const snapshot = this.snapshot
    const doc = snapshot.doc
    const record = this.picker.contextRecord(snapshot)
    if (!doc || !record) return null
    const geometry = doc.definitions[record.definitionId]?.geometry
    if (!geometry) return null

    const bounds = B.empty()
    const selection = snapshot.selection
    const addVertex = (id: Id): void => {
      const vertex = geometry.vertices[id]
      if (vertex && vertex.p) B.expandByPointMut(bounds, M.transformPoint(record.worldTransform, vertex.p))
    }

    for (const id of selection.vertexIds) addVertex(id)
    for (const id of selection.edgeIds) {
      const edge = geometry.edges[id]
      if (!edge) continue
      addVertex(edge.a)
      addVertex(edge.b)
    }
    for (const id of selection.faceIds) {
      const face = geometry.faces[id]
      if (!face) continue
      for (const vertexId of face.outer?.vertices ?? []) addVertex(vertexId)
    }
    for (const id of selection.entityIds) {
      for (const other of this.sync.records) {
        if (other.entityId === id && !B.isEmpty(other.bounds)) {
          B.expandByPointMut(bounds, other.bounds.min)
          B.expandByPointMut(bounds, other.bounds.max)
        }
      }
    }

    return B.isEmpty(bounds) ? null : bounds
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.rafHandle !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafHandle)
    this.rafHandle = 0
    this.clearRenderStatsTimer()

    for (const off of this.unsubscribe) {
      try {
        off()
      } catch (err) {
        warnOnce('viewport.unsubscribe', err)
      }
    }
    this.unsubscribe.length = 0
    this.resizeObserver?.disconnect()

    this.overlay.dispose()
    this.selectionView.dispose()
    this.annotations.dispose()
    this.sections.dispose()
    this.sync.dispose()
    this.environment.dispose()
    this.lights.dispose()
    this.edgeMaterials.dispose()
    this.materials.dispose()
    this.cameraController.dispose()
    this.scene.clear()
    this.renderer.dispose()
    this.layer?.remove()
  }
}

/* ------------------------------------------------------------------ */
/* Fabrik                                                              */
/* ------------------------------------------------------------------ */

/**
 * Erzeugt den WebGL-Viewport auf dem uebergebenen Canvas.
 * Registriert KEINE Werkzeug-Eventhandler - das macht `@/app/ViewportHost`.
 */
export function createViewport(canvas: HTMLCanvasElement, deps: ViewportDeps): ViewportApi {
  return new Viewport(canvas, deps.store)
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function fallbackHit(origin: Vec3Like): PickHit {
  return {
    kind: 'none',
    point: origin,
    distance: Infinity,
    normal: null,
    id: null,
    definitionId: null,
    instancePath: [],
    worldTransform: M.identity(),
    inContext: false,
    topInstanceId: null,
  }
}

/** Transparente 2D-Ebene ueber dem WebGL-Canvas. */
function createLayerCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const parent = canvas.parentElement
  if (!parent || typeof document === 'undefined') return null
  const layer = document.createElement('canvas')
  layer.style.position = 'absolute'
  layer.style.left = '0'
  layer.style.top = '0'
  layer.style.pointerEvents = 'none'
  layer.style.zIndex = '1'
  layer.className = 'os-overlay-layer'
  parent.appendChild(layer)
  return layer
}

function createResizeObserver(callback: () => void): ResizeObserver | null {
  if (typeof ResizeObserver !== 'function') return null
  return new ResizeObserver(() => callback())
}

/**
 * Rohe RGBA-Pixel in eine Leinwand uebertragen.
 * `readRenderTargetPixels` liefert die Zeilen von unten nach oben - beim
 * Uebertragen in den 2D-Kontext wird deshalb gespiegelt.
 *
 * Gibt die Leinwand zurueck statt direkt die Daten-URL, damit `captureImage`
 * den Annotationstext darueber zeichnen kann, bevor codiert wird.
 */
function pixelsToCanvas(buffer: Uint8Array, width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(width, height)
  const row = width * 4
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * row
    image.data.set(buffer.subarray(src, src + row), y * row)
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
