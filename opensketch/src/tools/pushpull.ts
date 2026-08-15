/**
 * Druecken/Ziehen - das Werkzeug, das aus einer Flaeche einen Koerper macht.
 *
 *  - Flaeche anklicken und ziehen (oder klicken, bewegen, klicken)
 *  - die Distanz laeuft immer entlang der Flaechennormalen; negative Werte
 *    druecken in das Material hinein
 *  - Doppelklick auf eine Flaeche wiederholt die zuletzt benutzte Distanz
 *  - Strg laesst die Startflaeche stehen (`createNewStartingFace`) und
 *    erzeugt damit einen Aufsatz statt einer Verlaengerung
 *  - Massfeld: „Distanz"
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type { Cursor, Id, OverlayApi, PickHit, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { M, P, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { closestPointOnLineToPointer, faceWorldPoints, parseSignedLength } from './helpers'

const DRAG_PX = 6

export class PushPullTool extends BaseTool {
  readonly id: ToolId = 'pushpull'
  readonly name: string = 'Drücken/Ziehen'
  readonly cursor: Cursor = 'ns-resize'
  readonly hint: string = 'Drücken/Ziehen: Fläche wählen'

  private faceId: Id | null = null
  private origin: Vec3Like | null = null
  private axis: Vec3Like = V.AXIS_Z
  private outline: Vec3Like[] = []
  private distance = 0
  private lastDistance = 0
  private newStartingFace = false
  private downX = 0
  private downY = 0
  private started = false
  private hoverFaceId: Id | null = null
  private hoverOutline: Vec3Like[] = []

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.origin
  }

  /* ---------------- Zeiger ---------------- */

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.downX = e.x
    this.downY = e.y
    if (this.faceId) return
    const hit = this.pick(e, 6)
    if (!this.begin(hit)) return
    this.newStartingFace = e.ctrl
    this.started = true
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.faceId || !this.origin) {
      this.updateHover(e)
      return
    }
    this.newStartingFace = e.ctrl
    this.updateDistance(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0 || !this.faceId || !this.origin) return
    const dragged = Math.hypot(e.x - this.downX, e.y - this.downY) > DRAG_PX
    if (this.started && !dragged) {
      // Erster Klick ohne Zug: der Nutzer bewegt jetzt und klickt erneut.
      this.started = false
      return
    }
    this.newStartingFace = e.ctrl
    this.updateDistance(e)
    this.commit()
  }

  /** Doppelklick wiederholt die zuletzt benutzte Distanz. */
  onDoubleClick(e: PointerInfo): void {
    if (Math.abs(this.lastDistance) < POINT_TOL) return
    const hit = this.pick(e, 6)
    if (!this.begin(hit)) return
    this.newStartingFace = e.ctrl
    this.distance = this.lastDistance
    this.commit()
  }

  /* ---------------- Massfeld ---------------- */

  onValueEntry(text: string): boolean {
    const value = parseSignedLength(text, this.units())
    if (value === null || Math.abs(value) < POINT_TOL) return false
    if (this.faceId) {
      this.distance = value
      this.commit()
      return true
    }
    // Ohne laufende Operation gilt der Wert fuer den naechsten Doppelklick.
    this.lastDistance = value
    this.updateVcb()
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      if (this.faceId && this.outline.length >= 3) {
        const moved = this.outline.map((p) => V.addScaled(p, this.axis, this.distance))
        overlay.polyline(this.outline, true, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        overlay.polyline(moved, true, { color: COLORS.preview, width: 2, onTop: true })
        overlay.polygonFill(moved, { color: COLORS.previewFill, opacity: 0.18 })
        for (let i = 0; i < this.outline.length; i++) {
          overlay.line(this.outline[i], moved[i], { color: COLORS.preview, width: 1, onTop: true })
        }
        if (this.origin) {
          const tip = V.addScaled(this.origin, this.axis, this.distance)
          overlay.line(this.origin, tip, { color: COLORS.highlight, width: 1, dashed: true, onTop: true })
          overlay.text(tip, formatLength(this.distance, this.units()), {
            color: COLORS.neutral,
            size: 12,
            offsetX: 12,
            offsetY: -12,
            onTop: true,
            background: 'rgba(20,20,22,0.72)',
          })
        }
      } else if (this.hoverOutline.length >= 3) {
        overlay.polygonFill(this.hoverOutline, { color: COLORS.previewFill, opacity: 0.22 })
        overlay.polyline(this.hoverOutline, true, { color: COLORS.selection, width: 1.5, onTop: true })
      }
    } catch (err) {
      console.warn('[tools] Drücken/Ziehen: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  /** Uebernimmt die Flaeche unter dem Cursor als Startflaeche. */
  private begin(hit: PickHit | null): boolean {
    if (!hit || hit.kind !== 'face' || !hit.id) {
      this.notify('Drücken/Ziehen braucht eine Fläche', 'warn')
      return false
    }
    if (!hit.inContext) {
      this.notify('Die Fläche liegt in einer Gruppe - erst mit Doppelklick betreten', 'warn')
      return false
    }
    const outline = this.read((state) => faceWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform))
    if (!outline || outline.length < 3) return false
    const normal = this.faceNormal(hit, outline)
    if (!normal) return false

    this.faceId = hit.id
    this.outline = outline
    this.axis = normal
    this.origin = V.isFinite3(hit.point) ? V.clone(hit.point) : V.centroid(outline)
    this.distance = 0
    this.status('Drücken/Ziehen: Distanz ziehen oder eintippen', 'Strg = neue Startfläche, Doppelklick = wiederholen')
    this.updateVcb()
    return true
  }

  private faceNormal(hit: PickHit, outline: Vec3Like[]): Vec3Like | null {
    if (hit.normal && V.isFinite3(hit.normal) && !V.isZero(hit.normal)) return V.normalize(hit.normal)
    const plane = P.fromPolygon(outline)
    if (plane) return V.normalize(plane.n)
    const face = this.read((state: AppState) => state.getFace(hit.id as Id, hit.definitionId ?? undefined))
    if (face) return V.normalize(M.transformNormal(hit.worldTransform, face.normal))
    return null
  }

  private updateDistance(e: PointerInfo): void {
    if (!this.origin || !this.ctx) return
    // Der Zug laeuft auf der Geraden durch den Startpunkt entlang der Normalen.
    const point = closestPointOnLineToPointer(this.ctx.viewport, this.origin, this.axis, e.x, e.y, this.origin)
    this.distance = V.dot(V.sub(point, this.origin), this.axis)
    this.updateVcb()
  }

  private updateHover(e: PointerInfo): void {
    const hit = this.pick(e, 6)
    if (!hit || hit.kind !== 'face' || !hit.id || !hit.inContext) {
      this.hoverFaceId = null
      this.hoverOutline = []
      return
    }
    if (hit.id === this.hoverFaceId) return
    this.hoverFaceId = hit.id
    this.hoverOutline =
      this.read((state) => faceWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform)) ?? []
  }

  private commit(): void {
    const faceId = this.faceId
    const distance = this.distance
    if (!faceId || Math.abs(distance) < POINT_TOL) {
      this.reset()
      if (faceId) this.abortDegenerate('Nichts gedrückt oder gezogen - die Distanz ist 0')
      else this.status(this.hint)
      return
    }
    const createNewStartingFace = this.newStartingFace
    this.modify('Drücken/Ziehen', (state) => state.pushPull(faceId, distance, { createNewStartingFace }))
    this.lastDistance = distance
    this.reset()
    this.status(this.hint, 'Doppelklick wiederholt die Distanz')
    this.updateVcb()
  }

  private updateVcb(): void {
    const value = this.faceId ? this.distance : this.lastDistance
    this.vcb('Distanz', Math.abs(value) > POINT_TOL ? formatLength(value, this.units(), { suffix: false }) : '', 'Distanz')
  }

  private reset(): void {
    this.faceId = null
    this.origin = null
    this.outline = []
    this.distance = 0
    this.started = false
    this.newStartingFace = false
    this.hoverFaceId = null
    this.hoverOutline = []
  }
}
