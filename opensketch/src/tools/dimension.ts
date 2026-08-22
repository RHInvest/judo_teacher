/**
 * Bemassung.
 *
 *  - zwei Punkte waehlen, dann den Versatz der Masslinie herausziehen
 *  - ein Klick auf eine KANTE bemasst deren Laenge in einem Schritt
 *  - liegt die angeklickte Kante auf einem Kreis oder Bogen, entsteht eine
 *    Radius- bzw. Durchmesserbemassung (`kind: 'radius'` / `'diameter'`);
 *    `Strg` schaltet zwischen beiden um
 *  - gefangen wird ueber die Inferenzmaschine: Endpunkte, Mittelpunkte,
 *    Mittelpunkte von Kreisen, Schnittpunkte
 *
 * Erzeugt eine `DimensionEntity` ueber `store.addEntity`. Punkte sind
 * WELTKOORDINATEN (Contract des Stores).
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type {
  Cursor,
  DimensionEntity,
  DimensionKind,
  Id,
  Mat4Like,
  OverlayApi,
  PickHit,
  PointerInfo,
  ToolId,
  Vec3Like,
} from '@/shared/types'
import { newId } from '@/shared/ids'
import { M, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { circumcenter } from './geom'
import { edgeWorldPoints, safeOrNull } from './helpers'

type Phase = 'first' | 'second' | 'offset'

/** Voreinstellungen der erzeugten Entitaet - der Renderer zeichnet danach. */
const FONT_SIZE = 12
const TEXT_COLOR = '#e8e8e8'

interface CircleFit {
  center: Vec3Like
  normal: Vec3Like
  radius: number
  closed: boolean
}

export class DimensionTool extends BaseTool {
  readonly id: ToolId = 'dimension'
  readonly name: string = 'Bemaßung'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Bemaßung: Kante anklicken oder ersten Punkt wählen'

  private phase: Phase = 'first'
  private start: Vec3Like | null = null
  private end: Vec3Like | null = null
  private offset: Vec3Like = V.v3()
  private kind: DimensionKind = 'linear'
  private circle: CircleFit | null = null
  /** Was der Kreis von sich aus hergibt; `Strg` kehrt es um. */
  private circleKind: DimensionKind = 'diameter'
  /** Eigene Beschriftung aus dem Massfeld statt des gemessenen Masses. */
  private override: string | null = null

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.start
  }

  /* ---------------- Zeiger ---------------- */

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (this.phase === 'first') {
      this.infer(e, { from: null })
      return
    }
    if (this.phase === 'second') {
      const inf = this.infer(e, { from: this.start })
      this.end = V.clone(inf.point)
      this.updateVcb()
      return
    }
    this.updateOffset(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return

    if (this.phase === 'first') {
      if (this.takeEdge(e)) return
      const inf = this.infer(e, { from: null })
      this.start = V.clone(inf.point)
      this.phase = 'second'
      this.status('Bemaßung: zweiten Punkt wählen', 'Kante anklicken bemaßt sie ganz')
      return
    }

    if (this.phase === 'second') {
      const inf = this.infer(e, { from: this.start })
      this.end = V.clone(inf.point)
      if (!this.start || V.distance(this.start, this.end) < POINT_TOL) {
        this.reset()
        this.abortDegenerate('Bemaßung: Länge 0 - beide Punkte liegen aufeinander')
        return
      }
      this.phase = 'offset'
      this.status('Bemaßung: Maßlinie absetzen', 'Strg = Radius/Durchmesser')
      return
    }

    this.updateOffset(e)
    this.commit()
  }

  /* ---------------- Massfeld ---------------- */

  /**
   * Eingetippter Text ueberschreibt die Beschriftung der Bemassung
   * (`DimensionEntity.text`) - so entsteht "Lichte Weite" statt "1,20 m".
   *
   * Das gemessene MASS bleibt davon unberuehrt: es kommt aus der Geometrie.
   * Wer die Laenge aendern will, aendert die Geometrie - alles andere waere
   * eine Bemassung, die luegt.
   */
  onValueEntry(text: string): boolean {
    if (this.phase === 'first') return false
    const entered = text.trim()
    this.override = entered === '' ? null : entered
    this.notify(
      this.override === null
        ? 'Bemaßung: eigene Beschriftung entfernt, es gilt wieder das gemessene Maß'
        : `Bemaßung: Beschriftung „${this.override}" statt des gemessenen Maßes`,
    )
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      const start = this.start
      const end = this.end
      if (start && end) {
        const a = V.add(start, this.offset)
        const b = V.add(end, this.offset)
        overlay.line(start, a, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        overlay.line(end, b, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        overlay.line(a, b, { color: COLORS.preview, width: 2, onTop: true })
        overlay.point(a, 'cross', { color: COLORS.preview, size: 6, onTop: true })
        overlay.point(b, 'cross', { color: COLORS.preview, size: 6, onTop: true })
        overlay.text(V.midpoint(a, b), this.label(), {
          color: COLORS.neutral,
          size: 12,
          offsetX: 0,
          offsetY: -14,
          onTop: true,
          background: 'rgba(20,20,22,0.72)',
        })
      }
      if (this.circle) {
        overlay.circle(this.circle.center, this.circle.normal, this.circle.radius, {
          color: COLORS.highlight,
          width: 1,
          dashed: true,
          onTop: true,
        })
      }
    } catch (err) {
      console.warn('[tools] Bemaßung: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  /**
   * Klick auf eine Kante: entweder ihre Laenge oder - wenn sie zu einem
   * Kreis/Bogen gehoert - Radius bzw. Durchmesser.
   * Liefert true, wenn der Klick verarbeitet wurde.
   */
  private takeEdge(e: PointerInfo): boolean {
    const hit = this.pick(e, 8)
    if (!hit || hit.kind !== 'edge' || !hit.id) return false
    const fit = this.read((state) => fitCircle(state, hit))
    if (fit) {
      this.circle = fit
      // Ein geschlossener Kreis wird bemasst wie in SketchUp: Durchmesser.
      // Ein Bogen hat keinen, also Radius. `Strg` kehrt die Wahl um.
      this.circleKind = fit.closed ? 'diameter' : 'radius'
      this.kind = this.circleKind
      this.applyCircle(hit.point)
      this.phase = 'offset'
      this.status(
        this.kind === 'diameter' ? 'Bemaßung: Durchmesser absetzen' : 'Bemaßung: Radius absetzen',
        'Strg = zwischen Radius und Durchmesser wechseln',
      )
      return true
    }
    const points = this.read((state) => edgeWorldPoints(state, hit.id as Id, hit.definitionId, hit.worldTransform))
    if (!points) return false
    if (V.distance(points[0], points[1]) < POINT_TOL) {
      this.abortDegenerate('Bemaßung: die Kante hat keine Länge')
      return true
    }
    this.kind = 'linear'
    this.circle = null
    this.start = points[0]
    this.end = points[1]
    this.phase = 'offset'
    this.status('Bemaßung: Maßlinie absetzen')
    return true
  }

  /** Start-/Endpunkt aus dem Kreis, ausgerichtet auf den angeklickten Punkt. */
  private applyCircle(at: Vec3Like): void {
    const fit = this.circle
    if (!fit) return
    const rel = V.projectOnPlaneNormal(V.sub(at, fit.center), fit.normal)
    const dir = V.isZero(rel) ? V.anyPerpendicular(fit.normal) : V.normalize(rel)
    const rim = V.addScaled(fit.center, dir, fit.radius)
    if (this.kind === 'diameter') {
      this.start = V.addScaled(fit.center, dir, -fit.radius)
      this.end = rim
    } else {
      this.start = V.clone(fit.center)
      this.end = rim
    }
  }

  private updateOffset(e: PointerInfo): void {
    if (!this.start || !this.end) return
    if (this.circle) {
      const inverted = e.ctrl || e.meta
      const wanted: DimensionKind = inverted
        ? this.circleKind === 'diameter'
          ? 'radius'
          : 'diameter'
        : this.circleKind
      if (wanted !== this.kind) {
        // Strg kehrt die Kreisbemassung um, ohne den Ablauf zu unterbrechen.
        this.kind = wanted
        this.applyCircle(this.end)
      }
    }
    const start = this.start
    const end = this.end
    /*
     * `from: start` gibt der Inferenz die Arbeitsebene DURCH die Messstrecke
     * statt der Bodenebene - sonst liesse sich die Masslinie an einer
     * senkrechten Wand nicht herausziehen. Richtungsinferenzen bleiben
     * gesperrt: sie laufen alle durch die Messstrecke und wuerden den Versatz
     * auf null ziehen.
     */
    const inf = this.infer(e, { from: start, allowDirections: false })
    const dir = V.sub(end, start)
    const rel = V.sub(inf.point, V.midpoint(start, end))
    this.offset = V.isZero(dir) ? rel : V.projectOnPlaneNormal(rel, V.normalize(dir))
    this.updateVcb()
  }

  private label(): string {
    if (this.override !== null) return this.override
    const start = this.start
    const end = this.end
    if (!start || !end) return ''
    const units = this.units()
    if (this.kind === 'radius') return `R ${formatLength(V.distance(start, end), units)}`
    if (this.kind === 'diameter') return `⌀ ${formatLength(V.distance(start, end), units)}`
    return formatLength(V.distance(start, end), units)
  }

  private updateVcb(): void {
    const start = this.start
    const end = this.end
    if (!start || !end) {
      this.clearVcb()
      return
    }
    const label = this.kind === 'radius' ? 'Radius' : this.kind === 'diameter' ? 'Durchmesser' : 'Länge'
    this.vcb(label, formatLength(V.distance(start, end), this.units(), { suffix: false }), 'eigene Beschriftung')
  }

  private commit(): void {
    const start = this.start
    const end = this.end
    if (!start || !end) {
      this.reset()
      this.status(this.hint)
      return
    }
    if (V.distance(start, end) < POINT_TOL) {
      this.reset()
      this.abortDegenerate('Bemaßung: Länge 0 - es gibt nichts zu bemaßen')
      return
    }
    const kind = this.kind
    const circle = this.circle
    const offset = V.clone(this.offset)
    const tagId = this.read((state) => state.doc?.activeTagId ?? null) ?? null

    const entity: DimensionEntity = {
      id: newId('n'),
      type: 'dimension',
      name: kind === 'radius' ? 'Radius' : kind === 'diameter' ? 'Durchmesser' : 'Bemaßung',
      tagId,
      hidden: false,
      locked: false,
      kind,
      start: V.clone(start),
      end: V.clone(end),
      offset,
      // Bei Radius und Durchmesser braucht der Renderer den Kreismittelpunkt,
      // um Pfeil und Anschlusslinie richtig zu setzen.
      ...(circle ? { center: V.clone(circle.center) } : {}),
      text: this.override,
      fontSize: FONT_SIZE,
      color: TEXT_COLOR,
      screenSpace: true,
      arrowStyle: 'closedArrow',
    }
    this.modify('Bemaßung setzen', (state) => state.addEntity(entity))
    const label = this.label()
    this.reset()
    this.status(`Bemaßung gesetzt: ${label}`, this.hint)
  }

  private reset(): void {
    this.phase = 'first'
    this.start = null
    this.end = null
    this.offset = V.v3()
    this.kind = 'linear'
    this.circle = null
    this.circleKind = 'diameter'
    this.override = null
    this.clearVcb()
  }
}

/* ------------------------------------------------------------------ */
/* Kreiserkennung                                                      */
/* ------------------------------------------------------------------ */

/** Hoechstzahl der Kanten, die fuer eine Kreiserkennung verfolgt werden. */
const MAX_CHAIN = 512

/**
 * Verfolgt die Kantenkette, in der `edgeId` liegt, solange jeder Knoten genau
 * zwei Kanten hat - das ist der Umriss eines Kreises oder Bogens, wie ihn die
 * Zeichenwerkzeuge erzeugen. Liefert die Punkte in Reihenfolge.
 */
function edgeChainPoints(
  state: AppState,
  edgeId: Id,
  definitionId: Id | null,
  worldTransform: Mat4Like,
): { points: Vec3Like[]; closed: boolean } | null {
  const def = definitionId ?? undefined
  const first = safeOrNull(() => state.getEdge(edgeId, def))
  if (!first) return null

  const pointOf = (vertexId: Id): Vec3Like | null => {
    const vertex = safeOrNull(() => state.getVertex(vertexId, def))
    return vertex ? M.transformPoint(worldTransform, vertex.p) : null
  }

  /** Die andere Kante an diesem Knoten, wenn es genau eine gibt. */
  const nextEdge = (vertexId: Id, cameFrom: Id): { edgeId: Id; other: Id } | null => {
    const vertex = safeOrNull(() => state.getVertex(vertexId, def))
    if (!vertex || vertex.edges.length !== 2) return null
    const otherId = vertex.edges[0] === cameFrom ? vertex.edges[1] : vertex.edges[0]
    if (otherId === cameFrom) return null
    const edge = safeOrNull(() => state.getEdge(otherId, def))
    if (!edge) return null
    return { edgeId: otherId, other: edge.a === vertexId ? edge.b : edge.a }
  }

  const ids: Id[] = [first.a, first.b]
  let closed = false

  // vorwaerts
  let currentEdge = edgeId
  let currentVertex = first.b
  for (let i = 0; i < MAX_CHAIN; i++) {
    const step = nextEdge(currentVertex, currentEdge)
    if (!step) break
    if (step.other === ids[0]) {
      closed = true
      break
    }
    ids.push(step.other)
    currentEdge = step.edgeId
    currentVertex = step.other
  }

  // rueckwaerts
  if (!closed) {
    currentEdge = edgeId
    currentVertex = first.a
    for (let i = 0; i < MAX_CHAIN; i++) {
      const step = nextEdge(currentVertex, currentEdge)
      if (!step) break
      if (ids.includes(step.other)) break
      ids.unshift(step.other)
      currentEdge = step.edgeId
      currentVertex = step.other
    }
  }

  const points: Vec3Like[] = []
  for (const id of ids) {
    const p = pointOf(id)
    if (!p) return null
    points.push(p)
  }
  return { points, closed }
}

/**
 * Prueft, ob die Kantenkette auf einem Kreis liegt.
 *
 * Kreise und Boegen sind im Modell Polygonzuege - eine Kreisbemassung muss
 * ihnen deshalb angesehen werden. Es reicht nicht, drei Punkte zu nehmen:
 * jedes Dreieck liegt auf einem Kreis. Erst wenn ALLE Punkte der Kette
 * denselben Abstand zum Mittelpunkt haben, ist es wirklich einer.
 */
export function fitCircle(state: AppState, hit: PickHit): CircleFit | null {
  if (!hit.id) return null
  const chain = edgeChainPoints(state, hit.id, hit.definitionId, hit.worldTransform)
  if (!chain || chain.points.length < 4) return null
  const points = chain.points
  const fit = circumcenter(points[0], points[Math.floor(points.length / 2)], points[points.length - 1])
  if (!fit || !Number.isFinite(fit.radius) || fit.radius < POINT_TOL) return null
  const tolerance = Math.max(fit.radius * 1e-3, POINT_TOL)
  for (const p of points) {
    if (Math.abs(V.distance(p, fit.center) - fit.radius) > tolerance) return null
  }
  return { center: fit.center, normal: fit.normal, radius: fit.radius, closed: chain.closed }
}
