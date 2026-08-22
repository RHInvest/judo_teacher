/**
 * Annotationen: Bemassungen, Texte, Hilfslinien, Hilfspunkte und Bilder.
 *
 * Annotationen sind DOKUMENTINHALT, kein Werkzeug-Overlay. Sie werden deshalb
 * wie der Instanzbaum aus dem Dokument gebaut und nur bei Bedarf neu erzeugt -
 * nicht jeden Frame wie `overlay.ts`.
 *
 * Zwei Ebenen, aus demselben Grund wie beim Overlay:
 *
 *  1. WEBGL - Masslinien, Hilfslinien, Pfeile, Kreuzmarker, Bildrechtecke.
 *     Alles liegt im Weltraum, wird also von der Geometrie verdeckt und ist
 *     automatisch Teil von `captureImage`.
 *  2. CANVAS-2D - der Text. Ein Bitmap-Text im WebGL waere bei jeder Zoomstufe
 *     unscharf; auf der 2D-Ebene bleibt er pixelgenau. Damit Text auch im
 *     exportierten Bild landet, zeichnet `viewport.captureImage` dieselbe
 *     Befehlsliste in die Ziel-Leinwand (`draw2d`).
 *
 * Ein Text mit `screenSpace: true` wird zur Kamera gedreht und behaelt seine
 * Pixelgroesse. Mit `screenSpace: false` liegt er in einer Ebene des Modells:
 * dazu werden die beiden Ebenenachsen projiziert und als affine Transformation
 * an den 2D-Kontext gegeben. Fuer Annotationstext ist das exakt in der
 * Parallelprojektion und in der Perspektive praktisch nicht unterscheidbar.
 *
 * EINHEIT VON `fontSize`: Pixel bei `screenSpace: true`, Meter bei
 * `screenSpace: false`. Der Contract laesst das offen; so ist es die einzige
 * Auslegung, bei der beide Faelle sinnvolle Groessen ergeben.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { B, M, V } from '@/core/math'
import type {
  DimensionEntity,
  Entity,
  GuideLineEntity,
  GuidePointEntity,
  Id,
  ImageEntity,
  SketchDocument,
  TextEntity,
  UnitSettings,
  Vec3Like,
} from '@/shared/types'
import { DEFAULT_UNITS, formatAngle, formatLength } from '@/shared/units'
import { AXIS_X_COLOR, AXIS_Y_COLOR, AXIS_Z_COLOR, GUIDE_COLOR, HOVER_COLOR, SELECT_COLOR } from './defaults'
import { SketchLineMaterial } from './lineMaterial'
import type { InstanceRecord, SceneSync } from './sceneSync'
import type { RenderSnapshot } from './snapshot'
import { clamp, clearGroup, parseColor, warnOnce } from './util'

/** Was die Textebene von der Kamera braucht (wie `OverlayHost`). */
export interface AnnotationHost {
  worldToScreen(p: Vec3Like): { x: number; y: number; depth: number; visible: boolean }
  pixelsPerUnit(p: Vec3Like): number
  getSize(): { width: number; height: number }
}

/** Deckkraft von Annotationen ausserhalb des aktiven Kontexts. */
const DIM_OPACITY = 0.4

/** Schriftgroesse, in der die Ebenentexte gerastert werden. */
const PLANE_FONT_PX = 64

/** Kleinste und groesste Pixelgroesse eines Ebenentexts - sonst Flimmern. */
const MIN_PLANE_TEXT_PX = 4
const MAX_PLANE_TEXT_PX = 4000

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

/** Voreingestellte Textgroesse, wenn die Entitaet keine brauchbare liefert. */
const FALLBACK_SCREEN_FONT_PX = 13
const FALLBACK_PLANE_FONT_M = 0.2

/* ------------------------------------------------------------------ */
/* Befehle der Textebene                                               */
/* ------------------------------------------------------------------ */

interface LabelCommand {
  text: string
  /** Textmitte im Weltraum */
  anchor: Vec3Like
  /** Punkt, in dessen Richtung der Text von der Masslinie weggeschoben wird */
  away: Vec3Like | null
  color: string
  /** Pixel bei `screenSpace`, Meter sonst */
  size: number
  screenSpace: boolean
  /** Achsen der Textebene im Weltraum (nur wenn nicht `screenSpace`) */
  u: Vec3Like
  v: Vec3Like
  opacity: number
  /** Hintergrundfarbe hinter dem Text, null = keiner */
  background: string | null
}

/** Fuehrungslinie, die immer obenauf liegt (`leader: 'viewBased'`). */
interface ScreenLeaderCommand {
  from: Vec3Like
  to: Vec3Like
  color: string
  opacity: number
}

/* ------------------------------------------------------------------ */
/* Liniensammler                                                       */
/* ------------------------------------------------------------------ */

interface LineBucket {
  width: number
  dashed: boolean
  opacity: number
  positions: number[]
  colors: number[]
}

/* ------------------------------------------------------------------ */
/* AnnotationLayer                                                     */
/* ------------------------------------------------------------------ */

export class AnnotationLayer {
  readonly group = new THREE.Group()

  private readonly materials = new Map<string, SketchLineMaterial>()
  private readonly textures = new Map<Id, THREE.Texture>()
  private readonly imageMaterials: THREE.Material[] = []
  private readonly loader = new THREE.TextureLoader()

  private buckets = new Map<string, LineBucket>()
  private labels: LabelCommand[] = []
  private screenLeaders: ScreenLeaderCommand[] = []

  private width = 1
  private height = 1
  private signature = ''
  private dirty = true

  /** Anzahl gezeichneter Annotationen des letzten Aufbaus (fuer Tests). */
  counts = { dimensions: 0, texts: 0, guideLines: 0, guidePoints: 0, images: 0 }

  constructor(private readonly onTextureLoad: () => void = () => undefined) {
    this.group.name = 'annotations'
    this.group.matrixAutoUpdate = false
  }

  invalidate(): void {
    this.dirty = true
  }

  setResolution(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    for (const material of this.materials.values()) material.resolution.set(this.width, this.height)
  }

  /** true, wenn die Textebene ueberhaupt etwas zu zeichnen hat. */
  get hasScreenContent(): boolean {
    return this.labels.length > 0 || this.screenLeaders.length > 0
  }

  /* ---------------------------------------------------------------- */
  /* Aufbau                                                           */
  /* ---------------------------------------------------------------- */

  update(snapshot: RenderSnapshot, sync: SceneSync): void {
    const signature = this.signatureOf(snapshot)
    if (!this.dirty && signature === this.signature) return
    this.dirty = false
    this.signature = signature

    this.reset()

    const doc = snapshot.doc
    if (!doc) return

    const units = doc.units ?? DEFAULT_UNITS
    // Ausdehnung "unendlicher" Hilfslinien: gross genug, um das Modell in jeder
    // Richtung zu ueberspannen, aber nicht so gross, dass die Tiefenaufloesung
    // leidet. Bewusst NICHT von der Kamera abhaengig - sonst muesste die Ebene
    // bei jeder Drehung neu gebaut werden.
    const diagonal = B.isEmpty(sync.modelBounds) ? 0 : B.diagonal(sync.modelBounds)
    const infiniteSpan = Math.max(diagonal * 4, 50)
    const markerSize = Math.max(diagonal * 0.01, 0.05)

    const selected = new Set<Id>(snapshot.selection?.entityIds ?? [])
    const hover = snapshot.hover
    const hovered = hover && hover.id && (hover.kind === 'entity' || hover.kind === 'guide') ? hover.id : null

    for (const record of sync.records) {
      const def = doc.definitions[record.definitionId]
      if (!def) continue
      for (const childId of def.children ?? []) {
        const entity = doc.entities?.[childId]
        if (!entity || entity.type === 'instance' || entity.type === 'sectionPlane') continue
        if (entity.hidden) continue
        if (!snapshot.isTagVisible(entity.tagId)) continue

        const ctx: BuildContext = {
          record,
          doc,
          units,
          opacity: record.dimmed ? DIM_OPACITY : 1,
          highlight: selected.has(entity.id) ? SELECT_COLOR : hovered === entity.id ? HOVER_COLOR : null,
          infiniteSpan,
          markerSize,
        }

        try {
          this.addEntity(entity, ctx, snapshot)
        } catch (err) {
          warnOnce(`annotations.${entity.type}`, err)
        }
      }
    }

    this.buildLineObjects()
  }

  private addEntity(entity: Entity, ctx: BuildContext, snapshot: RenderSnapshot): void {
    switch (entity.type) {
      case 'dimension':
        this.addDimension(entity, ctx)
        this.counts.dimensions++
        break
      case 'text':
        this.addText(entity, ctx)
        this.counts.texts++
        break
      case 'guideLine':
        if (snapshot.style.showGuides === false) return
        this.addGuideLine(entity, ctx)
        this.counts.guideLines++
        break
      case 'guidePoint':
        if (snapshot.style.showGuides === false) return
        this.addGuidePoint(entity, ctx)
        this.counts.guidePoints++
        break
      case 'image':
        // Wasserzeichen sind eine Bildschirmueberlagerung, kein Modellinhalt -
        // sie gehoeren nicht in den Szenengraph.
        if (entity.usage === 'watermark') return
        this.addImage(entity, ctx)
        this.counts.images++
        break
      default:
        break
    }
  }

  /* ---------------------------------------------------------------- */
  /* Bemassung                                                        */
  /* ---------------------------------------------------------------- */

  private addDimension(entity: DimensionEntity, ctx: BuildContext): void {
    const color = ctx.highlight ?? entity.color ?? '#333333'
    const start = this.toWorld(ctx.record, entity.start)
    const end = this.toWorld(ctx.record, entity.end)
    if (!V.isFinite3(start) || !V.isFinite3(end)) return

    if (entity.kind === 'angular') {
      this.addAngularDimension(entity, ctx, start, end, color)
      return
    }

    const offset = this.toWorldDirection(ctx.record, entity.offset ?? V.ORIGIN)
    const span = V.sub(end, start)
    const spanLength = V.length(span)
    if (spanLength < 1e-9) return

    const dir = V.mul(span, 1 / spanLength)
    // Versatzrichtung senkrecht zur Messstrecke - der Anteil laengs der Strecke
    // wuerde die Masslinie nur verschieben, nicht versetzen.
    const perpendicular = V.sub(offset, V.projectOnVector(offset, dir))
    const offsetLength = V.length(perpendicular)
    const away = offsetLength > 1e-9 ? V.mul(perpendicular, 1 / offsetLength) : V.normalizeOr(V.anyPerpendicular(dir), V.AXIS_Z)

    const lineStart = V.addScaled(start, away, offsetLength)
    const lineEnd = V.addScaled(end, away, offsetLength)

    const textHeight = this.worldTextHeight(entity, spanLength)
    const tick = Math.max(textHeight * 0.6, spanLength * 0.02)

    /* --- Masslinie --- */
    this.pushLine(lineStart, lineEnd, color, 2, false, ctx.opacity)

    /* --- Hilfslinien an den Messpunkten --- */
    if (offsetLength > 1e-9) {
      const gap = Math.min(tick * 0.4, offsetLength * 0.5)
      const overshoot = tick * 0.5
      this.pushLine(V.addScaled(start, away, gap), V.addScaled(lineStart, away, overshoot), color, 1.2, false, ctx.opacity)
      this.pushLine(V.addScaled(end, away, gap), V.addScaled(lineEnd, away, overshoot), color, 1.2, false, ctx.opacity)
    }

    /* --- Pfeile / Schraegstriche --- */
    this.pushArrow(lineStart, V.negate(dir), away, tick, entity.arrowStyle, color, ctx.opacity)
    this.pushArrow(lineEnd, dir, away, tick, entity.arrowStyle, color, ctx.opacity)

    /* --- Masstext --- */
    this.pushLabel(entity, ctx, V.midpoint(lineStart, lineEnd), away, dir, this.dimensionText(entity, ctx.units, spanLength))
  }

  private addAngularDimension(
    entity: DimensionEntity,
    ctx: BuildContext,
    start: Vec3Like,
    end: Vec3Like,
    color: string,
  ): void {
    const center = entity.center ? this.toWorld(ctx.record, entity.center) : null
    if (!center || !V.isFinite3(center)) return

    const armA = V.sub(start, center)
    const armB = V.sub(end, center)
    const lengthA = V.length(armA)
    const lengthB = V.length(armB)
    if (lengthA < 1e-9 || lengthB < 1e-9) return

    const u = V.mul(armA, 1 / lengthA)
    const other = V.mul(armB, 1 / lengthB)
    const normal = V.normalizeOr(V.cross(u, other), V.AXIS_Z)
    const v = V.normalizeOr(V.cross(normal, u), V.anyPerpendicular(u))
    const angle = V.angleBetween(armA, armB)
    if (!Number.isFinite(angle) || angle < 1e-9) return

    const radius = Math.min(lengthA, lengthB) * 0.75
    const textHeight = this.worldTextHeight(entity, radius)
    const tick = Math.max(textHeight * 0.6, radius * 0.05)

    /* --- Schenkel --- */
    this.pushLine(center, V.addScaled(center, u, lengthA), color, 1.2, false, ctx.opacity)
    this.pushLine(center, V.addScaled(center, other, lengthB), color, 1.2, false, ctx.opacity)

    /* --- Bogen --- */
    const segments = Math.max(8, Math.min(64, Math.round((angle / Math.PI) * 48)))
    let previous = pointOnArc(center, u, v, radius, 0)
    for (let i = 1; i <= segments; i++) {
      const point = pointOnArc(center, u, v, radius, (angle * i) / segments)
      this.pushLine(previous, point, color, 2, false, ctx.opacity)
      previous = point
    }

    /* --- Pfeile tangential an den Bogenenden --- */
    const startPoint = pointOnArc(center, u, v, radius, 0)
    const endPoint = previous
    const tangentStart = V.normalizeOr(V.cross(normal, V.sub(startPoint, center)), u)
    const tangentEnd = V.normalizeOr(V.cross(normal, V.sub(endPoint, center)), u)
    const radialStart = V.normalizeOr(V.sub(startPoint, center), v)
    const radialEnd = V.normalizeOr(V.sub(endPoint, center), v)
    this.pushArrow(startPoint, V.negate(tangentStart), radialStart, tick, entity.arrowStyle, color, ctx.opacity)
    this.pushArrow(endPoint, tangentEnd, radialEnd, tick, entity.arrowStyle, color, ctx.opacity)

    /* --- Text auf der Winkelhalbierenden --- */
    const middle = pointOnArc(center, u, v, radius, angle / 2)
    const outward = V.normalizeOr(V.sub(middle, center), v)
    this.pushLabel(entity, ctx, middle, outward, V.normalizeOr(V.cross(normal, outward), u), this.angleText(entity, ctx.units, angle))
  }

  /**
   * Der gemessene Wert. `text` der Entitaet gewinnt, wenn gesetzt - so kann der
   * Nutzer "ca. 4 m" oder eine Bauteilnummer eintragen.
   *
   * AUSLEGUNG der Punkte je Art (der Contract sagt dazu nichts):
   *   linear   `start`/`end` sind die Messpunkte
   *   radius   `start` ist der Mittelpunkt, `end` liegt auf dem Kreis
   *   diameter wie radius, angezeigt wird der doppelte Wert
   */
  private dimensionText(entity: DimensionEntity, units: UnitSettings, spanLength: number): string {
    const override = typeof entity.text === 'string' ? entity.text.trim() : ''
    if (override.length > 0) return override
    if (entity.kind === 'radius') return `R ${formatLength(spanLength, units)}`
    if (entity.kind === 'diameter') return `⌀ ${formatLength(spanLength * 2, units)}`
    return formatLength(spanLength, units)
  }

  private angleText(entity: DimensionEntity, units: UnitSettings, radians: number): string {
    const override = typeof entity.text === 'string' ? entity.text.trim() : ''
    if (override.length > 0) return override
    return formatAngle(radians, units)
  }

  /* ---------------------------------------------------------------- */
  /* Text                                                             */
  /* ---------------------------------------------------------------- */

  private addText(entity: TextEntity, ctx: BuildContext): void {
    const color = ctx.highlight ?? entity.color ?? '#333333'
    const position = this.toWorld(ctx.record, entity.position)
    const anchor = this.toWorld(ctx.record, entity.anchor)
    if (!V.isFinite3(position)) return

    const content = typeof entity.text === 'string' ? entity.text : ''
    if (content.length === 0 && entity.leader === 'none') return

    if (entity.leader !== 'none' && V.isFinite3(anchor) && V.distance(anchor, position) > 1e-9) {
      if (entity.leader === 'pushPin') {
        // Am Ankerpunkt festgenagelt: die Fuehrungslinie lebt im Weltraum,
        // dreht sich also mit dem Modell und wird von Geometrie verdeckt.
        this.pushLine(anchor, position, color, 1.5, false, ctx.opacity)
        this.pushCross(anchor, ctx.markerSize * 0.6, color, 1.2, ctx.opacity)
      } else {
        // Ansichtsbezogen: die Linie wird auf der Textebene gezogen, liegt also
        // immer obenauf und dreht mit der Kamera.
        this.screenLeaders.push({ from: anchor, to: position, color, opacity: ctx.opacity })
      }
    }

    if (content.length === 0) return

    // Ohne eigene Ebene im Contract liegt Modelltext in der XY-Ebene seines
    // Kontexts - dieselbe Ebene, in der der Nutzer ihn abgesetzt hat.
    const u = V.normalizeOr(this.toWorldDirection(ctx.record, V.AXIS_X), V.AXIS_X)
    const v = V.normalizeOr(this.toWorldDirection(ctx.record, V.AXIS_Y), V.AXIS_Y)

    this.labels.push({
      text: content,
      anchor: position,
      away: null,
      color,
      size: this.fontSize(entity),
      screenSpace: entity.screenSpace !== false,
      u,
      v,
      opacity: ctx.opacity,
      background: null,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Hilfslinien und Hilfspunkte                                      */
  /* ---------------------------------------------------------------- */

  private addGuideLine(entity: GuideLineEntity, ctx: BuildContext): void {
    const origin = this.toWorld(ctx.record, entity.origin)
    const direction = V.normalizeOr(this.toWorldDirection(ctx.record, entity.direction), V.AXIS_X)
    if (!V.isFinite3(origin) || V.isZero(direction)) return

    const finite = typeof entity.length === 'number' && Number.isFinite(entity.length) && entity.length > 0
    const color = ctx.highlight ?? axisColor(direction)
    const a = finite ? origin : V.addScaled(origin, direction, -ctx.infiniteSpan)
    const b = finite ? V.addScaled(origin, direction, entity.length as number) : V.addScaled(origin, direction, ctx.infiniteSpan)
    this.pushLine(a, b, color, 1.2, true, ctx.opacity)
  }

  private addGuidePoint(entity: GuidePointEntity, ctx: BuildContext): void {
    const position = this.toWorld(ctx.record, entity.position)
    if (!V.isFinite3(position)) return
    const color = ctx.highlight ?? GUIDE_COLOR
    this.pushCross(position, ctx.markerSize, color, 1.4, ctx.opacity)

    if (entity.from) {
      const from = this.toWorld(ctx.record, entity.from)
      if (V.isFinite3(from) && V.distance(from, position) > 1e-9) {
        this.pushLine(from, position, color, 1.2, true, ctx.opacity)
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Bilder                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Bildrechteck. AUSLEGUNG: das Bild spannt in seinem eigenen Raum von
   * (0,0,0) bis (width, height, 0) auf, `transform` setzt es in den Kontext.
   */
  private addImage(entity: ImageEntity, ctx: BuildContext): void {
    const width = Number.isFinite(entity.width) && entity.width > 0 ? entity.width : 1
    const height = Number.isFinite(entity.height) && entity.height > 0 ? entity.height : 1
    const local = Array.isArray(entity.transform) && entity.transform.length === 16 ? entity.transform : M.identity()
    const world = M.multiply(ctx.record.worldTransform, local)

    const corners = [
      M.transformPoint(world, { x: 0, y: 0, z: 0 }),
      M.transformPoint(world, { x: width, y: 0, z: 0 }),
      M.transformPoint(world, { x: width, y: height, z: 0 }),
      M.transformPoint(world, { x: 0, y: height, z: 0 }),
    ]
    if (!corners.every(V.isFinite3)) return

    const positions: number[] = []
    const uvs: number[] = []
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const corner = corners[index]
      positions.push(corner.x, corner.y, corner.z)
      const uv = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ][index]
      uvs.push(uv[0], uv[1])
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: ctx.opacity < 0.999,
      opacity: ctx.opacity,
      depthWrite: ctx.opacity > 0.999,
    })
    const texture = this.texture(ctx.doc, entity.textureId)
    if (texture) material.map = texture
    else material.color.set(0xcfcfcf)
    this.imageMaterials.push(material)

    const mesh = new THREE.Mesh(geometry, material)
    mesh.matrixAutoUpdate = false
    mesh.renderOrder = 2
    mesh.frustumCulled = false
    mesh.userData.ownGeometry = true
    mesh.userData.entityId = entity.id
    this.group.add(mesh)

    // Rahmen: unmaterialisierte Bilder waeren sonst unsichtbar, ausgewaehlte
    // brauchen ohnehin eine blaue Umrandung.
    const frameColor = ctx.highlight ?? '#9aa4b2'
    for (let i = 0; i < 4; i++) {
      this.pushLine(corners[i], corners[(i + 1) % 4], frameColor, ctx.highlight ? 2.5 : 1, false, ctx.opacity)
    }
  }

  private texture(doc: SketchDocument, textureId: Id): THREE.Texture | null {
    const record = doc.textures?.[textureId]
    if (!record || typeof record.dataUrl !== 'string' || record.dataUrl.length === 0) return null
    const existing = this.textures.get(textureId)
    if (existing) return existing
    const texture = this.loader.load(
      record.dataUrl,
      () => this.onTextureLoad(),
      undefined,
      (err) => warnOnce(`annotations.texture(${textureId})`, err),
    )
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    this.textures.set(textureId, texture)
    return texture
  }

  /* ---------------------------------------------------------------- */
  /* Linienbausteine                                                  */
  /* ---------------------------------------------------------------- */

  private pushLine(a: Vec3Like, b: Vec3Like, color: string, width: number, dashed: boolean, opacity: number): void {
    if (!V.isFinite3(a) || !V.isFinite3(b)) return
    const bucket = this.bucketFor(width, dashed, opacity)
    const c = parseColor(color, '#333333')
    bucket.positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    bucket.colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
  }

  /** Kreuzmarker aus drei achsenparallelen Strichen. */
  private pushCross(center: Vec3Like, size: number, color: string, width: number, opacity: number): void {
    const half = Math.max(size, 1e-6) / 2
    for (const axis of [V.AXIS_X, V.AXIS_Y, V.AXIS_Z]) {
      this.pushLine(V.addScaled(center, axis, -half), V.addScaled(center, axis, half), color, width, false, opacity)
    }
  }

  /**
   * Pfeil bzw. Schraegstrich am Ende einer Masslinie.
   * `dir` zeigt nach AUSSEN, `side` liegt in der Massebene quer dazu.
   */
  private pushArrow(
    tip: Vec3Like,
    dir: Vec3Like,
    side: Vec3Like,
    size: number,
    style: DimensionEntity['arrowStyle'],
    color: string,
    opacity: number,
  ): void {
    if (style === 'none' || size <= 0) return

    if (style === 'slash') {
      const diagonal = V.normalizeOr(V.add(dir, side), side)
      this.pushLine(V.addScaled(tip, diagonal, -size * 0.5), V.addScaled(tip, diagonal, size * 0.5), color, 2, false, opacity)
      return
    }

    if (style === 'dot') {
      const segments = 8
      let previous = V.addScaled(tip, side, size * 0.25)
      for (let i = 1; i <= segments; i++) {
        const angle = (Math.PI * 2 * i) / segments
        const point = V.add(
          tip,
          V.add(V.mul(side, Math.cos(angle) * size * 0.25), V.mul(dir, Math.sin(angle) * size * 0.25)),
        )
        this.pushLine(previous, point, color, 2, false, opacity)
        previous = point
      }
      return
    }

    const back = V.addScaled(tip, dir, -size)
    const wing = size * 0.32
    const left = V.addScaled(back, side, wing)
    const right = V.addScaled(back, side, -wing)
    this.pushLine(tip, left, color, 1.6, false, opacity)
    this.pushLine(tip, right, color, 1.6, false, opacity)
    if (style === 'closedArrow') this.pushLine(left, right, color, 1.6, false, opacity)
  }

  private bucketFor(width: number, dashed: boolean, opacity: number): LineBucket {
    const w = Math.round(Math.max(0.5, width) * 10) / 10
    const o = Math.round(clamp(opacity, 0.05, 1) * 20) / 20
    const key = `${w}|${dashed ? 1 : 0}|${o}`
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { width: w, dashed, opacity: o, positions: [], colors: [] }
      this.buckets.set(key, bucket)
    }
    return bucket
  }

  private buildLineObjects(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.positions.length < 6) continue
      const geometry = new LineSegmentsGeometry()
      geometry.setPositions(bucket.positions)
      geometry.setColors(bucket.colors)
      const line = new LineSegments2(geometry, this.materialFor(bucket))
      if (bucket.dashed) line.computeLineDistances()
      line.renderOrder = 7
      line.frustumCulled = false
      line.userData.ownGeometry = true
      this.group.add(line)
    }
  }

  private materialFor(bucket: LineBucket): SketchLineMaterial {
    const key = `${bucket.width}|${bucket.dashed ? 1 : 0}|${bucket.opacity}`
    let material = this.materials.get(key)
    if (!material) {
      material = new SketchLineMaterial({
        // Weiss, weil die Farbe pro Segment aus dem Vertexattribut kommt.
        color: 0xffffff,
        linewidth: bucket.width,
        dashed: bucket.dashed,
        dashSize: 0.12,
        gapSize: 0.08,
        vertexColors: true,
        transparent: bucket.opacity < 0.999,
        opacity: bucket.opacity,
        depthTest: true,
        depthWrite: false,
      })
      material.resolution.set(this.width, this.height)
      this.materials.set(key, material)
    }
    return material
  }

  /* ---------------------------------------------------------------- */
  /* Textbefehle                                                      */
  /* ---------------------------------------------------------------- */

  private pushLabel(
    entity: DimensionEntity,
    ctx: BuildContext,
    anchor: Vec3Like,
    away: Vec3Like,
    along: Vec3Like,
    text: string,
  ): void {
    if (text.length === 0) return
    this.labels.push({
      text,
      anchor,
      away,
      color: ctx.highlight ?? entity.color ?? '#333333',
      size: this.fontSize(entity),
      screenSpace: entity.screenSpace !== false,
      // In der Massebene liest sich der Text laengs der Masslinie.
      u: along,
      v: away,
      opacity: ctx.opacity,
      background: null,
    })
  }

  /** `fontSize` der Entitaet, mit brauchbarem Ersatzwert je Betriebsart. */
  private fontSize(entity: DimensionEntity | TextEntity): number {
    const screenSpace = entity.screenSpace !== false
    const fallback = screenSpace ? FALLBACK_SCREEN_FONT_PX : FALLBACK_PLANE_FONT_M
    const value = entity.fontSize
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
    return value
  }

  /** Texthoehe in Metern - fuer Pfeilgroessen, auch bei Bildschirmtext. */
  private worldTextHeight(entity: DimensionEntity, reference: number): number {
    if (entity.screenSpace !== false) return Math.max(reference * 0.05, 1e-4)
    return Math.max(this.fontSize(entity), 1e-4)
  }

  /* ---------------------------------------------------------------- */
  /* Textebene zeichnen                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Zeichnet Fuehrungslinien und Text in einen 2D-Kontext. `host` liefert die
   * Projektion - im Viewport die Bildschirmkamera, in `captureImage` dieselbe
   * Kamera auf Bildgroesse gestellt.
   */
  draw2d(ctx: CanvasRenderingContext2D, host: AnnotationHost): void {
    if (!this.hasScreenContent) return
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (const leader of this.screenLeaders) this.drawLeader(ctx, host, leader)
    for (const label of this.labels) this.drawLabel(ctx, host, label)

    ctx.globalAlpha = 1
    ctx.restore()
  }

  private drawLeader(ctx: CanvasRenderingContext2D, host: AnnotationHost, leader: ScreenLeaderCommand): void {
    const from = host.worldToScreen(leader.from)
    const to = host.worldToScreen(leader.to)
    if (!onScreen(from) || !onScreen(to)) return
    ctx.globalAlpha = leader.opacity
    ctx.strokeStyle = leader.color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    // Punkt am Ankerpunkt, damit klar ist, worauf der Text zeigt
    ctx.fillStyle = leader.color
    ctx.beginPath()
    ctx.arc(from.x, from.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  private drawLabel(ctx: CanvasRenderingContext2D, host: AnnotationHost, label: LabelCommand): void {
    const screen = host.worldToScreen(label.anchor)
    if (!onScreen(screen)) return

    ctx.globalAlpha = label.opacity
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (label.screenSpace) {
      this.drawScreenLabel(ctx, host, label, screen)
    } else {
      this.drawPlaneLabel(ctx, host, label, screen)
    }
    ctx.globalAlpha = 1
  }

  private drawScreenLabel(
    ctx: CanvasRenderingContext2D,
    host: AnnotationHost,
    label: LabelCommand,
    screen: { x: number; y: number },
  ): void {
    let x = screen.x
    let y = screen.y

    // Vom Bezugspunkt wegschieben, damit der Text nicht auf der Masslinie liegt.
    if (label.away) {
      const shifted = host.worldToScreen(V.addScaled(label.anchor, label.away, referenceStep(host, label.anchor)))
      const dx = shifted.x - screen.x
      const dy = shifted.y - screen.y
      const length = Math.hypot(dx, dy)
      if (length > 1e-6) {
        const push = label.size * 0.85
        x += (dx / length) * push
        y += (dy / length) * push
      } else {
        y -= label.size * 0.85
      }
    }

    ctx.font = `${label.size}px ${FONT_STACK}`
    this.paintText(ctx, label, x, y)
  }

  private drawPlaneLabel(
    ctx: CanvasRenderingContext2D,
    host: AnnotationHost,
    label: LabelCommand,
    screen: { x: number; y: number },
  ): void {
    // Beide Ebenenachsen projizieren: daraus entsteht die affine Abbildung, die
    // den Text in die Ebene legt.
    const step = Math.max(label.size, 1e-6)
    const alongU = host.worldToScreen(V.addScaled(label.anchor, label.u, step))
    const alongV = host.worldToScreen(V.addScaled(label.anchor, label.v, step))
    if (!Number.isFinite(alongU.x) || !Number.isFinite(alongV.x)) return

    let ax = (alongU.x - screen.x) / PLANE_FONT_PX
    let ay = (alongU.y - screen.y) / PLANE_FONT_PX
    // Die Ebenenachse `v` zeigt nach oben, die Leinwandachse nach unten.
    const cx = -(alongV.x - screen.x) / PLANE_FONT_PX
    const cy = -(alongV.y - screen.y) / PLANE_FONT_PX

    const scale = Math.hypot(ax, ay) * PLANE_FONT_PX
    if (!Number.isFinite(scale) || scale < MIN_PLANE_TEXT_PX || scale > MAX_PLANE_TEXT_PX) return

    // Von hinten betrachtet stuende der Text spiegelverkehrt - dann die
    // Leserichtung umdrehen, wie bei einer beidseitig lesbaren Bemassung.
    if (ax * cy - ay * cx < 0) {
      ax = -ax
      ay = -ay
    }

    ctx.save()
    ctx.transform(ax, ay, cx, cy, screen.x, screen.y)
    ctx.font = `${PLANE_FONT_PX}px ${FONT_STACK}`
    this.paintText(ctx, label, 0, 0, PLANE_FONT_PX)
    ctx.restore()
  }

  private paintText(
    ctx: CanvasRenderingContext2D,
    label: LabelCommand,
    x: number,
    y: number,
    height = label.size,
  ): void {
    if (label.background) {
      const metrics = ctx.measureText(label.text)
      const padX = height * 0.35
      const padY = height * 0.25
      ctx.fillStyle = label.background
      ctx.fillRect(x - metrics.width / 2 - padX, y - height / 2 - padY, metrics.width + padX * 2, height + padY * 2)
    }
    ctx.fillStyle = label.color
    ctx.fillText(label.text, x, y)
  }

  /* ---------------------------------------------------------------- */
  /* Hilfen                                                           */
  /* ---------------------------------------------------------------- */

  private toWorld(record: InstanceRecord, p: Vec3Like): Vec3Like {
    if (!p || typeof p.x !== 'number') return { x: NaN, y: NaN, z: NaN }
    return M.transformPoint(record.worldTransform, p)
  }

  private toWorldDirection(record: InstanceRecord, d: Vec3Like): Vec3Like {
    if (!d || typeof d.x !== 'number') return V.AXIS_X
    return M.transformDirection(record.worldTransform, d)
  }

  private signatureOf(snapshot: RenderSnapshot): string {
    const style = snapshot.style
    const doc = snapshot.doc
    const hidden: string[] = []
    if (doc?.tags) {
      for (const id of Object.keys(doc.tags)) if (!snapshot.isTagVisible(id)) hidden.push(id)
      hidden.sort()
    }
    const units = doc?.units
    return [
      snapshot.revisions.scene,
      snapshot.revisions.geometry,
      snapshot.revisions.style,
      snapshot.revisions.material,
      snapshot.revisions.selection,
      style.showGuides === false ? 0 : 1,
      snapshot.context?.instancePath.join('>') ?? '',
      snapshot.hover ? `${snapshot.hover.kind}:${snapshot.hover.id ?? '-'}` : '-',
      units ? `${units.format}:${units.lengthUnit}:${units.angleUnit}:${units.precision}:${units.displayUnitSuffix ? 1 : 0}` : '-',
      hidden.join(','),
    ].join('|')
  }

  private reset(): void {
    clearGroup(this.group, { geometries: true })
    for (const material of this.imageMaterials) material.dispose()
    this.imageMaterials.length = 0
    this.buckets.clear()
    this.labels = []
    this.screenLeaders = []
    this.counts = { dimensions: 0, texts: 0, guideLines: 0, guidePoints: 0, images: 0 }
  }

  dispose(): void {
    this.reset()
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
    for (const texture of this.textures.values()) texture.dispose()
    this.textures.clear()
    this.group.removeFromParent()
  }
}

/* ------------------------------------------------------------------ */
/* Baukontext                                                          */
/* ------------------------------------------------------------------ */

interface BuildContext {
  record: InstanceRecord
  doc: SketchDocument
  units: UnitSettings
  opacity: number
  /** Auswahl- oder Hoverfarbe, sonst null */
  highlight: string | null
  infiniteSpan: number
  markerSize: number
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function onScreen(screen: { x: number; y: number; depth: number }): boolean {
  return Number.isFinite(screen.x) && Number.isFinite(screen.y) && screen.depth >= -1 && screen.depth <= 1
}

/**
 * Weltlaenge, die auf dem Bildschirm gut messbar ist. Wird nur benutzt, um eine
 * RICHTUNG zu projizieren - der Betrag darf grosszuegig sein, muss aber gegen
 * die Rundung der Projektion bestehen.
 */
function referenceStep(host: AnnotationHost, at: Vec3Like): number {
  const ppu = host.pixelsPerUnit(at)
  if (!Number.isFinite(ppu) || ppu <= 1e-9) return 0.1
  return 20 / ppu
}

function pointOnArc(center: Vec3Like, u: Vec3Like, v: Vec3Like, radius: number, angle: number): Vec3Like {
  const cos = Math.cos(angle) * radius
  const sin = Math.sin(angle) * radius
  return {
    x: center.x + u.x * cos + v.x * sin,
    y: center.y + u.y * cos + v.y * sin,
    z: center.z + u.z * cos + v.z * sin,
  }
}

/**
 * Achsenfarbe einer Richtung - echte Achsenparallelitaet wird belohnt, alles
 * andere bleibt gedaempft grau. Genau wie SketchUp seine Hilfslinien faerbt.
 */
export function axisColor(direction: Vec3Like): string {
  const d = V.normalizeOr(direction, V.AXIS_X)
  if (Math.abs(Math.abs(d.x) - 1) < 1e-6) return AXIS_X_COLOR
  if (Math.abs(Math.abs(d.y) - 1) < 1e-6) return AXIS_Y_COLOR
  if (Math.abs(Math.abs(d.z) - 1) < 1e-6) return AXIS_Z_COLOR
  return GUIDE_COLOR
}
