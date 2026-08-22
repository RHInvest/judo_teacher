/**
 * Bildschirmtext.
 *
 *  - erster Klick setzt den Ankerpunkt auf der Geometrie, zweiter die
 *    Textposition, danach wird getippt und mit Eingabe bestaetigt
 *  - der Klick auf eine FLAECHE fuellt den Flaecheninhalt vor, auf eine
 *    KANTE die Laenge, auf einen ENDPUNKT die Koordinaten - alles ueber
 *    `@/shared/units` formatiert
 *  - ein Klick ins Leere erzeugt Text ohne Fuehrungslinie
 *
 * Getippt wird direkt im Werkzeug: Buchstaben wuerden sonst als
 * Werkzeugkuerzel ausgewertet. Das Massfeld zeigt den Text mit und darf ihn
 * ebenfalls entgegennehmen (siehe `onValueEntry`).
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type {
  Cursor,
  Id,
  KeyInfo,
  OverlayApi,
  PickHit,
  PointerInfo,
  TextEntity,
  ToolId,
  Vec3Like,
} from '@/shared/types'
import { newId } from '@/shared/ids'
import { P, V, POINT_TOL } from '@/core/math'
import { formatArea, formatLength, formatPoint } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { edgeWorldPoints, faceWorldPoints } from './helpers'

type Phase = 'anchor' | 'position' | 'typing'

const FONT_SIZE = 12
const TEXT_COLOR = '#e8e8e8'

export class TextTool extends BaseTool {
  readonly id: ToolId = 'text'
  readonly name: string = 'Text'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Text: Punkt anklicken'

  private phase: Phase = 'anchor'
  private anchor: Vec3Like | null = null
  private position: Vec3Like | null = null
  private buffer = ''
  private leader: TextEntity['leader'] = 'viewBased'

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.anchor
  }

  /* ---------------- Zeiger ---------------- */

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (this.phase === 'anchor') {
      this.infer(e, { from: null })
      return
    }
    if (this.phase === 'position') {
      const inf = this.infer(e, { from: this.anchor })
      this.position = V.clone(inf.point)
    }
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return

    if (this.phase === 'anchor') {
      const hit = this.pick(e, 8)
      const inf = this.infer(e, { from: null })
      this.anchor = V.clone(inf.point)
      this.buffer = this.prefillFor(hit, inf.type, this.anchor)
      const onGeometry = !!hit && hit.kind !== 'none' && hit.kind !== 'ground'
      if (onGeometry) {
        this.leader = 'viewBased'
        this.phase = 'position'
        this.status('Text: Position der Beschriftung wählen')
        return
      }
      // Klick ins Leere: Text ohne Fuehrungslinie, direkt an dieser Stelle.
      this.leader = 'none'
      this.position = V.clone(this.anchor)
      this.beginTyping()
      return
    }

    if (this.phase === 'position') {
      const inf = this.infer(e, { from: this.anchor })
      this.position = V.clone(inf.point)
      this.beginTyping()
      return
    }

    this.commit()
  }

  /* ---------------- Tastatur ---------------- */

  onKeyDown(e: KeyInfo): boolean {
    if (this.phase !== 'typing') return super.onKeyDown(e)
    if (e.ctrl || e.meta || e.alt) return super.onKeyDown(e)
    if (e.key === 'Enter') {
      this.commit()
      return true
    }
    if (e.key === 'Backspace') {
      this.buffer = Array.from(this.buffer).slice(0, -1).join('')
      this.showBuffer()
      return true
    }
    if (Array.from(e.key).length === 1) {
      this.buffer += e.key
      this.showBuffer()
      return true
    }
    return super.onKeyDown(e)
  }

  /**
   * Text aus dem Massfeld.
   *
   * Sonderfall aus der Verdrahtung: der Viewport leitet Ziffern und Komma an
   * das Massfeld um, sobald sie gedrueckt werden. Mitten in einem Text ("Raum
   * 12") landet die Ziffernfolge deshalb dort statt im Puffer. Ist der Puffer
   * schon gefuellt, wird der Feldinhalt darum ANGEHAENGT statt zu ersetzen -
   * so kommt genau das heraus, was der Nutzer getippt hat.
   */
  onValueEntry(text: string): boolean {
    if (this.phase !== 'typing') return false
    const entered = text.trim()
    if (entered === '') return false
    this.buffer = this.buffer === '' ? entered : `${this.buffer}${entered}`
    this.commit()
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      const anchor = this.anchor
      const position = this.position
      if (anchor) {
        overlay.point(anchor, 'cross', { color: COLORS.highlight, size: 7, onTop: true })
      }
      if (anchor && position) {
        if (this.leader !== 'none' && V.distance(anchor, position) > POINT_TOL) {
          overlay.line(anchor, position, { color: COLORS.guide, width: 1, onTop: true })
        }
        overlay.text(position, this.buffer === '' ? 'Text eingeben …' : this.buffer, {
          color: this.buffer === '' ? COLORS.guide : COLORS.neutral,
          size: 13,
          offsetX: 10,
          offsetY: -10,
          onTop: true,
          background: 'rgba(20,20,22,0.72)',
        })
      }
    } catch (err) {
      console.warn('[tools] Text: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private beginTyping(): void {
    this.phase = 'typing'
    this.showBuffer()
    this.status('Text: eingeben und mit Eingabe bestätigen', 'Esc = abbrechen')
  }

  private showBuffer(): void {
    this.vcb('Text', this.buffer, 'Beschriftung')
  }

  /**
   * Was in einer Beschriftung stehen soll, weiss das Modell meist selbst:
   * Flaecheninhalt, Kantenlaenge, Koordinaten eines Endpunkts.
   */
  private prefillFor(hit: PickHit | null, inference: string, point: Vec3Like): string {
    const units = this.units()
    if (hit && hit.id) {
      if (hit.kind === 'face') {
        const area = this.read((state) => faceArea(state, hit.id as Id, hit.definitionId, hit.worldTransform))
        if (area !== null && area > 0) return formatArea(area, units)
      }
      if (hit.kind === 'edge') {
        const points = this.read((state) =>
          edgeWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform),
        )
        if (points) return formatLength(V.distance(points[0], points[1]), units)
      }
      if (hit.kind === 'vertex') return formatPoint(point, units)
    }
    if (inference === 'endpoint' || inference === 'midpoint' || inference === 'center') {
      return formatPoint(point, units)
    }
    return ''
  }

  private commit(): void {
    const anchor = this.anchor
    const position = this.position
    const text = this.buffer.trim()
    if (!anchor || !position) {
      this.reset()
      this.status(this.hint)
      return
    }
    if (text === '') {
      this.reset()
      this.abortDegenerate('Text ohne Inhalt - es wurde nichts eingefügt')
      return
    }
    const tagId = this.read((state) => state.doc?.activeTagId ?? null) ?? null
    const entity: TextEntity = {
      id: newId('n'),
      type: 'text',
      name: text.length > 24 ? `${text.slice(0, 24)}…` : text,
      tagId,
      hidden: false,
      locked: false,
      anchor: V.clone(anchor),
      position: V.clone(position),
      text,
      fontSize: FONT_SIZE,
      color: TEXT_COLOR,
      screenSpace: true,
      leader: this.leader,
    }
    this.modify('Text einfügen', (state) => state.addEntity(entity))
    this.reset()
    this.status(this.hint)
  }

  private reset(): void {
    this.phase = 'anchor'
    this.anchor = null
    this.position = null
    this.buffer = ''
    this.leader = 'viewBased'
    this.clearVcb()
  }
}

/** Flaecheninhalt der Aussenschleife in Weltkoordinaten. */
function faceArea(state: AppState, faceId: Id, definitionId: Id | null, worldTransform: import('@/shared/types').Mat4Like): number | null {
  const points = faceWorldPoints(state, faceId, definitionId, worldTransform)
  if (points.length < 3) return null
  return P.polygonArea(points)
}
