/**
 * Auswahlwerkzeug - das meistbenutzte Werkzeug ueberhaupt.
 *
 *  - Klick ersetzt die Auswahl
 *  - Umschalt schaltet um, Strg fuegt hinzu, Strg+Umschalt entfernt
 *  - Doppelklick auf eine Flaeche waehlt Flaeche + Randkanten
 *  - Dreifachklick waehlt alles Zusammenhaengende
 *  - Doppelklick auf eine Instanz betritt deren Kontext
 *  - Ziehen zieht einen Auswahlrahmen auf; von rechts nach links wird er
 *    gestrichelt gezeichnet und arbeitet als Kreuzungsauswahl (beruehren
 *    genuegt), von links nach rechts muss alles vollstaendig innen liegen.
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type { Cursor, Id, OverlayApi, PickHit, PointerInfo, Selection, ToolId } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { selectionFromHit, selectionIsEmptySafe } from './helpers'

const DRAG_PX = 4

export type SelectMode = 'replace' | 'toggle' | 'add' | 'remove'

/** Modifikatoren -> Auswahlmodus (identisch zu SketchUp). */
export function selectModeFor(e: { shift: boolean; ctrl: boolean; meta?: boolean }): SelectMode {
  const ctrl = e.ctrl || e.meta === true
  if (ctrl && e.shift) return 'remove'
  if (ctrl) return 'add'
  if (e.shift) return 'toggle'
  return 'replace'
}

export class SelectTool extends BaseTool {
  readonly id: ToolId = 'select'
  readonly name: string = 'Auswahl'
  readonly cursor: Cursor = 'default'
  readonly hint: string = 'Auswahl: klicken oder Rahmen ziehen'

  protected pressed = false
  protected dragging = false
  protected downX = 0
  protected downY = 0
  protected curX = 0
  protected curY = 0

  protected onActivate(): void {
    this.pressed = false
    this.dragging = false
    this.clearVcb()
  }

  protected onDeactivate(): void {
    this.setHover(null)
  }

  /* ---------------- Zeiger ---------------- */

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.pressed = true
    this.dragging = false
    this.downX = e.x
    this.downY = e.y
    this.curX = e.x
    this.curY = e.y
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (this.pressed && (e.buttons & 1) !== 0) {
      this.curX = e.x
      this.curY = e.y
      if (!this.dragging && Math.hypot(e.x - this.downX, e.y - this.downY) > DRAG_PX) {
        this.dragging = true
      }
      if (this.dragging) this.showDragStatus()
      return
    }
    if (this.pressed && (e.buttons & 1) === 0) {
      // Der Zeiger wurde ausserhalb losgelassen.
      this.pressed = false
      this.dragging = false
    }
    this.setHover(this.pick(e, 8))
    this.showStatus()
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) {
      this.pressed = false
      return
    }
    const wasDragging = this.dragging
    this.pressed = false
    this.dragging = false
    this.curX = e.x
    this.curY = e.y
    if (wasDragging) this.applyRect(e)
    else this.applyClick(e)
    this.showStatus()
  }

  /**
   * Doppel- und Dreifachklicks werden ueber `clickCount` in `onPointerUp`
   * ausgewertet - nur so ist der Dreifachklick ueberhaupt erreichbar.
   */
  onDoubleClick(_e: PointerInfo): void {}

  /**
   * Bricht nur den laufenden Rahmen ab. Das Leeren der Auswahl bzw. das
   * Verlassen des Kontexts macht der Werkzeugmanager beim zweiten Esc.
   */
  cancel(): void {
    this.pressed = false
    this.dragging = false
  }

  draw(overlay: OverlayApi): void {
    if (!this.dragging) return
    try {
      const crossing = this.curX < this.downX
      overlay.screenRect(this.downX, this.downY, this.curX, this.curY, {
        color: crossing ? COLORS.highlight : COLORS.selection,
        width: 1,
        dashed: crossing,
        fill: crossing ? 'rgba(242,193,78,0.10)' : 'rgba(59,130,246,0.10)',
        onTop: true,
      })
    } catch (err) {
      console.warn('[tools] Auswahl: Rahmen konnte nicht gezeichnet werden', err)
    }
  }

  /* ---------------- Intern ---------------- */

  protected applyClick(e: PointerInfo): void {
    const hit = this.pick(e, 10)
    const mode = selectModeFor(e)
    const clicks = e.clickCount ?? 1

    if (!hit || hit.kind === 'none' || hit.kind === 'ground') {
      if (mode === 'replace') this.applySelection(emptySelection(), 'replace')
      return
    }

    // Doppelklick auf eine Instanz betritt den Kontext.
    if (clicks >= 2 && this.enterInstance(hit)) return

    const base = selectionFromHit(hit)
    if (selectionIsEmptySafe(base)) return
    this.applySelection(base, mode)

    if (clicks === 2 && hit.kind === 'face' && hit.inContext) {
      this.grow('boundingEdges')
    } else if (clicks >= 3) {
      this.grow('connected')
    }
  }

  protected applyRect(e: PointerInfo): void {
    const crossing = e.x < this.downX
    const sel = this.read((state) => {
      void state
      return this.ctx ? this.ctx.viewport.pickRect(this.downX, this.downY, e.x, e.y, crossing) : null
    })
    if (!sel) return
    this.applySelection(sel, selectModeFor(e))
  }

  protected applySelection(sel: Selection, mode: SelectMode): void {
    this.read((state) => {
      switch (mode) {
        case 'add':
          state.addToSelection(sel)
          break
        case 'remove':
          state.removeFromSelection(sel)
          break
        case 'toggle':
          state.toggleSelection(sel)
          break
        default:
          state.setSelection(sel)
      }
      return true
    })
    this.requestRender()
  }

  private grow(mode: Parameters<AppState['growSelection']>[0]): void {
    this.read((state) => {
      state.growSelection(mode)
      return true
    })
  }

  /** Doppelklick auf eine Gruppe/Komponente: Kontext betreten. */
  private enterInstance(hit: PickHit): boolean {
    const target: Id | null = hit.kind === 'instance' ? (hit.id ?? hit.topInstanceId) : hit.inContext ? null : hit.topInstanceId
    if (!target) return false
    const entered = this.read((state) => {
      const entity = state.getEntity(target)
      if (!entity || entity.type !== 'instance') return false
      state.enterContext(target)
      return true
    })
    if (entered) {
      this.status('Kontext betreten - Esc verlässt ihn wieder')
      this.requestRender()
    }
    return entered === true
  }

  protected setHover(hit: PickHit | null): void {
    this.read((state) => {
      if (!hit || hit.kind === 'none' || hit.kind === 'ground' || !hit.id) {
        state.setHover(null)
      } else {
        state.setHover({ kind: hit.kind, id: hit.id, definitionId: hit.definitionId })
      }
      return true
    })
  }

  protected showStatus(): void {
    this.status(this.hint, 'Umschalt = umschalten, Strg = hinzufügen, Strg+Umschalt = entfernen')
  }

  private showDragStatus(): void {
    this.status(
      this.curX < this.downX ? 'Kreuzungsauswahl: alles Berührte' : 'Rahmenauswahl: nur vollständig Umschlossenes',
      'Umschalt = umschalten, Strg = hinzufügen',
    )
  }
}
