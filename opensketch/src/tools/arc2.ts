/**
 * 2-Punkt-Bogen: Sehne (zwei Klicks) + Bogenhoehe.
 * Massfeld: „Länge" fuer die Sehne, danach „Bogenhöhe"
 * (`r2,5` setzt stattdessen den Radius, `12s` die Segmentzahl).
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PlaneLike, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { P, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { arcBulgePoints, bulgeFromRadius, radiusFromBulge, usablePoints } from './geom'
import { clampInt } from './helpers'
import { parseLengthInput, parseSegmentsInput } from './vcbInput'

const DEFAULT_ARC_SEGMENTS = 12

export class Arc2Tool extends BaseTool {
  readonly id: ToolId = 'arc2'
  readonly name: string = '2-Punkt-Bogen'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Bogen: Startpunkt der Sehne wählen'

  protected start: Vec3Like | null = null
  protected end: Vec3Like | null = null
  protected plane: PlaneLike | null = null
  protected bulge = 0
  protected segments = DEFAULT_ARC_SEGMENTS
  protected halfCircle = false

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.end ?? this.start
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    if (!this.start) {
      const inf = this.infer(e, { from: null })
      this.start = V.clone(inf.point)
      this.plane = inf.plane ?? this.workPlane(this.start)
      this.status('Bogen: Endpunkt der Sehne wählen', 'Maßfeld: Sehnenlänge')
      this.vcb('Länge', '', 'Sehnenlänge')
      return
    }
    if (!this.end) {
      const inf = this.infer(e, { from: this.start })
      if (V.distance(inf.point, this.start) < POINT_TOL) return
      this.end = V.clone(inf.point)
      this.status('Bogen: Bogenhöhe festlegen', 'Maßfeld: Bogenhöhe, r… = Radius, 12s = Segmente')
      this.vcb('Bogenhöhe', '', 'Bogenhöhe')
      return
    }
    this.updateBulge(e)
    this.commit()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.start) {
      this.infer(e, { from: null })
      return
    }
    if (!this.end) {
      const inf = this.infer(e, { from: this.start, plane: this.plane })
      this.vcb('Länge', formatLength(V.distance(this.start, inf.point), this.units(), { suffix: false }), 'Sehnenlänge')
      return
    }
    this.updateBulge(e)
    this.vcb('Bogenhöhe', formatLength(Math.abs(this.bulge), this.units(), { suffix: false }), 'Bogenhöhe')
  }

  onValueEntry(text: string): boolean {
    const units = this.units()
    const seg = parseSegmentsInput(text, false)
    if (seg !== null) {
      this.segments = clampInt(seg, 1, 999)
      return true
    }
    if (this.start && !this.end) {
      const length = parseLengthInput(text, units)
      if (length === null || length <= POINT_TOL) return false
      const dir = this.inf && V.distance(this.inf.point, this.start) > POINT_TOL
        ? V.normalize(V.sub(this.inf.point, this.start))
        : V.AXIS_X
      this.end = V.addScaled(this.start, dir, length)
      this.status('Bogen: Bogenhöhe festlegen')
      return true
    }
    if (this.start && this.end) {
      const radiusInput = text.trim().toLowerCase()
      if (radiusInput.startsWith('r')) {
        const radius = parseLengthInput(radiusInput.slice(1), units)
        if (radius === null || radius <= POINT_TOL) return false
        const chord = V.distance(this.start, this.end)
        const bulge = bulgeFromRadius(chord, radius)
        this.bulge = this.bulge < 0 ? -bulge : bulge
        this.commit()
        return true
      }
      const bulge = parseLengthInput(text, units)
      if (bulge === null || Math.abs(bulge) < POINT_TOL) return false
      this.bulge = this.bulge < 0 ? -Math.abs(bulge) : Math.abs(bulge)
      this.commit()
      return true
    }
    return false
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      if (this.start && !this.end && this.inf) {
        overlay.line(this.start, this.inf.point, { color: COLORS.preview, width: 2, onTop: true })
      }
      if (this.start && this.end) {
        overlay.line(this.start, this.end, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        const points = this.previewPoints()
        if (points) {
          overlay.polyline(points, false, { color: COLORS.preview, width: 2, onTop: true })
          if (this.halfCircle) {
            const mid = points[Math.floor(points.length / 2)]
            overlay.text(mid, 'Halbkreis', {
              color: COLORS.highlight,
              size: 12,
              offsetY: -16,
              onTop: true,
              background: 'rgba(20,20,22,0.72)',
            })
          }
        }
      }
    } catch (err) {
      console.warn('[tools] Bogen: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  protected normal(): Vec3Like {
    return this.plane ? this.plane.n : V.AXIS_Z
  }

  /**
   * Dritter Schritt: die Bogenhoehe.
   *
   * Richtungsinferenzen sind gesperrt. Sie laufen durch den Sehnenendpunkt;
   * liegt die Sehne achsenparallel - der Normalfall, weil sie meist selbst auf
   * eine Achse gerastet wurde -, faellt die Achsengerade mit der Sehne
   * zusammen. Der Punkt rastet darauf, die Bogenhoehe ist exakt null und der
   * Bogen verschwindet. Die Halbkreis-Inferenz weiter unten bleibt erhalten;
   * sie ist die Rastung, die an dieser Stelle wirklich hilft.
   */
  private updateBulge(e: PointerInfo): void {
    if (!this.start || !this.end) return
    const inf = this.infer(e, { from: this.end, plane: this.plane, allowDirections: false })
    const chord = V.sub(this.end, this.start)
    const length = V.length(chord)
    if (length < POINT_TOL) return
    let perp = V.cross(this.normal(), V.normalize(chord))
    if (V.isZero(perp)) perp = V.anyPerpendicular(chord)
    perp = V.normalize(perp)
    const mid = V.midpoint(this.start, this.end)
    let bulge = V.dot(V.sub(inf.point, mid), perp)
    // Halbkreis-Inferenz
    this.halfCircle = Math.abs(Math.abs(bulge) - length / 2) < length * 0.03
    if (this.halfCircle) bulge = bulge < 0 ? -length / 2 : length / 2
    this.bulge = bulge
  }

  protected previewPoints(): Vec3Like[] | null {
    if (!this.start || !this.end || Math.abs(this.bulge) < POINT_TOL) return null
    return usablePoints(arcBulgePoints(this.start, this.end, this.bulge, this.normal(), this.segments), 2)
  }

  protected commit(): void {
    const points = this.previewPoints()
    if (!points) {
      const reason =
        this.start && this.end && V.distance(this.start, this.end) < POINT_TOL
          ? 'Bogen: die Sehne hat die Länge 0'
          : 'Bogen: Bogenhöhe 0 - der Punkt liegt auf der Sehne'
      this.reset()
      this.abortDegenerate(reason)
      return
    }
    this.modify('Bogen zeichnen', (state) => state.addPolyline(points, false))
    this.reset()
    this.status(this.hint)
  }

  protected reset(): void {
    this.start = null
    this.end = null
    this.plane = null
    this.bulge = 0
    this.halfCircle = false
    this.vcb('', '', '')
  }

  /** Radius des aktuellen Bogens (Anzeige / Folgewerkzeuge). */
  protected currentRadius(): number {
    if (!this.start || !this.end) return 0
    return radiusFromBulge(V.distance(this.start, this.end), this.bulge)
  }
}
