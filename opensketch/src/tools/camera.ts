/**
 * Kamerawerkzeuge: Orbit, Schwenken, Zoom, Zoomfenster, Kamera positionieren,
 * Gehen und Umsehen.
 *
 * Sie sind bewusst duenn - die eigentliche Kamerabewegung macht der Viewport.
 * Orbit, Schwenken und Zoom sind zusaetzlich als *transiente* Werkzeuge
 * benutzbar (mittlere Maustaste, Mausrad, Leertaste); dafuer sorgt der
 * Werkzeugmanager.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { V } from '@/core/math'
import { formatLength, parseLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { safeOrNull } from './helpers'

/** Standard-Augenhoehe beim Positionieren und Gehen (Meter). */
export const DEFAULT_EYE_HEIGHT = 1.7

/* ------------------------------------------------------------------ */
/* Gemeinsame Basis: Ziehen mit gedrueckter Taste                      */
/* ------------------------------------------------------------------ */

abstract class DragCameraTool extends BaseTool {
  protected dragging = false
  protected lastX = 0
  protected lastY = 0

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    this.dragging = true
    this.lastX = e.x
    this.lastY = e.y
    this.setCursor(this.dragCursor())
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.dragging) return
    const dx = e.x - this.lastX
    const dy = e.y - this.lastY
    this.lastX = e.x
    this.lastY = e.y
    if (dx === 0 && dy === 0) return
    try {
      this.applyDrag(dx, dy, e)
    } catch (err) {
      console.warn(`[tools] ${this.id}: Kamerabewegung fehlgeschlagen`, err)
    }
    this.requestRender()
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    this.dragging = false
    this.setCursor(this.cursor)
  }

  cancel(): void {
    this.dragging = false
  }

  draw(_overlay: OverlayApi): void {}

  protected dragCursor(): Cursor {
    return this.cursor
  }

  protected abstract applyDrag(dx: number, dy: number, e: PointerInfo): void
}

/* ------------------------------------------------------------------ */
/* Orbit                                                               */
/* ------------------------------------------------------------------ */

export class OrbitTool extends DragCameraTool {
  readonly id: ToolId = 'orbit'
  readonly name: string = 'Orbit'
  readonly cursor: Cursor = 'grab'
  readonly hint: string = 'Orbit: ziehen zum Drehen'

  protected dragCursor(): Cursor {
    return 'grabbing'
  }

  protected applyDrag(dx: number, dy: number): void {
    this.ctx?.viewport.orbit(dx, dy)
  }
}

/* ------------------------------------------------------------------ */
/* Schwenken                                                           */
/* ------------------------------------------------------------------ */

export class PanTool extends DragCameraTool {
  readonly id: ToolId = 'pan'
  readonly name: string = 'Schwenken'
  readonly cursor: Cursor = 'grab'
  readonly hint: string = 'Schwenken: ziehen zum Verschieben der Ansicht'

  protected dragCursor(): Cursor {
    return 'grabbing'
  }

  protected applyDrag(dx: number, dy: number): void {
    this.ctx?.viewport.pan(dx, dy)
  }
}

/* ------------------------------------------------------------------ */
/* Zoom                                                                */
/* ------------------------------------------------------------------ */

export class ZoomTool extends DragCameraTool {
  readonly id: ToolId = 'zoom'
  readonly name: string = 'Zoom'
  readonly cursor: Cursor = 'zoom-in'
  readonly hint: string = 'Zoom: senkrecht ziehen'

  protected onActivate(): void {
    this.updateVcb()
    this.status(this.hint, 'Umschalt = Bildwinkel, Mausrad = Zoom')
  }

  protected applyDrag(_dx: number, dy: number, e: PointerInfo): void {
    const vp = this.ctx?.viewport
    if (!vp) return
    if (e.shift) {
      const cam = safeOrNull(() => vp.getCamera())
      const fov = cam ? cam.fov : 35
      vp.setFov(Math.max(1, Math.min(160, fov + dy * 0.2)))
      this.updateVcb()
      return
    }
    vp.dolly(-dy * 0.01, { x: e.x, y: e.y })
  }

  onWheel(e: PointerInfo): void {
    const delta = e.delta ?? 0
    if (delta === 0) return
    try {
      this.ctx?.viewport.dolly(delta > 0 ? -0.15 : 0.15, { x: e.x, y: e.y })
    } catch (err) {
      console.warn('[tools] Zoom: Mausrad fehlgeschlagen', err)
    }
    this.requestRender()
  }

  onValueEntry(text: string): boolean {
    const value = Number(text.replace(',', '.').replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(value) || value < 1 || value > 160) return false
    try {
      this.ctx?.viewport.setFov(value)
    } catch {
      return false
    }
    this.updateVcb()
    this.requestRender()
    return true
  }

  private updateVcb(): void {
    const cam = this.ctx ? safeOrNull(() => this.ctx!.viewport.getCamera()) : null
    this.vcb('Bildwinkel', cam ? `${Math.round(cam.fov)}°` : '', 'Grad')
  }
}

/* ------------------------------------------------------------------ */
/* Zoomfenster                                                         */
/* ------------------------------------------------------------------ */

export class ZoomWindowTool extends BaseTool {
  readonly id: ToolId = 'zoomWindow'
  readonly name: string = 'Zoomfenster'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Zoomfenster: Bereich aufziehen'

  private active = false
  private x0 = 0
  private y0 = 0
  private x1 = 0
  private y1 = 0

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.active = true
    this.x0 = e.x
    this.y0 = e.y
    this.x1 = e.x
    this.y1 = e.y
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.active) return
    this.x1 = e.x
    this.y1 = e.y
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (!this.active || e.button !== 0) return
    this.active = false
    this.x1 = e.x
    this.y1 = e.y
    if (Math.abs(this.x1 - this.x0) < 4 || Math.abs(this.y1 - this.y0) < 4) return
    try {
      this.ctx?.viewport.zoomWindow(this.x0, this.y0, this.x1, this.y1)
    } catch (err) {
      console.warn('[tools] Zoomfenster fehlgeschlagen', err)
    }
    this.requestRender()
  }

  cancel(): void {
    this.active = false
  }

  draw(overlay: OverlayApi): void {
    if (!this.active) return
    try {
      overlay.screenRect(this.x0, this.y0, this.x1, this.y1, {
        color: COLORS.selection,
        width: 1,
        dashed: true,
        fill: 'rgba(59,130,246,0.08)',
        onTop: true,
      })
    } catch {
      /* Overlay nicht bereit */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Kamera positionieren                                                */
/* ------------------------------------------------------------------ */

export class PositionCameraTool extends BaseTool {
  readonly id: ToolId = 'position'
  readonly name: string = 'Kamera positionieren'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Kamera positionieren: Standort wählen (ziehen legt die Blickrichtung fest)'

  private eyeHeight = DEFAULT_EYE_HEIGHT
  private origin: Vec3Like | null = null
  private target: Vec3Like | null = null

  protected onActivate(): void {
    this.origin = null
    this.target = null
    this.updateVcb()
  }

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    const inf = this.infer(e, { from: null })
    this.origin = V.clone(inf.point)
    this.target = null
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.origin || (e.buttons & 1) === 0) {
      this.infer(e, { from: null })
      return
    }
    const inf = this.infer(e, { from: this.origin })
    this.target = V.clone(inf.point)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0 || !this.origin) return
    const eye = { x: this.origin.x, y: this.origin.y, z: this.origin.z + this.eyeHeight }
    const look = this.target ?? this.defaultTarget(eye)
    const target = { x: look.x, y: look.y, z: eye.z }
    try {
      this.ctx?.viewport.positionCamera(eye, target, this.eyeHeight)
    } catch (err) {
      console.warn('[tools] Kamera positionieren fehlgeschlagen', err)
    }
    this.origin = null
    this.target = null
    this.requestRender()
    // Nach dem Positionieren arbeitet man in SketchUp mit "Umsehen" weiter.
    this.read((state) => {
      state.setActiveTool('lookaround')
      return true
    })
  }

  onValueEntry(text: string): boolean {
    const value = parseLength(text.trim(), this.units())
    if (value === null || !Number.isFinite(value) || value <= 0) return false
    this.eyeHeight = value
    this.updateVcb()
    return true
  }

  cancel(): void {
    this.origin = null
    this.target = null
  }

  draw(overlay: OverlayApi): void {
    try {
      if (this.origin) {
        const eye = { x: this.origin.x, y: this.origin.y, z: this.origin.z + this.eyeHeight }
        overlay.line(this.origin, eye, { color: COLORS.highlight, width: 2, onTop: true })
        overlay.point(eye, 'circle', { color: COLORS.highlight, size: 7, onTop: true })
        overlay.text(eye, formatLength(this.eyeHeight, this.units()), {
          color: COLORS.neutral,
          size: 12,
          offsetX: 12,
          onTop: true,
          background: 'rgba(20,20,22,0.72)',
        })
        if (this.target) overlay.line(eye, this.target, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
      }
    } catch {
      /* Overlay nicht bereit */
    }
    this.drawInference(overlay)
  }

  private defaultTarget(eye: Vec3Like): Vec3Like {
    const cam = this.ctx ? safeOrNull(() => this.ctx!.viewport.getCamera()) : null
    if (!cam) return V.add(eye, V.AXIS_Y)
    const dir = V.sub(cam.target, cam.eye)
    const flat = { x: dir.x, y: dir.y, z: 0 }
    return V.add(eye, V.isZero(flat) ? V.AXIS_Y : V.normalize(flat))
  }

  private updateVcb(): void {
    this.vcb('Augenhöhe', formatLength(this.eyeHeight, this.units(), { suffix: false }), 'Augenhöhe')
  }
}

/* ------------------------------------------------------------------ */
/* Gehen                                                               */
/* ------------------------------------------------------------------ */

export class WalkTool extends DragCameraTool {
  readonly id: ToolId = 'walk'
  readonly name: string = 'Gehen'
  readonly cursor: Cursor = 'pointer'
  readonly hint: string = 'Gehen: ziehen zum Laufen'

  private eyeHeight = DEFAULT_EYE_HEIGHT

  protected onActivate(): void {
    const cam = this.ctx ? safeOrNull(() => this.ctx!.viewport.getCamera()) : null
    if (cam) this.eyeHeight = Math.max(0.1, cam.eye.z)
    this.vcb('Augenhöhe', formatLength(this.eyeHeight, this.units(), { suffix: false }), 'Augenhöhe')
    this.status(this.hint, 'Umschalt = seitwärts und aufwärts, Strg = schneller')
  }

  onValueEntry(text: string): boolean {
    const value = parseLength(text.trim(), this.units())
    if (value === null || value <= 0) return false
    this.eyeHeight = value
    const vp = this.ctx?.viewport
    const cam = vp ? safeOrNull(() => vp.getCamera()) : null
    if (vp && cam) {
      const dz = value - cam.eye.z
      vp.setCamera({
        eye: { x: cam.eye.x, y: cam.eye.y, z: cam.eye.z + dz },
        target: { x: cam.target.x, y: cam.target.y, z: cam.target.z + dz },
      })
      this.requestRender()
    }
    return true
  }

  protected applyDrag(dx: number, dy: number, e: PointerInfo): void {
    const vp = this.ctx?.viewport
    if (!vp) return
    const cam = safeOrNull(() => vp.getCamera())
    if (!cam) return
    const speed = (e.ctrl ? 0.08 : 0.02) * Math.max(1, V.distance(cam.eye, cam.target) * 0.2)
    const forwardRaw = V.sub(cam.target, cam.eye)
    const flat = { x: forwardRaw.x, y: forwardRaw.y, z: 0 }
    const forward = V.isZero(flat) ? V.AXIS_Y : V.normalize(flat)
    const right = V.normalize(V.cross(forward, V.AXIS_Z))

    let delta: Vec3Like
    if (e.shift) {
      // Umschalt: seitwaerts und in der Hoehe verschieben
      delta = V.add(V.mul(right, dx * speed), V.mul(V.AXIS_Z, -dy * speed))
    } else {
      delta = V.add(V.mul(forward, -dy * speed), V.mul(right, dx * speed * 0.5))
    }
    vp.setCamera({ eye: V.add(cam.eye, delta), target: V.add(cam.target, delta) })
  }
}

/* ------------------------------------------------------------------ */
/* Umsehen                                                             */
/* ------------------------------------------------------------------ */

export class LookAroundTool extends DragCameraTool {
  readonly id: ToolId = 'lookaround'
  readonly name: string = 'Umsehen'
  readonly cursor: Cursor = 'grab'
  readonly hint: string = 'Umsehen: ziehen zum Drehen des Blicks'

  protected dragCursor(): Cursor {
    return 'grabbing'
  }

  protected applyDrag(dx: number, dy: number): void {
    const vp = this.ctx?.viewport
    if (!vp) return
    const cam = safeOrNull(() => vp.getCamera())
    if (!cam) return
    const dir = V.sub(cam.target, cam.eye)
    const dist = V.length(dir)
    if (dist < 1e-6) return
    let view = V.div(dir, dist)

    // Waagerecht um die Weltachse Z, senkrecht um die Querachse des Blicks.
    view = V.rotateAround(view, V.AXIS_Z, -dx * 0.004)
    let right = V.cross(view, V.AXIS_Z)
    if (V.isZero(right)) right = V.anyPerpendicular(view)
    right = V.normalize(right)
    const pitched = V.rotateAround(view, right, dy * 0.004)
    // Ueberschlag am Zenit verhindern
    if (Math.abs(V.dot(V.normalize(pitched), V.AXIS_Z)) < 0.995) view = pitched

    vp.setCamera({ target: V.addScaled(cam.eye, view, dist) })
  }
}
