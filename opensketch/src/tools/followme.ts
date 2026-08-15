/**
 * Folge mir.
 *
 *  - zuerst das Profil (eine Flaeche) anklicken
 *  - sind Kanten vorausgewaehlt, laeuft das Profil sofort an ihnen entlang
 *  - sonst faehrt der Nutzer den Pfad ab; jede beruehrte Kante kommt dazu,
 *    ein Klick schliesst ab
 *  - Alt auf einer Flaeche nimmt deren kompletten Rand als Pfad
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, Id, OverlayApi, PickHit, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { orderEdgePath } from '@/core'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { edgeWorldPoints, faceWorldPoints, safeOrNull, selectionIsEmptySafe } from './helpers'

export class FollowMeTool extends BaseTool {
  readonly id: ToolId = 'followme'
  readonly name: string = 'Folge mir'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Folge mir: Profilfläche wählen'

  private profileId: Id | null = null
  private profileOutline: Vec3Like[] = []
  private pathIds: Id[] = []
  private pathSegments: [Vec3Like, Vec3Like][] = []

  protected onActivate(): void {
    this.reset()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.profileId) return
    // Pfad abfahren: jede beruehrte Kante wandert in den Pfad.
    const hit = this.pick(e, 8)
    if (!hit || hit.kind !== 'edge' || !hit.id || !hit.inContext) return
    this.addPathEdge(hit.id, hit)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return

    if (!this.profileId) {
      const hit = this.pick(e, 6)
      if (!this.beginProfile(hit)) return
      // Vorauswahl an Kanten? Dann direkt ausfuehren.
      const sel = this.selection()
      if (!selectionIsEmptySafe(sel) && sel.edgeIds.length > 0) {
        this.pathIds = [...sel.edgeIds]
        this.commit()
      }
      return
    }

    const hit = this.pick(e, 8)
    if (e.alt && hit && hit.kind === 'face' && hit.id) {
      // Alt: der komplette Rand der Flaeche unter dem Cursor ist der Pfad.
      const border = this.faceBorder(hit)
      if (border.length > 0) {
        this.pathIds = border
        this.commit()
        return
      }
    }
    if (hit && hit.kind === 'edge' && hit.id && hit.inContext) this.addPathEdge(hit.id, hit)
    this.commit()
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      if (this.profileOutline.length >= 3) {
        overlay.polyline(this.profileOutline, true, { color: COLORS.highlight, width: 2, onTop: true })
        overlay.polygonFill(this.profileOutline, { color: COLORS.previewFill, opacity: 0.2 })
      }
      for (const [a, b] of this.pathSegments) {
        overlay.line(a, b, { color: COLORS.preview, width: 3, onTop: true })
      }
    } catch (err) {
      console.warn('[tools] Folge mir: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private beginProfile(hit: PickHit | null): boolean {
    if (!hit || hit.kind !== 'face' || !hit.id) {
      this.notify('Folge mir braucht eine Profilfläche', 'warn')
      return false
    }
    if (!hit.inContext) {
      this.notify('Die Fläche liegt in einer Gruppe - erst mit Doppelklick betreten', 'warn')
      return false
    }
    this.profileId = hit.id
    this.profileOutline =
      this.read((state) => faceWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform)) ?? []
    this.pathIds = []
    this.pathSegments = []
    this.status('Folge mir: Pfad abfahren, Klick beendet', 'Alt auf einer Fläche = deren Rand als Pfad')
    return true
  }

  private addPathEdge(edgeId: Id, hit: PickHit): void {
    if (this.pathIds.includes(edgeId)) return
    this.pathIds.push(edgeId)
    const pts = this.read((state) => edgeWorldPoints(state, edgeId, hit.definitionId, hit.worldTransform))
    if (pts) this.pathSegments.push(pts)
  }

  /** Aussenrand einer Flaeche als geschlossener Pfad. */
  private faceBorder(hit: PickHit): Id[] {
    if (!hit.id) return []
    const face = this.read((state) => state.getFace(hit.id as Id, hit.definitionId ?? undefined))
    return face ? [...face.outer.edges] : []
  }

  private commit(): void {
    const profileId = this.profileId
    const path = this.orderedPath()
    if (!profileId || path.length === 0) {
      if (profileId) this.notify('Kein Pfad gewählt', 'warn')
      this.reset()
      this.status(this.hint)
      return
    }
    this.modify('Folge mir', (state) => state.followMe(profileId, path))
    this.reset()
    this.status(this.hint)
  }

  /** Der Kern erwartet den Pfad in Laufrichtung sortiert. */
  private orderedPath(): Id[] {
    if (this.pathIds.length < 2) return [...this.pathIds]
    const geometry = this.read((state) => state.getActiveGeometry())
    if (!geometry) return [...this.pathIds]
    const ordered = safeOrNull(() => orderEdgePath(geometry, this.pathIds))
    return ordered && ordered.length > 0 ? ordered : [...this.pathIds]
  }

  private reset(): void {
    this.profileId = null
    this.profileOutline = []
    this.pathIds = []
    this.pathSegments = []
    this.clearVcb()
  }
}
