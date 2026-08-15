/**
 * Kantendarstellung - der visuelle Fingerabdruck von SketchUp.
 *
 * Kanten werden in vier Klassen einsortiert:
 *
 *  | Klasse    | Bedingung                          | Darstellung                |
 *  |-----------|------------------------------------|----------------------------|
 *  | `guide`   | `edge.guide === true`              | gepunktet, gedaempft       |
 *  | `hidden`  | `soft` oder `hidden`               | nur bei `showHiddenGeometry`, gestrichelt |
 *  | `profile` | weniger als zwei Nachbarflaechen   | dicke Silhouettenlinie     |
 *  | `normal`  | sonst                              | duenne Linie               |
 *
 * Gezeichnet wird mit `LineSegments2` / `LineMaterial`, damit die Breite in
 * echten Bildschirmpixeln angegeben werden kann. Verlaengerung, Jitter und
 * Tiefenhinweis stecken im gepatchten Shader (`lineMaterial.ts`).
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { Edge, Geometry, Id, SketchDocument, StyleSettings, Vec3Like } from '@/shared/types'
import { SketchLineMaterial } from './lineMaterial'
import { colorRgb, parseColor } from './util'

export type EdgeClass = 'normal' | 'profile' | 'hidden' | 'guide'

export const EDGE_CLASSES: readonly EdgeClass[] = ['normal', 'profile', 'hidden', 'guide']

/** Rohdaten einer Kantenklasse einer Definition. */
export interface EdgeBucket {
  /** 6 Werte pro Segment (Start xyz, Ende xyz) */
  positions: Float32Array
  segments: number
  edgeIds: Id[]
  materialIds: (Id | null)[]
  tagIds: (Id | null)[]
}

export interface EdgeExtraction {
  buckets: Record<EdgeClass, EdgeBucket>
  /** eindeutige Endpunkte aller gezeichneten Kanten */
  endpoints: Float32Array
  endpointCount: number
  total: number
}

function emptyBucket(): EdgeBucket {
  return { positions: new Float32Array(0), segments: 0, edgeIds: [], materialIds: [], tagIds: [] }
}

export function emptyExtraction(): EdgeExtraction {
  return {
    buckets: {
      normal: emptyBucket(),
      profile: emptyBucket(),
      hidden: emptyBucket(),
      guide: emptyBucket(),
    },
    endpoints: new Float32Array(0),
    endpointCount: 0,
    total: 0,
  }
}

export function classifyEdge(edge: Edge): EdgeClass {
  if (edge.guide === true) return 'guide'
  if (edge.hidden || edge.soft) return 'hidden'
  return (edge.faces?.length ?? 0) < 2 ? 'profile' : 'normal'
}

interface BucketBuilder {
  positions: number[]
  edgeIds: Id[]
  materialIds: (Id | null)[]
  tagIds: (Id | null)[]
}

function newBuilder(): BucketBuilder {
  return { positions: [], edgeIds: [], materialIds: [], tagIds: [] }
}

function finish(b: BucketBuilder): EdgeBucket {
  return {
    positions: new Float32Array(b.positions),
    segments: b.edgeIds.length,
    edgeIds: b.edgeIds,
    materialIds: b.materialIds,
    tagIds: b.tagIds,
  }
}

export interface EdgeExtractOptions {
  /** Tags, deren Geometrie unsichtbar ist */
  isTagVisible: (tagId: Id | null) => boolean
  /** versteckte/weiche Geometrie zusaetzlich anzeigen */
  showHiddenGeometry: boolean
  /** Endpunktliste mit aufbauen (kostet Speicher, nur wenn `displayEndpoints`) */
  collectEndpoints: boolean
}

/**
 * Liest alle Kanten einer Geometrie aus und sortiert sie in die vier Klassen.
 * Reine Datenextraktion, keine three.js-Objekte.
 */
export function extractEdges(geom: Geometry, opts: EdgeExtractOptions): EdgeExtraction {
  const builders: Record<EdgeClass, BucketBuilder> = {
    normal: newBuilder(),
    profile: newBuilder(),
    hidden: newBuilder(),
    guide: newBuilder(),
  }
  const endpointKeys = new Set<string>()
  const endpoints: number[] = []
  let total = 0

  const vertices = geom.vertices
  for (const edgeId of Object.keys(geom.edges)) {
    const edge = geom.edges[edgeId]
    if (!edge) continue
    const cls = classifyEdge(edge)
    if (cls === 'hidden' && !opts.showHiddenGeometry) continue
    if (!opts.isTagVisible(edge.tagId)) continue

    const a = vertices[edge.a]
    const b = vertices[edge.b]
    if (!a || !b) continue

    const builder = builders[cls]
    builder.positions.push(a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z)
    builder.edgeIds.push(edge.id)
    builder.materialIds.push(edge.materialId ?? null)
    builder.tagIds.push(edge.tagId ?? null)
    total++

    if (opts.collectEndpoints && cls !== 'guide') {
      pushEndpoint(endpointKeys, endpoints, edge.a, a.p)
      pushEndpoint(endpointKeys, endpoints, edge.b, b.p)
    }
  }

  return {
    buckets: {
      normal: finish(builders.normal),
      profile: finish(builders.profile),
      hidden: finish(builders.hidden),
      guide: finish(builders.guide),
    },
    endpoints: new Float32Array(endpoints),
    endpointCount: endpoints.length / 3,
    total,
  }
}

function pushEndpoint(seen: Set<string>, out: number[], id: Id, p: Vec3Like): void {
  if (seen.has(id)) return
  seen.add(id)
  out.push(p.x, p.y, p.z)
}

/* ------------------------------------------------------------------ */
/* Farben nach Material / Tag                                          */
/* ------------------------------------------------------------------ */

/**
 * Farbwerte pro Segment (6 Floats: rgb am Start, rgb am Ende).
 * Liefert null, wenn der Stil eine einheitliche Farbe verwendet.
 */
export function edgeColors(
  bucket: EdgeBucket,
  style: StyleSettings,
  doc: SketchDocument | null,
): Float32Array | null {
  if (style.edgeColorMode === 'all' || bucket.segments === 0) return null
  const out = new Float32Array(bucket.segments * 6)
  const fallback = colorRgb(style.edgeColor, '#2b2b2b')
  for (let i = 0; i < bucket.segments; i++) {
    let rgb = fallback
    if (style.edgeColorMode === 'byMaterial') {
      const mat = doc && bucket.materialIds[i] ? doc.materials[bucket.materialIds[i] as Id] : undefined
      if (mat) rgb = colorRgb(mat.color, style.edgeColor)
    } else {
      const tag = doc && bucket.tagIds[i] ? doc.tags[bucket.tagIds[i] as Id] : undefined
      if (tag) rgb = colorRgb(tag.color, style.edgeColor)
    }
    const o = i * 6
    out[o] = rgb[0]
    out[o + 1] = rgb[1]
    out[o + 2] = rgb[2]
    out[o + 3] = rgb[0]
    out[o + 4] = rgb[1]
    out[o + 5] = rgb[2]
  }
  return out
}

/* ------------------------------------------------------------------ */
/* three.js-Objekte                                                    */
/* ------------------------------------------------------------------ */

/** Baut eine `LineSegmentsGeometry` aus einem Bucket (null bei leerem Bucket). */
export function buildLineGeometry(bucket: EdgeBucket, colors: Float32Array | null): LineSegmentsGeometry | null {
  if (bucket.segments === 0) return null
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(bucket.positions)
  if (colors) geometry.setColors(colors)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Baut eine `LineSegmentsGeometry` direkt aus einer Positionsliste. */
export function lineGeometryFromPositions(positions: Float32Array | number[]): LineSegmentsGeometry | null {
  const length = positions.length
  if (length < 6) return null
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(positions instanceof Float32Array ? positions : new Float32Array(positions))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Materialsatz fuer die vier Kantenklassen plus die Jitter-Zweitlinie.
 * Wird einmal erzeugt und bei jedem Stilwechsel neu konfiguriert.
 */
export class EdgeMaterials {
  readonly normal: SketchLineMaterial
  readonly profile: SketchLineMaterial
  readonly hidden: SketchLineMaterial
  readonly guide: SketchLineMaterial
  readonly jitter: SketchLineMaterial
  readonly endpointMaterial: THREE.PointsMaterial

  private vertexColored = false

  constructor() {
    this.normal = new SketchLineMaterial({ linewidth: 1 })
    this.profile = new SketchLineMaterial({ linewidth: 2 })
    this.hidden = new SketchLineMaterial({ linewidth: 1, dashed: true, transparent: true, opacity: 0.75 })
    this.guide = new SketchLineMaterial({ linewidth: 1, dashed: true, transparent: true, opacity: 0.6 })
    this.jitter = new SketchLineMaterial({ linewidth: 1, transparent: true, opacity: 0.45 })
    this.endpointMaterial = createEndpointMaterial()
  }

  all(): SketchLineMaterial[] {
    return [this.normal, this.profile, this.hidden, this.guide, this.jitter]
  }

  materialFor(cls: EdgeClass, style: StyleSettings): SketchLineMaterial {
    switch (cls) {
      case 'guide':
        return this.guide
      case 'hidden':
        return this.hidden
      case 'profile':
        return style.displayProfiles ? this.profile : this.normal
      default:
        return this.normal
    }
  }

  /** true, wenn die Geometrien Farbattribute mitliefern muessen. */
  get usesVertexColors(): boolean {
    return this.vertexColored
  }

  /**
   * Uebernimmt den Stil.
   * `worldScale` ist eine typische Modelldistanz (Kameraabstand) und steuert die
   * Strichlaenge der gestrichelten Klassen; `near`/`far` steuern den Tiefenhinweis.
   */
  apply(style: StyleSettings, worldScale: number, near: number, far: number): void {
    const base = parseColor(style.edgeColor, '#2b2b2b')
    const useVertexColors = style.edgeColorMode !== 'all'
    if (useVertexColors !== this.vertexColored) {
      this.vertexColored = useVertexColors
      for (const m of this.all()) {
        m.vertexColors = useVertexColors
        m.needsUpdate = true
      }
    }

    const profileWidth = Math.max(0.5, style.displayProfiles ? style.profileWidth : 1)
    const extension = style.displayExtensions ? Math.max(0, style.extensionLength) : 0
    const jitterAmount = style.jitterEdges ? 1.4 : 0
    const depthCue = style.displayDepthCue ? clamp01((style.depthCueWidth - 1) / 6, 0.45) : 0

    const dash = Math.max(worldScale * 0.012, 1e-4)

    for (const m of this.all()) {
      m.color.copy(base)
      m.setExtension(extension)
      m.setDepthCue(depthCue, near, far)
      m.setJitter(0)
    }

    this.normal.linewidth = 1
    this.profile.linewidth = profileWidth
    this.hidden.linewidth = 1
    this.hidden.dashSize = dash
    this.hidden.gapSize = dash * 0.8
    this.guide.linewidth = 1
    this.guide.color.copy(parseColor('#6b7280'))
    this.guide.dashSize = dash * 0.35
    this.guide.gapSize = dash * 0.7

    this.jitter.linewidth = Math.max(1, profileWidth * 0.6)
    this.jitter.setJitter(jitterAmount)
    this.jitter.visible = jitterAmount > 0

    this.endpointMaterial.color.copy(base)
    this.endpointMaterial.size = Math.max(1, style.endpointSize)
  }

  setResolution(width: number, height: number): void {
    for (const m of this.all()) m.resolution.set(Math.max(1, width), Math.max(1, height))
  }

  dispose(): void {
    for (const m of this.all()) m.dispose()
    this.endpointMaterial.dispose()
  }
}

function clamp01(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/* ------------------------------------------------------------------ */
/* Endpunkte                                                           */
/* ------------------------------------------------------------------ */

/** Dicke Punkte an den Kantenenden (`displayEndpoints`). */
export function buildEndpoints(positions: Float32Array, material: THREE.PointsMaterial): THREE.Points | null {
  if (positions.length < 3) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = true
  return points
}

export function createEndpointMaterial(): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    color: 0x2b2b2b,
    size: 4,
    sizeAttenuation: false,
    transparent: true,
  })
}

/** Hilfsobjekt: `LineSegments2` mit sinnvollen Voreinstellungen. */
export function createLineObject(
  geometry: LineSegmentsGeometry,
  material: SketchLineMaterial,
  dashed: boolean,
): LineSegments2 {
  const line = new LineSegments2(geometry, material)
  if (dashed) line.computeLineDistances()
  line.frustumCulled = true
  line.renderOrder = 2
  return line
}
