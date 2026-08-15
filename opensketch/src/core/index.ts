/**
 * PUBLIC API DES GEOMETRIEKERNS.
 *
 * Diese Signaturen sind ein vom Lead festgelegter Contract. Der Kernel-
 * Entwickler implementiert sie (Bodies ersetzen, Signaturen NICHT aendern) und
 * verteilt die Implementierung auf `core/topology`, `core/ops`, `core/query`.
 *
 * Grundregeln:
 *  - Alle Operationen arbeiten auf EINEM `Geometry`-Topf (= ein Kontext).
 *  - Operationen mutieren `geom` IN PLACE und liefern ein `GeometryChange`
 *    zurueck, damit Renderer und Undo wissen, was passiert ist.
 *  - Automatisches Verschmelzen: Vertices naeher als POINT_TOL werden
 *    zusammengefuehrt, sich kreuzende Kanten werden geteilt, geschlossene
 *    planare Schleifen erzeugen automatisch eine Flaeche.
 *
 * Diese Datei ist reine Fassade: sie enthaelt keine Geometrie-Logik, sondern
 * bindet die Untermodule an den Contract und kuemmert sich um die
 * Cache-Invalidierung nach jeder Aenderung.
 */

import type {
  BBox3Like,
  Geometry,
  Id,
  Mat4Like,
  PlaneLike,
  Vec3Like,
} from '@/shared/types'
import type { GeometryChange } from '@/shared/store-api'
import type { Ray } from '@/core/math'

import {
  addEdgeMut,
  addFacePolygonMut,
  addPolylineMut,
  cleanupMut,
  cloneGeometryDeep,
  deletePrimitivesMut,
  finishAcc,
  mergeCoplanarFacesMut,
  mergeGeometryMut,
  moveVerticesMut,
  newAcc,
  orientFacesConsistentlyMut,
  reverseFacesMut,
  softenEdgesMut,
  transformGeometryCopy,
  transformPrimitivesMut,
  type ChangeAcc,
} from '@/core/topology'
import {
  boundingEdges as boundingEdgesQuery,
  findConnected as findConnectedQuery,
  findCoplanarFaces,
  orderEdgePath as orderEdgePathQuery,
} from '@/core/topology/connect'
import {
  edgeLength as edgeLengthQuery,
  edgePoints as edgePointsQuery,
  faceArea as faceAreaQuery,
  faceHoleVertices as faceHoleVerticesQuery,
  facePlane as facePlaneQuery,
  faceVertices as faceVerticesQuery,
  geometryBounds as geometryBoundsQuery,
  invalidateFaceCache,
  invalidateSpatialIndex,
  isSolid as isSolidQuery,
  raycast as raycastQuery,
  solidVolume as solidVolumeQuery,
  totalArea as totalAreaQuery,
  triangulateFace as triangulateFaceQuery,
  triangulatePolygon2D as triangulatePolygon2DQuery,
  validate as validateQuery,
} from '@/core/query'
import * as prim from '@/core/ops/primitives'
import { pushPullMut } from '@/core/ops/pushpull'

/* ------------------------------------------------------------------ */
/* Cache-Invalidierung                                                 */
/* ------------------------------------------------------------------ */

/**
 * Schliesst eine Operation ab: raeumliche Indizes und Flaechen-Cache der
 * betroffenen Flaechen verwerfen, dann den flachen Change liefern.
 */
function commit(geom: Geometry, acc: ChangeAcc): GeometryChange {
  const change = finishAcc(acc)
  for (const id of change.removedFaces) invalidateFaceCache(id)
  for (const id of change.modifiedFaces) invalidateFaceCache(id)
  invalidateSpatialIndex(geom)
  return change
}

/** Verwirft alle Caches einer Geometrie (nach externen Mutationen). */
export function invalidateCaches(geom?: Geometry, faceId?: Id): void {
  invalidateFaceCache(faceId)
  invalidateSpatialIndex(geom)
}

export { invalidateFaceCache, invalidateSpatialIndex }

/* ------------------------------------------------------------------ */
/* Aufbau                                                             */
/* ------------------------------------------------------------------ */

export interface AddOptions {
  /** Konstruktionskante - erzeugt niemals Flaechen */
  guide?: boolean
  /** Tag der neuen Primitive */
  tagId?: Id | null
  /** Material der neuen Primitive */
  materialId?: Id | null
  /** false = kein automatisches Flaechenfinden (schnelles Bulk-Laden) */
  autoFace?: boolean
  /** false = keine Kantenschnitte suchen (schnelles Bulk-Laden) */
  splitIntersections?: boolean
  /** weiche/geglaettete Kante */
  soft?: boolean
  smooth?: boolean
}

/** Kante zwischen zwei Punkten, inklusive Verschmelzen, Teilen, Flaechenbildung. */
export function addEdge(geom: Geometry, a: Vec3Like, b: Vec3Like, opts?: AddOptions): GeometryChange {
  const acc = newAcc()
  addEdgeMut(geom, a, b, opts ?? {}, acc)
  return commit(geom, acc)
}

/** Zusammenhaengender Kantenzug. */
export function addPolyline(
  geom: Geometry,
  points: readonly Vec3Like[],
  closed: boolean,
  opts?: AddOptions,
): GeometryChange {
  const acc = newAcc()
  addPolylineMut(geom, points, closed, opts ?? {}, acc)
  return commit(geom, acc)
}

/** Flaeche direkt aus einer geschlossenen, planaren Punktschleife (plus Loechern). */
export function addFacePolygon(
  geom: Geometry,
  outer: readonly Vec3Like[],
  holes?: readonly (readonly Vec3Like[])[],
  opts?: AddOptions,
): GeometryChange {
  const acc = newAcc()
  addFacePolygonMut(geom, outer, holes, opts ?? {}, acc)
  return commit(geom, acc)
}

/** Fuegt eine komplette zweite Geometrie ein (Gruppe aufloesen, Import). */
export function mergeGeometry(target: Geometry, source: Geometry, transform?: Mat4Like): GeometryChange {
  const acc = newAcc()
  mergeGeometryMut(target, source, transform, acc)
  return commit(target, acc)
}

/* ------------------------------------------------------------------ */
/* Loeschen und Aufraeumen                                            */
/* ------------------------------------------------------------------ */

export function deletePrimitives(
  geom: Geometry,
  ids: { edgeIds?: Id[]; faceIds?: Id[]; vertexIds?: Id[] },
): GeometryChange {
  const acc = newAcc()
  deletePrimitivesMut(geom, ids, acc)
  return commit(geom, acc)
}

/** Entfernt verwaiste Vertices/Kanten und repariert Flaechenreferenzen. */
export function cleanup(geom: Geometry): GeometryChange {
  const acc = newAcc()
  cleanupMut(geom, acc)
  return commit(geom, acc)
}

/** Fuehrt koplanare Nachbarflaechen zusammen und entfernt ueberfluessige Kanten. */
export function mergeCoplanarFaces(geom: Geometry, faceIds?: Id[]): GeometryChange {
  const acc = newAcc()
  mergeCoplanarFacesMut(geom, faceIds, acc)
  return commit(geom, acc)
}

/* ------------------------------------------------------------------ */
/* Transformieren                                                     */
/* ------------------------------------------------------------------ */

export function moveVertices(geom: Geometry, vertexIds: readonly Id[], delta: Vec3Like): GeometryChange {
  const acc = newAcc()
  moveVerticesMut(geom, vertexIds, delta, acc)
  return commit(geom, acc)
}

/**
 * Transformiert Primitive. `copy = true` dupliziert sie statt sie zu bewegen.
 * Faces/Edges werden auf ihre Vertices erweitert.
 */
export function transformPrimitives(
  geom: Geometry,
  ids: { edgeIds?: Id[]; faceIds?: Id[]; vertexIds?: Id[] },
  matrix: Mat4Like,
  copy: boolean,
): GeometryChange {
  const acc = newAcc()
  transformPrimitivesMut(geom, ids, matrix, copy, acc)
  return commit(geom, acc)
}

/** Neue, transformierte Kopie der gesamten Geometrie. */
export function transformGeometry(geom: Geometry, matrix: Mat4Like): Geometry {
  return transformGeometryCopy(geom, matrix)
}

export function cloneGeometry(geom: Geometry): Geometry {
  return cloneGeometryDeep(geom)
}

/* ------------------------------------------------------------------ */
/* Modellierwerkzeuge                                                 */
/* ------------------------------------------------------------------ */

export interface PushPullOptions {
  /** Richtung, Standard ist die Flaechennormale */
  direction?: Vec3Like
  /** true = Startflaeche bleibt stehen (Strg beim Druecken/Ziehen) */
  createNewStartingFace?: boolean
  /** Flaechen, die beim Extrudieren abgezogen werden sollen (Loecher) */
  holeFaceIds?: Id[]
}

export function pushPull(geom: Geometry, faceId: Id, distance: number, opts?: PushPullOptions): GeometryChange {
  const acc = newAcc()
  pushPullMut(geom, faceId, distance, opts, acc)
  return commit(geom, acc)
}

/** Extrudiert ein Profil entlang eines Kantenpfads (Folge-mir). */
export function followMe(geom: Geometry, profileFaceId: Id, pathEdgeIds: readonly Id[]): GeometryChange {
  throw new Error('core: followMe() ist noch nicht implementiert')
}

/** Rotationskoerper - Spezialfall von followMe mit Kreispfad. */
export function revolve(
  geom: Geometry,
  profileFaceId: Id,
  axisOrigin: Vec3Like,
  axisDirection: Vec3Like,
  angle: number,
  segments: number,
): GeometryChange {
  throw new Error('core: revolve() ist noch nicht implementiert')
}

/** Versatz der Aussenschleife einer Flaeche; positiv = nach aussen. */
export function offsetFace(geom: Geometry, faceId: Id, distance: number): GeometryChange {
  throw new Error('core: offsetFace() ist noch nicht implementiert')
}

/** Versatz eines zusammenhaengenden, planaren Kantenzugs. */
export function offsetEdges(geom: Geometry, edgeIds: readonly Id[], distance: number): GeometryChange {
  throw new Error('core: offsetEdges() ist noch nicht implementiert')
}

/**
 * Erzeugt Schnittkanten zwischen Flaechenmengen.
 * `sourceFaceIds` gegen `targetFaceIds`; ohne target gegen die gesamte Geometrie.
 */
export function intersectFaces(
  geom: Geometry,
  sourceFaceIds: readonly Id[],
  targetFaceIds?: readonly Id[],
): GeometryChange {
  throw new Error('core: intersectFaces() ist noch nicht implementiert')
}

/** Dreht die Vorder-/Rueckseite der Flaechen um. */
export function reverseFaces(geom: Geometry, faceIds: readonly Id[]): void {
  reverseFacesMut(geom, faceIds)
  for (const id of faceIds) invalidateFaceCache(id)
}

/** Richtet alle zusammenhaengenden Flaechen an der Orientierung von `seedFaceId` aus. */
export function orientFacesConsistently(geom: Geometry, seedFaceId: Id): void {
  orientFacesConsistentlyMut(geom, seedFaceId)
  invalidateFaceCache()
}

/** Weichzeichnen/Glaetten anhand des Winkels zwischen Nachbarflaechen. */
export function softenEdges(
  geom: Geometry,
  edgeIds: readonly Id[],
  angleRad: number,
  opts?: { softenCoplanar?: boolean; soften?: boolean; smooth?: boolean },
): void {
  softenEdgesMut(geom, edgeIds, angleRad, opts)
}

/** Boolesche Operation zwischen zwei geschlossenen Volumen. */
export function booleanSolid(
  a: Geometry,
  b: Geometry,
  op: 'union' | 'subtract' | 'intersect',
): Geometry | null {
  throw new Error('core: booleanSolid() ist noch nicht implementiert')
}

/* ------------------------------------------------------------------ */
/* Abfragen                                                           */
/* ------------------------------------------------------------------ */

/** Punkte der Aussenschleife einer Flaeche, in Umlaufrichtung. */
export function faceVertices(geom: Geometry, faceId: Id): Vec3Like[] {
  return faceVerticesQuery(geom, faceId)
}

/** Punkte einer Lochschleife. */
export function faceHoleVertices(geom: Geometry, faceId: Id, holeIndex: number): Vec3Like[] {
  return faceHoleVerticesQuery(geom, faceId, holeIndex)
}

/**
 * Trianguliert eine Flaeche inklusive Loecher.
 * Positionen sind Weltkoordinaten des Kontexts, Normalen zeigen zur Vorderseite.
 */
export function triangulateFace(
  geom: Geometry,
  faceId: Id,
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  return triangulateFaceQuery(geom, faceId)
}

export function faceArea(geom: Geometry, faceId: Id): number {
  return faceAreaQuery(geom, faceId)
}

export function facePlane(geom: Geometry, faceId: Id): PlaneLike {
  return facePlaneQuery(geom, faceId)
}

export function edgeLength(geom: Geometry, edgeId: Id): number {
  return edgeLengthQuery(geom, edgeId)
}

export function edgePoints(geom: Geometry, edgeId: Id): [Vec3Like, Vec3Like] {
  return edgePointsQuery(geom, edgeId)
}

export function geometryBounds(geom: Geometry): BBox3Like {
  return geometryBoundsQuery(geom)
}

/** true, wenn jede Kante genau zwei Flaechen hat (geschlossenes Volumen). */
export function isSolid(geom: Geometry): boolean {
  return isSolidQuery(geom)
}

/** Volumen eines geschlossenen Koerpers, sonst 0. */
export function solidVolume(geom: Geometry): number {
  return solidVolumeQuery(geom)
}

export function totalArea(geom: Geometry, faceIds?: readonly Id[]): number {
  return totalAreaQuery(geom, faceIds)
}

/** Alle ueber Kanten verbundenen Primitive ab einem Startelement. */
export function findConnected(
  geom: Geometry,
  seed: { edgeIds?: Id[]; faceIds?: Id[] },
): { edgeIds: Id[]; faceIds: Id[]; vertexIds: Id[] } {
  return findConnectedQuery(geom, seed)
}

/** Alle koplanaren, zusammenhaengenden Flaechen ab einer Startflaeche. */
export function findCoplanar(geom: Geometry, faceId: Id): Id[] {
  return findCoplanarFaces(geom, faceId)
}

/** Begrenzungskanten einer Flaechenmenge. */
export function boundingEdges(geom: Geometry, faceIds: readonly Id[]): Id[] {
  return boundingEdgesQuery(geom, faceIds)
}

/**
 * Ordnet lose Kanten zu einem durchgehenden Pfad (Folge-mir, Versatz).
 * Liefert null, wenn die Kanten keinen einfachen Pfad bilden.
 */
export function orderEdgePath(geom: Geometry, edgeIds: readonly Id[]): Id[] | null {
  return orderEdgePathQuery(geom, edgeIds)
}

export interface RaycastHit {
  kind: 'face' | 'edge' | 'vertex'
  id: Id
  point: Vec3Like
  distance: number
  normal: Vec3Like | null
}

/**
 * Strahltest gegen eine Geometrie. `tolerance` ist der Radius in Modell-
 * einheiten, in dem Kanten und Vertices Vorrang vor Flaechen bekommen.
 */
export function raycast(
  geom: Geometry,
  ray: Ray,
  opts?: { tolerance?: number; kinds?: ('face' | 'edge' | 'vertex')[]; ignore?: Id[]; backfaces?: boolean },
): RaycastHit[] {
  return raycastQuery(geom, ray, opts)
}

/** Prueft die Integritaet und liefert Fehlerbeschreibungen (Tests, Debug). */
export function validate(geom: Geometry): string[] {
  return validateQuery(geom)
}

/* ------------------------------------------------------------------ */
/* Primitivgeneratoren (liefern Punktschleifen, keine Geometrie)      */
/* ------------------------------------------------------------------ */

export function buildCircle(center: Vec3Like, normal: Vec3Like, radius: number, segments: number, startPoint?: Vec3Like): Vec3Like[] {
  return prim.buildCircle(center, normal, radius, segments, startPoint)
}

export function buildPolygon(center: Vec3Like, normal: Vec3Like, radius: number, sides: number, inscribed?: boolean, startPoint?: Vec3Like): Vec3Like[] {
  return prim.buildPolygon(center, normal, radius, sides, inscribed, startPoint)
}

/** Bogen ueber Zentrum, Startwinkel, Endwinkel. */
export function buildArc(center: Vec3Like, normal: Vec3Like, radius: number, startAngle: number, endAngle: number, segments: number, xAxis?: Vec3Like): Vec3Like[] {
  return prim.buildArc(center, normal, radius, startAngle, endAngle, segments, xAxis)
}

/** Bogen durch drei Punkte. */
export function buildArc3Points(a: Vec3Like, b: Vec3Like, c: Vec3Like, segments: number): Vec3Like[] {
  return prim.buildArc3Points(a, b, c, segments)
}

/** Bogen ueber Sehne + Bogenhoehe (SketchUp "Arc"-Werkzeug). */
export function buildArcBulge(start: Vec3Like, end: Vec3Like, bulge: number, normal: Vec3Like, segments: number): Vec3Like[] {
  return prim.buildArcBulge(start, end, bulge, normal, segments)
}

export function buildRectangle(origin: Vec3Like, xAxis: Vec3Like, yAxis: Vec3Like, width: number, height: number): Vec3Like[] {
  return prim.buildRectangle(origin, xAxis, yAxis, width, height)
}

/** Kubische Bezierkurve als Punktzug. */
export function buildBezier(p0: Vec3Like, p1: Vec3Like, p2: Vec3Like, p3: Vec3Like, segments: number): Vec3Like[] {
  return prim.buildBezier(p0, p1, p2, p3, segments)
}

/**
 * Trianguliert ein 2D-Polygon mit Loechern (Ohren-Clipping, robust gegen
 * konkave Formen). Indizes beziehen sich auf `outer.concat(...holes)`.
 */
export function triangulatePolygon2D(
  outer: readonly { x: number; y: number }[],
  holes?: readonly (readonly { x: number; y: number }[])[],
): number[] {
  return triangulatePolygon2DQuery(outer, holes)
}
