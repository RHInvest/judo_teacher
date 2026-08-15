/**
 * Materialwerkzeug ("Eimer").
 *
 *  - Klick faerbt Flaeche, Kante oder Instanz mit dem aktiven Material
 *  - Alt ist die Pipette: das getroffene Material wird zum aktiven Material
 *  - Strg faerbt alle Flaechen mit demselben Material im aktuellen Kontext
 *  - Umschalt faerbt alle Flaechen mit demselben Material im ganzen Modell
 *
 * Vorder- und Rueckseite werden unterschieden: gefaerbt wird die Seite, die
 * der Nutzer tatsaechlich sieht.
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type { Cursor, Id, OverlayApi, PickHit, PointerInfo, Selection, ToolId } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { V } from '@/core/math'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { faceWorldPoints, viewDirection } from './helpers'

type PaintScope = 'single' | 'context' | 'model'

function scopeFor(e: PointerInfo): PaintScope {
  if (e.shift) return 'model'
  if (e.ctrl || e.meta) return 'context'
  return 'single'
}

export class PaintTool extends BaseTool {
  readonly id: ToolId = 'paint'
  readonly name: string = 'Material'
  readonly cursor: Cursor = 'pointer'
  readonly hint: string = 'Material: Fläche anklicken'

  private hoverOutline: import('@/shared/types').Vec3Like[] = []

  protected onActivate(): void {
    this.hoverOutline = []
    this.clearVcb()
    this.showMode(false)
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    this.showMode(e.alt)
    const hit = this.pick(e, 6)
    if (!hit || hit.kind !== 'face' || !hit.id) {
      this.hoverOutline = []
      return
    }
    this.hoverOutline =
      this.read((state) => faceWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform)) ?? []
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    const hit = this.pick(e, 6)
    if (!hit || hit.kind === 'none' || hit.kind === 'ground' || !hit.id) return

    if (e.alt) {
      this.sample(hit)
      return
    }
    this.paint(hit, scopeFor(e))
  }

  draw(overlay: OverlayApi): void {
    if (this.hoverOutline.length < 3) return
    try {
      overlay.polyline(this.hoverOutline, true, { color: COLORS.highlight, width: 1.5, onTop: true })
    } catch {
      /* Overlay nicht bereit */
    }
  }

  cancel(): void {
    this.hoverOutline = []
  }

  /* ---------------- Intern ---------------- */

  /** Pipette: Material unter dem Cursor uebernehmen. */
  private sample(hit: PickHit): void {
    const kind = hit.kind === 'face' ? 'face' : hit.kind === 'edge' ? 'edge' : 'entity'
    const id = hit.id
    if (!id) return
    const side = this.sideOf(hit)
    const materialId = this.read((state) => state.sampleMaterial(kind, id, side))
    // `null` ist ein gueltiges Ergebnis (Standardmaterial), `undefined` nicht.
    if (materialId === undefined) return
    this.read((state) => {
      state.setActiveMaterial(materialId)
      return true
    })
    const name = this.read((state) => state.getMaterial(materialId)?.name)
    this.notify(name ? `Material übernommen: ${name}` : 'Standardmaterial übernommen', 'success')
  }

  private paint(hit: PickHit, scope: PaintScope): void {
    const materialId = this.read((state) => state.doc.activeMaterialId ?? null)
    const side = this.sideOf(hit)

    if (scope === 'single' || hit.kind !== 'face' || !hit.id) {
      const target = this.targetOf(hit)
      if (!target) return
      this.modify('Material zuweisen', (state) => state.applyMaterial(target, materialId ?? null, side))
      return
    }

    const faceIds = this.read((state) => this.matchingFaces(state, hit, scope, side))
    if (!faceIds || faceIds.length === 0) return
    this.modify('Material zuweisen', (state) =>
      state.applyMaterial({ faceIds, edgeIds: [], vertexIds: [], entityIds: [] }, materialId ?? null, side),
    )
    this.notify(`${faceIds.length} Flächen gefärbt`, 'success')
  }

  /** Alle Flaechen mit demselben Ausgangsmaterial im gewuenschten Umfang. */
  private matchingFaces(state: AppState, hit: PickHit, scope: PaintScope, side: 'front' | 'back'): Id[] {
    if (!hit.id) return []
    const start = state.getFace(hit.id, hit.definitionId ?? undefined)
    if (!start) return []
    const reference = side === 'back' ? start.backMaterialId : start.frontMaterialId

    const collect = (geometry: import('@/shared/types').Geometry | undefined): Id[] => {
      if (!geometry) return []
      const out: Id[] = []
      for (const face of Object.values(geometry.faces)) {
        const current = side === 'back' ? face.backMaterialId : face.frontMaterialId
        if (current === reference) out.push(face.id)
      }
      return out
    }

    if (scope === 'context') return collect(state.getActiveGeometry())

    // Modellweit: nur Flaechen des aktuellen Kontexts sind direkt adressierbar,
    // deshalb bleibt es beim aktiven Geometrietopf plus einem Hinweis.
    const all = collect(state.getActiveGeometry())
    const definitions = Object.keys(state.doc.definitions).length
    if (definitions > 1) {
      state.toast('Modellweites Färben gilt nur im aktuellen Kontext', 'info')
    }
    return all
  }

  private targetOf(hit: PickHit): Partial<Selection> | null {
    if (!hit.id) return null
    const sel = emptySelection()
    if (hit.kind === 'face' && hit.inContext) sel.faceIds.push(hit.id)
    else if (hit.kind === 'edge' && hit.inContext) sel.edgeIds.push(hit.id)
    else if (hit.topInstanceId) sel.entityIds.push(hit.topInstanceId)
    else if (hit.kind === 'instance' || hit.kind === 'entity') sel.entityIds.push(hit.id)
    else return null
    return sel
  }

  /** Sichtbare Seite: zeigt die Normale von der Kamera weg, sehen wir hinten. */
  private sideOf(hit: PickHit): 'front' | 'back' {
    if (!this.ctx || !hit.normal || V.isZero(hit.normal)) return 'front'
    const view = viewDirection(this.ctx.viewport)
    return V.dot(hit.normal, view) > 0 ? 'back' : 'front'
  }

  private showMode(pipette: boolean): void {
    this.status(
      pipette ? 'Pipette: Material aufnehmen' : this.hint,
      'Alt = Pipette, Strg = gleiche im Kontext, Umschalt = gleiche im Modell',
    )
  }
}
