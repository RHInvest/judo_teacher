/**
 * Lasso-Auswahl: freihaendig einen Bereich umfahren.
 *
 * Wie beim Rechteckrahmen entscheidet die Zugrichtung: endet der Zug links
 * vom Startpunkt, ist es eine Kreuzungsauswahl (beruehren genuegt, gestrichelt
 * gezeichnet), sonst muss alles vollstaendig umschlossen sein.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PointerInfo, ToolId, Vec2Like } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { COLORS } from './colors'
import { selectModeFor, SelectTool } from './select'

const SAMPLE_PX = 4
const MIN_POINTS = 4

export class LassoTool extends SelectTool {
  readonly id: ToolId = 'lasso'
  readonly name: string = 'Lasso'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Lasso: Bereich umfahren'

  private path: Vec2Like[] = []

  protected onActivate(): void {
    this.path = []
    this.clearVcb()
  }

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.pressed = true
    this.dragging = false
    this.downX = e.x
    this.downY = e.y
    this.curX = e.x
    this.curY = e.y
    this.path = [{ x: e.x, y: e.y }]
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.pressed || (e.buttons & 1) === 0) {
      if (this.pressed) this.pressed = false
      this.setHover(this.pick(e, 8))
      return
    }
    this.curX = e.x
    this.curY = e.y
    const last = this.path[this.path.length - 1]
    if (!last || Math.hypot(e.x - last.x, e.y - last.y) >= SAMPLE_PX) {
      this.path.push({ x: e.x, y: e.y })
      this.dragging = this.path.length >= MIN_POINTS
    }
    this.status(
      this.crossing() ? 'Lasso: Kreuzungsauswahl' : 'Lasso: alles vollständig Umschlossene',
      'Umschalt = umschalten, Strg = hinzufügen',
    )
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) {
      this.pressed = false
      return
    }
    const path = this.path
    const dragged = this.dragging
    this.pressed = false
    this.dragging = false
    this.path = []

    if (!dragged || path.length < MIN_POINTS) {
      this.applyClick(e)
      return
    }
    const crossing = e.x < this.downX
    const sel = this.ctx ? this.safeLasso(path, crossing) : null
    this.applySelection(sel ?? emptySelection(), selectModeFor(e))
    this.showStatus()
  }

  cancel(): void {
    if (this.pressed || this.path.length > 0) {
      this.pressed = false
      this.dragging = false
      this.path = []
      return
    }
    super.cancel()
  }

  draw(overlay: OverlayApi): void {
    if (this.path.length < 2) return
    try {
      const crossing = this.crossing()
      overlay.screenPolyline(this.path, true, {
        color: crossing ? COLORS.highlight : COLORS.selection,
        width: 1.5,
        dashed: crossing,
        onTop: true,
      })
    } catch (err) {
      console.warn('[tools] Lasso: Vorschau fehlgeschlagen', err)
    }
  }

  protected showStatus(): void {
    this.status(this.hint, 'Umschalt = umschalten, Strg = hinzufügen, Strg+Umschalt = entfernen')
  }

  private crossing(): boolean {
    return this.curX < this.downX
  }

  private safeLasso(path: Vec2Like[], crossing: boolean) {
    try {
      return this.ctx ? this.ctx.viewport.pickLasso(path, crossing) : null
    } catch (err) {
      console.warn('[tools] Lasso: Auswahl fehlgeschlagen', err)
      return null
    }
  }
}
