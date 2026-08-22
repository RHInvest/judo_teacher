/**
 * Massband.
 *
 *  - zwei Punkte messen; die Laenge steht im Massfeld und als Beschriftung
 *    am Band
 *  - beginnt die Messung auf einer KANTE, entsteht eine dazu PARALLELE
 *    Hilfslinie im gemessenen Abstand - der eigentliche Zweck des Werkzeugs
 *    in SketchUp
 *  - `Strg` schaltet zwischen "messen und Hilfslinie" und "nur messen"
 *  - wird nach dem Messen eine ABWEICHENDE Laenge eingetippt, fragt das
 *    Werkzeug nach, ob das ganze Modell auf dieses Mass skaliert werden soll.
 *    Das ist eine drastische Operation: sie passiert nur nach einer
 *    ausdruecklichen Bestaetigung, nie stillschweigend.
 *
 * Hilfslinien sind KANTEN mit `guide: true`, keine `GuideLineEntity`: nur die
 * Kanten zeichnet der Renderer (`src/render/edges.ts`), und nur sie kennt die
 * Inferenzmaschine als Fangziel.
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type { Cursor, Id, OverlayApi, PointerInfo, Selection, ToolId, Vec3Like } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { M, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { edgeWorldPoints } from './helpers'
import { parseLengthInput } from './vcbInput'

/** Ein Messvorgang, der abgeschlossen ist und noch umskaliert werden kann. */
interface Measurement {
  start: Vec3Like
  end: Vec3Like
  length: number
}

export class TapeTool extends BaseTool {
  readonly id: ToolId = 'tape'
  readonly name: string = 'Maßband'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Maßband: Startpunkt wählen'

  /**
   * `start` = Startpunkt setzen, `end` = Endpunkt abgreifen, `done` = gemessen.
   *
   * `done` ist ein eigener Zustand und kein blosses "start ist gesetzt":
   * nach der Messung bleiben Strecke und Beschriftung stehen, damit der Nutzer
   * das Ergebnis liest und im Massfeld ein Zielmass eintippen kann. Der
   * naechste Klick beginnt dann eine NEUE Messung, statt vom alten Startpunkt
   * aus weiterzumessen.
   */
  private phase: 'start' | 'end' | 'done' = 'start'
  private start: Vec3Like | null = null
  private end: Vec3Like | null = null
  /** Kante, auf der die Messung begonnen hat - Grundlage der Parallelen. */
  private reference: { a: Vec3Like; b: Vec3Like } | null = null
  /** false = nur messen (Strg) */
  private guideMode = true
  private measured: Measurement | null = null

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.start
  }

  /* ---------------- Zeiger ---------------- */

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    this.guideMode = !(e.ctrl || e.meta)
    if (this.phase !== 'end' || !this.start) {
      this.infer(e, { from: null })
      return
    }
    const inf = this.infer(e, { from: this.start })
    this.end = V.clone(inf.point)
    this.updateVcb(V.distance(this.start, this.end))
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.guideMode = !(e.ctrl || e.meta)

    if (this.phase !== 'end') {
      const inf = this.infer(e, { from: null })
      this.phase = 'end'
      this.start = V.clone(inf.point)
      this.end = null
      this.measured = null
      this.reference = this.referenceEdge(inf.hit ?? null)
      this.status(
        this.reference ? 'Maßband: Abstand zur Kante abgreifen' : 'Maßband: Endpunkt wählen',
        'Strg = nur messen',
      )
      return
    }

    const inf = this.infer(e, { from: this.start })
    this.end = V.clone(inf.point)
    this.commit()
  }

  /* ---------------- Massfeld ---------------- */

  onValueEntry(text: string): boolean {
    const measured = this.measured
    if (!measured) return false
    const target = parseLengthInput(text, this.units())
    if (target === null || !Number.isFinite(target) || target <= 0) {
      // KEIN STILLES SCHEITERN: das Massfeld heisst "Zielmass", also erwartet
      // der Nutzer eine Reaktion - auch auf eine unlesbare Eingabe.
      this.notify(`Maßband: „${text.trim()}" ist kein Zielmaß - z. B. „4 m" oder „350 cm"`, 'warn')
      return false
    }
    if (Math.abs(target - measured.length) < POINT_TOL) {
      this.notify('Maßband: das Zielmaß entspricht der Messung - nichts geändert')
      return true
    }
    this.askForScale(measured, target)
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      if (this.reference) {
        overlay.guide(this.reference.a, this.reference.b, {
          color: COLORS.highlight,
          width: 1,
          dashed: true,
          onTop: true,
        })
      }
      if (this.start && this.end) {
        const length = V.distance(this.start, this.end)
        overlay.line(this.start, this.end, { color: COLORS.guide, width: 2, onTop: true })
        overlay.point(this.start, 'cross', { color: COLORS.guide, size: 7, onTop: true })
        overlay.point(this.end, 'cross', { color: COLORS.guide, size: 7, onTop: true })
        if (length > POINT_TOL) {
          overlay.text(V.midpoint(this.start, this.end), formatLength(length, this.units()), {
            color: COLORS.neutral,
            size: 12,
            offsetX: 12,
            offsetY: -12,
            onTop: true,
            background: 'rgba(20,20,22,0.72)',
          })
        }
        const guide = this.guideMode ? this.guideSegment() : null
        if (guide) {
          overlay.line(guide.a, guide.b, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        }
      } else if (this.start) {
        overlay.point(this.start, 'cross', { color: COLORS.guide, size: 7, onTop: true })
      }
    } catch (err) {
      console.warn('[tools] Maßband: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  /** Weltpunkte der angeklickten Kante, wenn der Klick auf einer lag. */
  private referenceEdge(hit: import('@/shared/types').PickHit | null): { a: Vec3Like; b: Vec3Like } | null {
    if (!hit || hit.kind !== 'edge' || !hit.id) return null
    const points = this.read((state) =>
      edgeWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform),
    )
    if (!points) return null
    return { a: points[0], b: points[1] }
  }

  /**
   * Die Hilfslinie, die aus der aktuellen Messung entsteht.
   *
   * Mit Bezugskante ist es die um den gemessenen Versatz verschobene Kante -
   * also eine echte Parallele im gemessenen Abstand. Ohne Bezugskante bleibt
   * die Messstrecke selbst als Hilfslinie stehen.
   */
  private guideSegment(): { a: Vec3Like; b: Vec3Like; parallel: boolean } | null {
    if (!this.start || !this.end) return null
    if (V.distance(this.start, this.end) < POINT_TOL) return null
    const ref = this.reference
    if (ref) {
      const dir = V.sub(ref.b, ref.a)
      if (!V.isZero(dir)) {
        const offset = V.projectOnPlaneNormal(V.sub(this.end, this.start), V.normalize(dir))
        if (V.length(offset) >= POINT_TOL) {
          return { a: V.add(ref.a, offset), b: V.add(ref.b, offset), parallel: true }
        }
      }
    }
    return { a: V.clone(this.start), b: V.clone(this.end), parallel: false }
  }

  private commit(): void {
    const start = this.start
    const end = this.end
    if (!start || !end) {
      this.reset()
      this.status(this.hint)
      return
    }
    const length = V.distance(start, end)
    if (length < POINT_TOL) {
      this.reset()
      this.abortDegenerate('Maßband: Länge 0 - Start- und Endpunkt liegen aufeinander')
      return
    }

    const guide = this.guideMode ? this.guideSegment() : null
    if (guide) {
      this.modify('Hilfslinie (Maßband)', (state) => state.addEdge(guide.a, guide.b, { guide: true }))
      if (this.reference && !guide.parallel) {
        this.notify('Maßband: kein Abstand zur Kante - die Hilfslinie liegt auf der Messstrecke')
      }
    }

    this.measured = { start: V.clone(start), end: V.clone(end), length }
    this.phase = 'done'
    this.reference = null
    this.updateVcb(length)
    this.status(
      `Maßband: ${formatLength(length, this.units())} gemessen`,
      'Zielmaß eintippen = Modell skalieren',
    )
  }

  private updateVcb(length: number): void {
    this.vcb('Länge', formatLength(length, this.units(), { suffix: false }), 'Zielmaß')
  }

  /**
   * Umskalieren ist nichts, was nebenbei passiert: es zieht das gesamte
   * Modell auseinander. Deshalb erst die Rueckfrage, und die Kurzmeldung
   * dazu, damit auch der es mitbekommt, der gerade auf den Cursor schaut.
   */
  private askForScale(measured: Measurement, target: number): void {
    const factor = target / measured.length
    if (!Number.isFinite(factor) || factor <= 0) return
    const units = this.units()
    const message =
      `Die gemessene Strecke ist ${formatLength(measured.length, units)} lang, ` +
      `eingegeben wurde ${formatLength(target, units)}. ` +
      `Soll das gesamte Modell um den Faktor ${formatFactor(factor)} skaliert werden? ` +
      'Das verändert jede Geometrie im aktuellen Kontext.'
    this.notify('Maßband: Modell skalieren? Bitte die Rückfrage beantworten.', 'warn')
    const opened = this.read((state) => {
      state.openDialog({
        kind: 'confirm',
        title: 'Modell skalieren',
        message,
        onConfirm: () => this.scaleModel(measured.start, factor),
      })
      return true
    })
    if (!opened) {
      // Ohne Dialogweg wird NICHT skaliert - lieber nichts tun als heimlich alles verzerren.
      this.notify('Maßband: Rückfrage nicht möglich - das Modell bleibt unverändert', 'warn')
    }
  }

  private scaleModel(origin: Vec3Like, factor: number): void {
    const selection = this.read((state) => contextSelection(state)) ?? emptySelection()
    const count =
      selection.edgeIds.length + selection.faceIds.length + selection.vertexIds.length + selection.entityIds.length
    if (count === 0) {
      this.abortDegenerate('Maßband: nichts zu skalieren - der Kontext ist leer')
      return
    }
    this.applyMatrix('Modell skalieren (Maßband)', selection, M.scalingAbout(origin, factor), false)
    this.measured = null
    this.notify(`Modell um Faktor ${formatFactor(factor)} skaliert`, 'success')
    this.reset()
    this.status(this.hint)
  }

  private reset(): void {
    this.phase = 'start'
    this.start = null
    this.end = null
    this.reference = null
    this.measured = null
    this.guideMode = true
    this.vcb('Länge', '', 'Zielmaß')
  }
}

/**
 * Skalierungsfaktor fuer die Anzeige.
 *
 * Bewusst ueber Runden statt ueber `toFixed(4)` mit abgeschnittenen Nullen:
 * dabei verliert der Faktor 20 seine Null und wird zu "2" - eine Zahl, die
 * dem Nutzer eine zehnfach kleinere Aenderung vorspiegelt, als er auslöst.
 */
function formatFactor(factor: number): string {
  return String(Math.round(factor * 10000) / 10000)
}

/** Alles, was im aktiven Kontext liegt - Geometrie und eigene Entities. */
function contextSelection(state: AppState): Selection {
  const sel = emptySelection()
  const geometry = state.getActiveGeometry()
  if (geometry) {
    sel.vertexIds.push(...Object.keys(geometry.vertices ?? {}))
    sel.edgeIds.push(...Object.keys(geometry.edges ?? {}))
    sel.faceIds.push(...Object.keys(geometry.faces ?? {}))
  }
  const definition = state.doc?.definitions?.[state.context?.definitionId ?? '']
  for (const childId of definition?.children ?? []) sel.entityIds.push(childId)
  return sel
}
