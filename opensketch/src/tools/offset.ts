/**
 * Versatz.
 *
 *  - Flaeche anklicken: die Aussenschleife wird nach innen oder aussen
 *    versetzt und erzeugt einen Ring
 *  - sind zusammenhaengende Kanten ausgewaehlt, wird dieser Kantenzug versetzt
 *  - Doppelklick wiederholt den zuletzt benutzten Versatz auf der Flaeche
 *    unter dem Cursor
 *  - Massfeld: „Versatz"
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, Id, OverlayApi, PickHit, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { P, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { offsetPolygon, polygonWinding } from './geom'
import { faceWorldPlane, faceWorldPoints, parseSignedLength, selectionIsEmptySafe } from './helpers'

const DRAG_PX = 6

export class OffsetTool extends BaseTool {
  readonly id: ToolId = 'offset'
  readonly name: string = 'Versatz'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Versatz: Fläche oder Kantenzug wählen'

  private faceId: Id | null = null
  private edgeIds: Id[] = []
  private outline: Vec3Like[] = []
  private normal: Vec3Like = V.AXIS_Z
  private winding = 1
  private distance = 0
  private lastDistance = 0
  private downX = 0
  private downY = 0
  private started = false
  private hoverOutline: Vec3Like[] = []

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.outline.length > 0 ? this.outline[0] : null
  }

  /* ---------------- Zeiger ---------------- */

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.downX = e.x
    this.downY = e.y
    if (this.outline.length > 0) return
    if (this.beginFromSelection()) {
      this.started = true
      return
    }
    if (this.begin(this.pick(e, 6))) this.started = true
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (this.outline.length === 0) {
      this.updateHover(e)
      return
    }
    this.updateDistance(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0 || this.outline.length === 0) return
    const dragged = Math.hypot(e.x - this.downX, e.y - this.downY) > DRAG_PX
    if (this.started && !dragged) {
      this.started = false
      return
    }
    this.updateDistance(e)
    this.commit()
  }

  onDoubleClick(e: PointerInfo): void {
    if (Math.abs(this.lastDistance) < POINT_TOL) return
    if (!this.begin(this.pick(e, 6))) return
    this.distance = this.lastDistance
    this.commit()
  }

  /* ---------------- Massfeld ---------------- */

  onValueEntry(text: string): boolean {
    const value = parseSignedLength(text, this.units())
    if (value === null || Math.abs(value) < POINT_TOL) return false
    if (this.outline.length > 0) {
      this.distance = value
      this.commit()
      return true
    }
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
      if (this.outline.length >= 2) {
        overlay.polyline(this.outline, this.faceId !== null, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        const preview = this.previewPoints()
        if (preview) {
          overlay.polyline(preview, this.faceId !== null, { color: COLORS.preview, width: 2, onTop: true })
          if (this.faceId) overlay.polygonFill(preview, { color: COLORS.previewFill, opacity: 0.15 })
          const anchor = preview[0]
          overlay.line(this.outline[0], anchor, { color: COLORS.highlight, width: 1, onTop: true })
          overlay.text(anchor, formatLength(Math.abs(this.distance), this.units()), {
            color: COLORS.neutral,
            size: 12,
            offsetX: 12,
            offsetY: -12,
            onTop: true,
            background: 'rgba(20,20,22,0.72)',
          })
        }
      } else if (this.hoverOutline.length >= 3) {
        overlay.polyline(this.hoverOutline, true, { color: COLORS.selection, width: 1.5, onTop: true })
      }
    } catch (err) {
      console.warn('[tools] Versatz: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  /** Vorausgewaehlte Kanten haben Vorrang vor der Flaeche unter dem Cursor. */
  private beginFromSelection(): boolean {
    const sel = this.selection()
    if (selectionIsEmptySafe(sel) || sel.edgeIds.length < 1 || sel.faceIds.length > 0) return false
    const points = this.read((state) => {
      const geometry = state.getActiveGeometry()
      const chain: Vec3Like[] = []
      for (const edgeId of sel.edgeIds) {
        const edge = geometry.edges[edgeId]
        if (!edge) continue
        const a = geometry.vertices[edge.a]
        const b = geometry.vertices[edge.b]
        if (a && b) chain.push(a.p, b.p)
      }
      return chain
    })
    if (!points || points.length < 2) return false
    const ordered = orderChain(points)
    if (ordered.length < 2) return false
    this.edgeIds = [...sel.edgeIds]
    this.faceId = null
    this.outline = ordered
    const plane = P.fromPolygon(ordered) ?? this.workPlane(ordered[0])
    this.normal = plane.n
    this.winding = 1
    this.status('Versatz: Abstand ziehen oder eintippen')
    this.updateVcb()
    return true
  }

  private begin(hit: PickHit | null): boolean {
    if (!hit || hit.kind !== 'face' || !hit.id) return false
    if (!hit.inContext) {
      this.notify('Die Fläche liegt in einer Gruppe - erst mit Doppelklick betreten', 'warn')
      return false
    }
    const outline = this.read((state) => faceWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform))
    if (!outline || outline.length < 3) return false
    const plane = this.read((state) => faceWorldPlane(state, hit.id as Id, hit.definitionId, hit.worldTransform))
    this.faceId = hit.id
    this.edgeIds = []
    this.outline = outline
    this.normal = plane ? plane.n : V.AXIS_Z
    this.winding = polygonWinding(outline, this.normal)
    this.distance = 0
    this.status('Versatz: Abstand ziehen oder eintippen', 'Doppelklick wiederholt den letzten Versatz')
    this.updateVcb()
    return true
  }

  private updateHover(e: PointerInfo): void {
    const hit = this.pick(e, 6)
    if (!hit || hit.kind !== 'face' || !hit.id || !hit.inContext) {
      this.hoverOutline = []
      return
    }
    this.hoverOutline =
      this.read((state) => faceWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform)) ?? []
  }

  /**
   * Der Abstand ergibt sich aus dem Lot des Mauspunkts auf die naechste
   * Kante des Ausgangszugs - so folgt die Vorschau dem Cursor auch dann,
   * wenn er weit vom Startpunkt entfernt ist.
   */
  private updateDistance(e: PointerInfo): void {
    if (this.outline.length < 2) return
    const plane = P.fromNormalAndPoint(this.normal, this.outline[0])
    const inf = this.infer(e, { plane })
    const point = P.projectPoint(plane, inf.point)

    let bestDist = Number.POSITIVE_INFINITY
    let signed = 0
    const count = this.outline.length
    const segments = this.faceId ? count : count - 1
    for (let i = 0; i < segments; i++) {
      const a = this.outline[i]
      const b = this.outline[(i + 1) % count]
      const dir = V.sub(b, a)
      if (V.isZero(dir)) continue
      const outward = V.normalizeOr(V.cross(V.normalize(dir), this.normal), V.AXIS_X)
      const rel = V.sub(point, a)
      const along = V.dot(rel, V.normalize(dir))
      const length = V.length(dir)
      // nur Kanten beruecksichtigen, neben denen der Cursor wirklich liegt
      if (along < -length * 0.25 || along > length * 1.25) continue
      const lateral = V.dot(rel, outward)
      if (Math.abs(lateral) < bestDist) {
        bestDist = Math.abs(lateral)
        signed = lateral
      }
    }
    if (!Number.isFinite(bestDist)) return
    this.distance = signed * this.winding
    this.updateVcb()
  }

  private previewPoints(): Vec3Like[] | null {
    if (this.outline.length < 2 || Math.abs(this.distance) < POINT_TOL) return null
    return offsetPolygon(this.outline, this.normal, this.distance * this.winding, this.faceId !== null)
  }

  private commit(): void {
    const distance = this.distance
    if (Math.abs(distance) < POINT_TOL) {
      const hadOutline = this.outline.length > 0
      this.reset()
      if (hadOutline) this.abortDegenerate('Kein Versatz erzeugt - der Abstand ist 0')
      else this.status(this.hint)
      return
    }
    const faceId = this.faceId
    const edgeIds = [...this.edgeIds]
    if (faceId) {
      this.modify('Versatz', (state) => state.offsetFace(faceId, distance))
    } else if (edgeIds.length > 0) {
      this.modify('Versatz', (state) => state.offsetEdges(edgeIds, distance))
    }
    this.lastDistance = distance
    this.reset()
    this.status(this.hint, 'Doppelklick wiederholt den Versatz')
    this.updateVcb()
  }

  private updateVcb(): void {
    const value = this.outline.length > 0 ? this.distance : this.lastDistance
    this.vcb('Versatz', Math.abs(value) > POINT_TOL ? formatLength(value, this.units(), { suffix: false }) : '', 'Versatz')
  }

  private reset(): void {
    this.faceId = null
    this.edgeIds = []
    this.outline = []
    this.distance = 0
    this.started = false
    this.hoverOutline = []
  }
}

/**
 * Bringt lose Kantenendpunkte (paarweise a,b) in eine durchgehende Reihenfolge.
 * Nicht anschliessende Kanten werden verworfen - der Versatz braucht einen
 * zusammenhaengenden Zug.
 */
function orderChain(pairs: readonly Vec3Like[]): Vec3Like[] {
  if (pairs.length < 2) return []
  const chain: Vec3Like[] = [pairs[0], pairs[1]]
  const used = new Set<number>([0])

  let extended = true
  while (extended) {
    extended = false
    for (let i = 0; i < pairs.length / 2; i++) {
      if (used.has(i)) continue
      const a = pairs[i * 2]
      const b = pairs[i * 2 + 1]
      const head = chain[0]
      const tail = chain[chain.length - 1]
      if (V.distance(tail, a) < POINT_TOL * 10) {
        chain.push(b)
      } else if (V.distance(tail, b) < POINT_TOL * 10) {
        chain.push(a)
      } else if (V.distance(head, b) < POINT_TOL * 10) {
        chain.unshift(a)
      } else if (V.distance(head, a) < POINT_TOL * 10) {
        chain.unshift(b)
      } else {
        continue
      }
      used.add(i)
      extended = true
    }
  }
  return chain
}
