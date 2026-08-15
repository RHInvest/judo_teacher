/**
 * Kamerasteuerung mit SketchUp-Verhalten.
 *
 *  - Z ist oben, der Horizont bleibt beim Orbit IMMER waagerecht (die Kamera
 *    wird in Kugelkoordinaten um den Pivot gefuehrt, Kippen ist unmoeglich).
 *  - Schwenken laeuft bildschirmparallel und wird mit der Distanz skaliert.
 *  - Zoomen haelt den Punkt unter dem Cursor fest.
 *  - Perspektive und Parallelprojektion behalten beim Umschalten den
 *    Bildausschnitt bei.
 *  - Zwei-Punkt-Perspektive richtet die Blickrichtung waagerecht aus und
 *    verschiebt stattdessen das Projektionszentrum (schiefe Projektionsmatrix),
 *    dadurch bleiben senkrechte Kanten senkrecht.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { B, V } from '@/core/math'
import type { BBox3Like, CameraState, ProjectionMode, StandardView, Vec3Like } from '@/shared/types'
import { DEFAULT_CAMERA } from './defaults'
import { clamp, easeInOut, fromVector3, toVector3 } from './util'

const ORBIT_SPEED = 0.0045
const MIN_POLAR = 0.0015
const MIN_DISTANCE = 1e-3
const MAX_DISTANCE = 1e7
const DEFAULT_TRANSITION_MS = 400

export interface CameraAnimation {
  from: CameraState
  to: CameraState
  start: number
  duration: number
}

function cloneState(s: CameraState): CameraState {
  return {
    eye: { x: s.eye.x, y: s.eye.y, z: s.eye.z },
    target: { x: s.target.x, y: s.target.y, z: s.target.z },
    up: { x: s.up.x, y: s.up.y, z: s.up.z },
    fov: s.fov,
    projection: s.projection,
    orthoHeight: s.orthoHeight,
    twoPointPerspective: s.twoPointPerspective === true,
  }
}

export class CameraController {
  readonly perspective = new THREE.PerspectiveCamera(35, 1, 0.05, 5000)
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000)

  private state: CameraState = cloneState(DEFAULT_CAMERA as CameraState)
  private width = 1
  private height = 1
  private animation: CameraAnimation | null = null
  private sceneBounds: BBox3Like = B.empty()

  constructor(private readonly onChange: () => void) {
    this.perspective.up.set(0, 0, 1)
    this.orthographic.up.set(0, 0, 1)
    this.apply()
  }

  /* ---------------------------------------------------------------- */
  /* Grundlegendes                                                    */
  /* ---------------------------------------------------------------- */

  get camera(): THREE.Camera {
    return this.state.projection === 'parallel' ? this.orthographic : this.perspective
  }

  get isPerspective(): boolean {
    return this.state.projection !== 'parallel'
  }

  get animating(): boolean {
    return this.animation !== null
  }

  getState(): CameraState {
    return cloneState(this.state)
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.apply()
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  /** Modellgrenzen fuer die automatische Near/Far-Anpassung. */
  setSceneBounds(bounds: BBox3Like): void {
    this.sceneBounds = bounds
  }

  get distance(): number {
    return Math.max(MIN_DISTANCE, V.distance(this.state.eye, this.state.target))
  }

  get viewDirection(): Vec3Like {
    return V.normalizeOr(V.sub(this.state.target, this.state.eye), { x: 0, y: 1, z: 0 })
  }

  /* ---------------------------------------------------------------- */
  /* Zustandsuebernahme                                               */
  /* ---------------------------------------------------------------- */

  setState(patch: Partial<CameraState>, animate = false): void {
    const next = cloneState(this.state)
    if (patch.eye) next.eye = { x: patch.eye.x, y: patch.eye.y, z: patch.eye.z }
    if (patch.target) next.target = { x: patch.target.x, y: patch.target.y, z: patch.target.z }
    if (patch.up) next.up = { x: patch.up.x, y: patch.up.y, z: patch.up.z }
    if (typeof patch.fov === 'number' && Number.isFinite(patch.fov)) next.fov = clamp(patch.fov, 1, 160)
    if (patch.projection) next.projection = patch.projection
    if (typeof patch.orthoHeight === 'number' && Number.isFinite(patch.orthoHeight)) {
      next.orthoHeight = Math.max(1e-4, patch.orthoHeight)
    }
    if (typeof patch.twoPointPerspective === 'boolean') next.twoPointPerspective = patch.twoPointPerspective

    if (animate) this.animateTo(next, DEFAULT_TRANSITION_MS)
    else this.commit(next)
  }

  private commit(next: CameraState): void {
    this.state = next
    this.apply()
    this.onChange()
  }

  /**
   * Baut die three.js-Kameras aus dem Zustand auf.
   * Enthaelt die Z-up-Zwangsbedingung und die Zwei-Punkt-Perspektive.
   */
  private apply(): void {
    const s = this.state
    const aspect = this.width / this.height
    const dist = this.distance
    const radius = Math.max(B.isEmpty(this.sceneBounds) ? 10 : B.diagonal(this.sceneBounds) * 0.5, 1)

    const eye = toVector3(s.eye)
    let lookTarget = toVector3(s.target)

    if (s.twoPointPerspective) {
      // Blickrichtung in die Waagerechte drehen, Hoehe kommt spaeter ueber
      // die verschobene Projektionsmatrix zurueck.
      const dir = V.sub(s.target, s.eye)
      const flat = { x: dir.x, y: dir.y, z: 0 }
      const flatLen = Math.hypot(flat.x, flat.y)
      const horizontal = flatLen > 1e-6 ? V.mul(flat, dist / flatLen) : { x: 0, y: dist, z: 0 }
      lookTarget = toVector3(V.add(s.eye, horizontal))
    }

    const cam = this.camera
    cam.position.copy(eye)
    // Z-up-Zwang: nur direkt am Pol (Drauf-/Untersicht) wird der gespeicherte
    // Up-Vektor benutzt, sonst bleibt der Horizont automatisch waagerecht.
    const forward = V.normalizeOr(V.sub(fromVector3(lookTarget), s.eye), { x: 0, y: 1, z: 0 })
    if (Math.abs(forward.z) > 0.999) {
      const fallback = Math.abs(s.up.z) > 0.9 ? { x: 0, y: 1, z: 0 } : s.up
      cam.up.set(fallback.x, fallback.y, fallback.z)
    } else {
      cam.up.set(0, 0, 1)
    }
    cam.lookAt(lookTarget)

    if (cam === this.perspective) {
      const p = this.perspective
      p.fov = clamp(s.fov, 1, 160)
      p.aspect = aspect
      p.near = Math.max(0.02, Math.min(dist * 0.01, Math.max(dist - radius * 1.5, 0.02)))
      p.far = Math.max(dist + radius * 4 + 10, 100)
      p.updateProjectionMatrix()
    } else {
      const o = this.orthographic
      const halfHeight = Math.max(1e-4, s.orthoHeight)
      const halfWidth = halfHeight * aspect
      o.left = -halfWidth
      o.right = halfWidth
      o.top = halfHeight
      o.bottom = -halfHeight
      o.near = -(dist + radius * 4 + 10)
      o.far = dist + radius * 4 + 10
      o.updateProjectionMatrix()
    }

    cam.updateMatrixWorld(true)

    if (s.twoPointPerspective) this.applyTwoPointShift(cam, s.target)
  }

  /**
   * Verschiebt das Projektionszentrum so, dass der urspruengliche Zielpunkt
   * wieder in der Bildmitte liegt - das ist genau die schiefe Projektion einer
   * Zwei-Punkt-Perspektive.
   */
  private applyTwoPointShift(cam: THREE.Camera, target: Vec3Like): void {
    const projected = toVector3(target).project(cam)
    if (!Number.isFinite(projected.y)) return
    const shift = projected.y
    if (Math.abs(shift) < 1e-9) return
    if (cam === this.perspective) {
      cam.projectionMatrix.elements[9] += shift
    } else {
      cam.projectionMatrix.elements[13] -= shift
    }
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
  }

  /* ---------------------------------------------------------------- */
  /* Navigation                                                       */
  /* ---------------------------------------------------------------- */

  /** Orbit in Kugelkoordinaten um das Ziel - der Horizont bleibt waagerecht. */
  orbit(dx: number, dy: number): void {
    const s = cloneState(this.state)
    const offset = V.sub(s.eye, s.target)
    const r = Math.max(V.length(offset), MIN_DISTANCE)
    const horizontal = Math.hypot(offset.x, offset.y)
    let theta =
      horizontal > 1e-9
        ? Math.atan2(offset.y, offset.x)
        : offset.z >= 0
          ? Math.atan2(-s.up.y, -s.up.x)
          : Math.atan2(s.up.y, s.up.x)
    let phi = Math.acos(clamp(offset.z / r, -1, 1))

    theta += dx * ORBIT_SPEED
    phi += dy * ORBIT_SPEED
    phi = clamp(phi, MIN_POLAR, Math.PI - MIN_POLAR)

    const sinPhi = Math.sin(phi)
    s.eye = {
      x: s.target.x + r * sinPhi * Math.cos(theta),
      y: s.target.y + r * sinPhi * Math.sin(theta),
      z: s.target.z + r * Math.cos(phi),
    }
    // Am Pol wird der Up-Vektor aus dem Azimut abgeleitet, damit der
    // Uebergang in die Drauf-/Untersicht nicht springt.
    s.up =
      phi <= MIN_POLAR * 2
        ? { x: -Math.cos(theta), y: -Math.sin(theta), z: 0 }
        : phi >= Math.PI - MIN_POLAR * 2
          ? { x: Math.cos(theta), y: Math.sin(theta), z: 0 }
          : { x: 0, y: 0, z: 1 }
    this.animation = null
    this.commit(s)
  }

  /** Bildschirmparalleles Schwenken, distanzabhaengig skaliert. */
  pan(dx: number, dy: number): void {
    const ppu = this.pixelsPerUnit(this.state.target)
    if (!Number.isFinite(ppu) || ppu <= 1e-9) return
    const cam = this.camera
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
    const delta = right.multiplyScalar(-dx / ppu).add(up.multiplyScalar(dy / ppu))
    const s = cloneState(this.state)
    s.eye = V.add(s.eye, fromVector3(delta))
    s.target = V.add(s.target, fromVector3(delta))
    this.animation = null
    this.commit(s)
  }

  /** Positiv = heranzoomen. `screen` haelt den Punkt unter dem Cursor fest. */
  dolly(amount: number, screen?: { x: number; y: number }): void {
    if (!Number.isFinite(amount) || amount === 0) return
    const factor = Math.pow(0.88, amount)

    const before = screen ? this.pointOnFocalPlane(screen.x, screen.y) : null

    const s = cloneState(this.state)
    if (this.isPerspective) {
      const offset = V.sub(s.eye, s.target)
      const dist = clamp(V.length(offset) * factor, MIN_DISTANCE, MAX_DISTANCE)
      s.eye = V.addScaled(s.target, V.normalizeOr(offset, { x: 0, y: -1, z: 0 }), dist)
    } else {
      s.orthoHeight = clamp(s.orthoHeight * factor, 1e-4, MAX_DISTANCE)
    }
    this.animation = null
    this.state = s
    this.apply()

    if (before && screen) {
      const after = this.pointOnFocalPlane(screen.x, screen.y)
      if (after) {
        const shift = V.sub(before, after)
        this.state.eye = V.add(this.state.eye, shift)
        this.state.target = V.add(this.state.target, shift)
        this.apply()
      }
    }
    this.onChange()
  }

  /** Schnittpunkt eines Bildschirmpunkts mit der Ebene durch das Ziel. */
  private pointOnFocalPlane(x: number, y: number): Vec3Like | null {
    const ray = this.screenToRay(x, y)
    const normal = V.negate(this.viewDirection)
    const denom = V.dot(normal, ray.dir)
    if (Math.abs(denom) < 1e-9) return null
    const t = V.dot(normal, V.sub(this.state.target, ray.origin)) / denom
    if (!Number.isFinite(t)) return null
    return V.addScaled(ray.origin, ray.dir, t)
  }

  setFov(fov: number): void {
    if (!Number.isFinite(fov)) return
    const s = cloneState(this.state)
    s.fov = clamp(fov, 1, 160)
    this.commit(s)
  }

  /** Projektionswechsel unter Beibehaltung des Bildausschnitts. */
  setProjection(mode: ProjectionMode): void {
    if (mode === this.state.projection) return
    const s = cloneState(this.state)
    const dist = this.distance
    const halfFov = (clamp(s.fov, 1, 160) * Math.PI) / 360
    if (mode === 'parallel') {
      s.orthoHeight = Math.max(1e-4, dist * Math.tan(halfFov))
      s.twoPointPerspective = false
    } else {
      const newDist = Math.max(MIN_DISTANCE, s.orthoHeight / Math.max(Math.tan(halfFov), 1e-6))
      const dir = V.normalizeOr(V.sub(s.eye, s.target), { x: 0, y: -1, z: 0 })
      s.eye = V.addScaled(s.target, dir, newDist)
    }
    s.projection = mode
    this.commit(s)
  }

  setTwoPointPerspective(enabled: boolean): void {
    const s = cloneState(this.state)
    s.twoPointPerspective = enabled
    if (enabled) s.projection = 'perspective'
    this.commit(s)
  }

  /** Gehen / Umsehen: Augenpunkt mit Augenhoehe setzen. */
  positionCamera(eye: Vec3Like, target: Vec3Like, eyeHeight?: number): void {
    const s = cloneState(this.state)
    const lift = typeof eyeHeight === 'number' && Number.isFinite(eyeHeight) ? eyeHeight : 0
    s.eye = { x: eye.x, y: eye.y, z: eye.z + lift }
    s.target = lift > 0 ? { x: target.x, y: target.y, z: s.eye.z } : { x: target.x, y: target.y, z: target.z }
    if (V.distance(s.eye, s.target) < MIN_DISTANCE) {
      s.target = V.add(s.eye, { x: 0, y: 1, z: 0 })
    }
    if (lift > 0) s.fov = 60
    s.projection = 'perspective'
    this.animation = null
    this.commit(s)
  }

  /* ---------------------------------------------------------------- */
  /* Einpassen                                                        */
  /* ---------------------------------------------------------------- */

  zoomToBounds(bounds: BBox3Like, animate: boolean, padding = 1.08): void {
    if (B.isEmpty(bounds)) return
    const center = B.center(bounds)
    const radius = Math.max(B.diagonal(bounds) * 0.5, 1e-3)
    const s = cloneState(this.state)
    const dir = V.normalizeOr(V.sub(s.eye, s.target), { x: 0.6, y: -0.7, z: 0.4 })

    const aspect = this.width / this.height
    const halfFovV = (clamp(s.fov, 1, 160) * Math.PI) / 360
    const halfFovH = Math.atan(Math.tan(halfFovV) * aspect)
    const dist = (radius / Math.max(Math.sin(Math.min(halfFovV, halfFovH)), 1e-4)) * padding

    s.target = center
    s.eye = V.addScaled(center, dir, clamp(dist, MIN_DISTANCE, MAX_DISTANCE))
    s.orthoHeight = Math.max(1e-4, (radius * padding) / Math.max(Math.min(1, aspect), 1e-4))

    if (animate) this.animateTo(s, DEFAULT_TRANSITION_MS)
    else this.commit(s)
  }

  /** Zoomfenster: Rechteck in Bildschirmkoordinaten fuellt danach die Ansicht. */
  zoomWindow(x0: number, y0: number, x1: number, y1: number): void {
    const left = Math.min(x0, x1)
    const right = Math.max(x0, x1)
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)
    const w = right - left
    const h = bottom - top
    if (w < 4 || h < 4) return

    const scale = Math.max(w / this.width, h / this.height)
    const centerPoint = this.pointOnFocalPlane((left + right) / 2, (top + bottom) / 2)

    const s = cloneState(this.state)
    if (centerPoint) {
      const shift = V.sub(centerPoint, s.target)
      s.eye = V.add(s.eye, shift)
      s.target = V.add(s.target, shift)
    }
    if (this.isPerspective) {
      const offset = V.sub(s.eye, s.target)
      const dist = clamp(V.length(offset) * scale, MIN_DISTANCE, MAX_DISTANCE)
      s.eye = V.addScaled(s.target, V.normalizeOr(offset, { x: 0, y: -1, z: 0 }), dist)
    } else {
      s.orthoHeight = clamp(s.orthoHeight * scale, 1e-4, MAX_DISTANCE)
    }
    this.animation = null
    this.commit(s)
  }

  /** Standardansichten, Blickrichtung und Up-Vektor wie in SketchUp. */
  setStandardView(view: StandardView, animate = true): void {
    const s = cloneState(this.state)
    const dist = this.distance
    const dir = standardDirection(view)
    s.eye = V.addScaled(s.target, dir, dist)
    s.up = view === 'top' || view === 'bottom' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }
    s.twoPointPerspective = false
    if (animate) this.animateTo(s, DEFAULT_TRANSITION_MS)
    else this.commit(s)
  }

  /* ---------------------------------------------------------------- */
  /* Animation                                                        */
  /* ---------------------------------------------------------------- */

  animateTo(target: CameraState, durationMs: number): void {
    const duration = Math.max(0, durationMs)
    if (duration < 16) {
      this.animation = null
      this.commit(target)
      return
    }
    this.animation = {
      from: cloneState(this.state),
      to: cloneState(target),
      start: performance.now(),
      duration,
    }
  }

  /** Rechnet die laufende Animation weiter. Gibt true zurueck, solange sie laeuft. */
  tick(now: number): boolean {
    const anim = this.animation
    if (!anim) return false
    const raw = anim.duration <= 0 ? 1 : (now - anim.start) / anim.duration
    const t = easeInOut(clamp(raw, 0, 1))

    const next = cloneState(anim.to)
    next.target = V.lerpV(anim.from.target, anim.to.target, t)

    // Blickrichtung interpolieren (Slerp), Abstand linear
    const fromOffset = V.sub(anim.from.eye, anim.from.target)
    const toOffset = V.sub(anim.to.eye, anim.to.target)
    const fromLen = V.length(fromOffset)
    const toLen = V.length(toOffset)
    const dir = slerp(V.normalizeOr(fromOffset, { x: 0, y: -1, z: 0 }), V.normalizeOr(toOffset, { x: 0, y: -1, z: 0 }), t)
    next.eye = V.addScaled(next.target, dir, fromLen + (toLen - fromLen) * t)

    next.fov = anim.from.fov + (anim.to.fov - anim.from.fov) * t
    next.orthoHeight = anim.from.orthoHeight + (anim.to.orthoHeight - anim.from.orthoHeight) * t
    next.projection = t < 1 ? anim.from.projection : anim.to.projection

    if (raw >= 1) {
      this.animation = null
      this.commit(anim.to)
      return false
    }
    this.state = next
    this.apply()
    this.onChange()
    return true
  }

  cancelAnimation(): void {
    this.animation = null
  }

  /* ---------------------------------------------------------------- */
  /* Projektionshilfen                                                */
  /* ---------------------------------------------------------------- */

  screenToRay(x: number, y: number): { origin: Vec3Like; dir: Vec3Like } {
    const ndcX = (x / this.width) * 2 - 1
    const ndcY = -((y / this.height) * 2 - 1)
    const cam = this.camera
    const near = new THREE.Vector3(ndcX, ndcY, -1).unproject(cam)
    const far = new THREE.Vector3(ndcX, ndcY, 1).unproject(cam)
    const dir = far.sub(near).normalize()
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 1e-12) {
      return { origin: this.state.eye, dir: this.viewDirection }
    }
    if (this.isPerspective) {
      const origin = this.state.eye
      const through = fromVector3(near)
      const d = V.normalizeOr(V.sub(through, origin), fromVector3(dir))
      return { origin, dir: d }
    }
    return { origin: fromVector3(near), dir: fromVector3(dir) }
  }

  worldToScreen(p: Vec3Like): { x: number; y: number; depth: number; visible: boolean } {
    const v = toVector3(p).project(this.camera)
    const x = (v.x * 0.5 + 0.5) * this.width
    const y = (1 - (v.y * 0.5 + 0.5)) * this.height
    const visible =
      Number.isFinite(x) && Number.isFinite(y) && v.z >= -1 && v.z <= 1 && x >= 0 && y >= 0 && x <= this.width && y <= this.height
    return { x, y, depth: v.z, visible }
  }

  /** Wie viele Bildschirmpixel entspricht eine Modelleinheit an `p`? */
  pixelsPerUnit(p: Vec3Like): number {
    if (!this.isPerspective) {
      return this.height / (2 * Math.max(this.state.orthoHeight, 1e-6))
    }
    const dir = this.viewDirection
    const depth = Math.max(Math.abs(V.dot(V.sub(p, this.state.eye), dir)), 1e-4)
    const halfFov = (clamp(this.state.fov, 1, 160) * Math.PI) / 360
    return this.height / (2 * Math.tan(halfFov) * depth)
  }

  /** Sichtbarer Tiefenbereich fuer den Tiefenhinweis der Kanten. */
  depthRange(): { near: number; far: number } {
    const dist = this.distance
    const radius = Math.max(B.isEmpty(this.sceneBounds) ? dist : B.diagonal(this.sceneBounds) * 0.5, 1e-3)
    return { near: Math.max(dist - radius, 0.01), far: dist + radius * 1.5 }
  }

  dispose(): void {
    this.animation = null
  }
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

/** Richtung vom Ziel ZUR Kamera fuer die Standardansichten. */
function standardDirection(view: StandardView): Vec3Like {
  switch (view) {
    case 'top':
      return { x: 0, y: 0, z: 1 }
    case 'bottom':
      return { x: 0, y: 0, z: -1 }
    case 'front':
      return { x: 0, y: -1, z: 0 }
    case 'back':
      return { x: 0, y: 1, z: 0 }
    case 'left':
      return { x: -1, y: 0, z: 0 }
    case 'right':
      return { x: 1, y: 0, z: 0 }
    case 'iso':
    default:
      return V.normalize({ x: 1, y: -1, z: 0.8 })
  }
}

function slerp(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  const dot = clamp(V.dot(a, b), -1, 1)
  const angle = Math.acos(dot)
  if (angle < 1e-5) return V.lerpV(a, b, t)
  const sin = Math.sin(angle)
  const wa = Math.sin((1 - t) * angle) / sin
  const wb = Math.sin(t * angle) / sin
  return V.normalizeOr(V.add(V.mul(a, wa), V.mul(b, wb)), b)
}
