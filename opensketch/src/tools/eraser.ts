/**
 * Radiergummi.
 *
 *  - ueber Kanten ziehen loescht sie
 *  - Strg zeichnet sie weich (soft + smooth) statt zu loeschen
 *  - Umschalt versteckt sie
 *  - Strg+Umschalt hebt die Weichzeichnung wieder auf
 *
 * Gesammelt wird waehrend des Ziehens, ausgefuehrt wird beim Loslassen -
 * so entsteht genau ein Undo-Schritt fuer den ganzen Strich.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, Id, OverlayApi, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { edgeWorldPoints } from './helpers'

type EraserMode = 'delete' | 'soften' | 'hide' | 'unsoften'

function modeFor(e: PointerInfo): EraserMode {
  const ctrl = e.ctrl || e.meta
  if (ctrl && e.shift) return 'unsoften'
  if (ctrl) return 'soften'
  if (e.shift) return 'hide'
  return 'delete'
}

const MODE_LABEL: Record<EraserMode, string> = {
  delete: 'Löschen',
  soften: 'Weichzeichnen',
  hide: 'Verstecken',
  unsoften: 'Weichzeichnung aufheben',
}

export class EraserTool extends BaseTool {
  readonly id: ToolId = 'eraser'
  readonly name: string = 'Radiergummi'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Radiergummi: über Kanten ziehen'

  private erasing = false
  private mode: EraserMode = 'delete'
  private edgeIds = new Set<Id>()
  private entityIds = new Set<Id>()
  private marks: [Vec3Like, Vec3Like][] = []
  private trail: Vec3Like[] = []

  protected onActivate(): void {
    this.reset()
    this.showMode('delete')
  }

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.erasing = true
    this.mode = modeFor(e)
    this.edgeIds.clear()
    this.entityIds.clear()
    this.marks = []
    this.trail = []
    this.collect(e)
    this.showMode(this.mode)
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.erasing) {
      this.showMode(modeFor(e))
      return
    }
    // Der Modus wird waehrend des Strichs mitgezogen.
    this.mode = modeFor(e)
    this.collect(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (!this.erasing) return
    this.erasing = false
    this.collect(e)
    this.apply()
  }

  cancel(): void {
    this.reset()
    this.showMode('delete')
  }

  draw(overlay: OverlayApi): void {
    try {
      for (const [a, b] of this.marks) {
        overlay.line(a, b, { color: COLORS.erase, width: 3, onTop: true })
      }
      if (this.trail.length > 1) {
        overlay.polyline(this.trail, false, { color: COLORS.erase, width: 1, dashed: true, onTop: true })
      }
    } catch (err) {
      console.warn('[tools] Radiergummi: Vorschau fehlgeschlagen', err)
    }
  }

  /* ---------------- Intern ---------------- */

  private collect(e: PointerInfo): void {
    const hit = this.pick(e, 8)
    if (!hit || hit.kind === 'none' || hit.kind === 'ground' || !hit.id) return
    if (hit.point) this.trail.push({ ...hit.point })

    if (hit.kind === 'edge' && hit.inContext) {
      if (this.edgeIds.has(hit.id)) return
      this.edgeIds.add(hit.id)
      const pts = this.read((state) => edgeWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform))
      if (pts) this.marks.push(pts)
      return
    }
    // Gruppen, Komponenten und Annotationen werden als Ganzes geloescht.
    const entityId = hit.kind === 'instance' || hit.kind === 'entity' || hit.kind === 'guide'
      ? (hit.topInstanceId ?? hit.id)
      : hit.inContext
        ? null
        : hit.topInstanceId
    if (entityId && this.mode === 'delete') this.entityIds.add(entityId)
  }

  private apply(): void {
    const edgeIds = [...this.edgeIds]
    const entityIds = [...this.entityIds]
    if (edgeIds.length === 0 && entityIds.length === 0) {
      this.reset()
      return
    }
    const mode = this.mode
    this.modify(MODE_LABEL[mode], (state) => {
      switch (mode) {
        case 'soften':
          if (edgeIds.length) state.setEdgeFlags(edgeIds, { soft: true, smooth: true })
          break
        case 'unsoften':
          if (edgeIds.length) state.setEdgeFlags(edgeIds, { soft: false, smooth: false })
          break
        case 'hide':
          if (edgeIds.length) state.setEdgeFlags(edgeIds, { hidden: true })
          break
        default:
          state.deletePrimitives({ edgeIds, entityIds })
      }
    })
    this.reset()
  }

  private showMode(mode: EraserMode): void {
    this.status(
      `Radiergummi: ${MODE_LABEL[mode]}`,
      'Strg = weichzeichnen, Umschalt = verstecken, Strg+Umschalt = Weichzeichnung aufheben',
    )
  }

  private reset(): void {
    this.erasing = false
    this.mode = 'delete'
    this.edgeIds.clear()
    this.entityIds.clear()
    this.marks = []
    this.trail = []
    this.clearVcb()
  }
}
