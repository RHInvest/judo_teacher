/**
 * Push/Pull - extruding a face along its normal.
 *
 * Two modes:
 *  - STRETCH: the face is attached to a volume (every boundary edge has exactly
 *    one neighbour whose plane contains the extrusion direction). The face is
 *    simply translated, which lengthens the existing side walls instead of
 *    duplicating them.
 *  - EXTRUDE: everything else. New cap, new side walls, the starting face
 *    becomes the opposite cap (or stays untouched with `createNewStartingFace`).
 *
 * In both modes the resulting cap is tested against the opposite side of the
 * solid; when it lands exactly on a coplanar face it is dissolved into a hole
 * of that face, which turns a push-through into a real opening.
 *
 * ------------------------------------------------------------------------
 * AUSLEGUNG "in Material hinein" (vom Lead bestaetigt, bitte nicht wegraeumen)
 * ------------------------------------------------------------------------
 * Der Contract sagt nicht, was passieren soll, wenn in Extrusionsrichtung
 * bereits Material steht. Wir folgen SketchUp:
 *
 *  1. AUSHOEHLUNG vs. AUFSATZ wird per Parity-Raycast entschieden
 *     (`pushesIntoMaterial`): ein Punkt knapp hinter der Flaeche liegt genau
 *     dann im Volumen, wenn ein Strahl von dort eine ungerade Zahl an Flaechen
 *     kreuzt. Beim Aushoehlen werden Seitenwaende UND Deckel umgekehrt
 *     orientiert (`orient = -s`), denn ihre Vorderseiten zeigen dann in den
 *     ausgehoehlten Kanal statt aus einem Klotz heraus.
 *
 *  2. Eine Flaeche, die ein LOCH EINER KOPLANAREN NACHBARFLAECHE fuellt
 *     (`fillsHoleOfCoplanarFace`), waere nach dem Extrudieren eine Innenwand
 *     und wird geloescht. Die Nachbarflaeche behaelt ihr Loch, also die
 *     Oeffnung. Genau dadurch wird aus "Fenster auf die Deckflaeche zeichnen
 *     und pushPull(-4)" ein echtes Loch: `isSolid()` bleibt true, das Volumen
 *     eines 10x10x4-Quaders mit 3x3-Durchbruch ist 364 (Testfall in
 *     `src/core/__tests__/pushpull.test.ts`).
 *
 *  3. `createNewStartingFace: true` schaltet BEIDES ab - die Startflaeche
 *     bleibt unveraendert stehen, es wird immer ein Aufsatz gebaut.
 */

import type { Face, Geometry, Id, Loop, Vec3Like } from '@/shared/types'
import { MIN_LENGTH, P, PLANAR_TOL, POINT_TOL, R, V } from '@/core/math'
import {
  createEdge,
  createFace,
  createVertex,
  faceLoops,
  flipFace,
  loopPoints,
  moveVerticesMut,
  pointInRegion2D,
  refreshFacePlane,
  removeFace,
  reverseLoop,
  vertexPoint,
  type ChangeAcc,
  isFiniteNumber,
  isFinitePoint,
} from '@/core/topology'
import { faceTriangles } from '@/core/query/triangulate'

export interface PushPullOptions {
  /** Richtung, Standard ist die Flaechennormale */
  direction?: Vec3Like
  /** true = Startflaeche bleibt stehen (Strg beim Druecken/Ziehen) */
  createNewStartingFace?: boolean
  /** Flaechen, die beim Extrudieren abgezogen werden sollen (Loecher) */
  holeFaceIds?: Id[]
}

/** true when the plane of `faceId` contains `dir` (a side wall of the extrusion) */
function isWall(geom: Geometry, faceId: Id, dir: Vec3Like): boolean {
  const f = geom.faces[faceId]
  if (!f) return false
  return Math.abs(V.dot(f.normal, dir)) < 1e-6
}

/**
 * Dissolves `capId` into a hole of a coplanar face that faces the other way and
 * fully contains it. Returns true when the cap was consumed.
 */
function punchThrough(geom: Geometry, capId: Id, acc: ChangeAcc): boolean {
  const cap = geom.faces[capId]
  if (!cap) return false
  for (const gId in geom.faces) {
    if (gId === capId) continue
    const g = geom.faces[gId]
    if (V.dot(g.normal, cap.normal) > -0.999) continue
    if (!P.isCoplanar(g.plane, cap.plane, PLANAR_TOL * 4)) continue
    const frame = P.frame(g.plane)
    const gOuter = loopPoints(geom, g.outer).map(frame.to2d)
    const gHoles = g.inner.map((l) => loopPoints(geom, l).map(frame.to2d))
    const capPts = loopPoints(geom, cap.outer).map(frame.to2d)
    if (capPts.length < 3) continue
    if (!capPts.every((p) => pointInRegion2D(p, gOuter, gHoles, POINT_TOL))) continue
    const loop: Loop = { edges: [...cap.outer.edges], vertices: [...cap.outer.vertices] }
    removeFace(geom, capId, acc)
    // the cap loop runs CCW around cap.normal == -g.normal, i.e. CW around
    // g.normal, which is exactly the winding a hole needs
    g.inner.push(loop)
    for (const eId of loop.edges) {
      const e = geom.edges[eId]
      if (e && !e.faces.includes(gId)) e.faces.push(gId)
    }
    acc.modifiedFaces.add(gId)
    return true
  }
  return false
}

/** A point that is safely inside the face, holes excluded. */
function faceInteriorPoint(geom: Geometry, faceId: Id): Vec3Like | null {
  let best: Vec3Like | null = null
  let bestArea = 0
  for (const [a, b, c] of faceTriangles(geom, faceId)) {
    const area = V.length(V.cross(V.sub(b, a), V.sub(c, a))) * 0.5
    if (area <= bestArea) continue
    bestArea = area
    best = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 }
  }
  return bestArea > MIN_LENGTH ? best : null
}

/**
 * true when the extrusion runs INTO existing material instead of into empty
 * space. Parity test: a point just past the face along `dir` is inside the
 * solid exactly when a ray from there crosses an odd number of faces.
 */
function pushesIntoMaterial(geom: Geometry, faceId: Id, dir: Vec3Like, reach: number): boolean {
  const inside = faceInteriorPoint(geom, faceId)
  if (!inside) return false
  const eps = Math.max(MIN_LENGTH * 10, Math.min(reach * 0.25, 1e-3))
  const origin = V.addScaled(inside, dir, eps)
  const ray = R.ray(origin, dir)
  let crossings = 0
  for (const gId in geom.faces) {
    if (gId === faceId) continue
    let hit = false
    for (const [a, b, c] of faceTriangles(geom, gId)) {
      if (R.intersectTriangle(ray, a, b, c, false)) {
        hit = true
        break
      }
    }
    if (hit) crossings++
  }
  return crossings % 2 === 1
}

/**
 * true when the face fills a hole of a coplanar neighbour, i.e. it sits inside
 * a larger surface. Such a face becomes an interior interface after extruding
 * and has to disappear.
 */
function fillsHoleOfCoplanarFace(geom: Geometry, face: Face): boolean {
  const own = new Set(face.outer.edges)
  if (own.size === 0) return false
  for (const eId of face.outer.edges) {
    const e = geom.edges[eId]
    if (!e) continue
    for (const gId of e.faces) {
      if (gId === face.id) continue
      const g = geom.faces[gId]
      if (!g) continue
      if (!P.isCoplanar(g.plane, face.plane, PLANAR_TOL * 4)) continue
      for (const loop of g.inner) {
        if (loop.edges.length !== own.size) continue
        if (loop.edges.every((id) => own.has(id))) return true
      }
    }
  }
  return false
}

export function pushPullMut(
  geom: Geometry,
  faceId: Id,
  distance: number,
  opts: PushPullOptions | undefined,
  acc: ChangeAcc,
): void {
  const face = geom.faces[faceId]
  if (!face) return
  // NaN zuerst: `Math.abs(NaN) <= POINT_TOL` ist false, eine NaN-Distanz kaeme
  // sonst durch und extrudierte den Koerper ins Nichts.
  if (!isFiniteNumber(distance)) return
  if (Math.abs(distance) <= POINT_TOL) return
  if (opts?.direction && !isFinitePoint(opts.direction)) return
  let dirN = V.normalizeOr(opts?.direction ?? face.normal, face.normal)
  if (V.lengthSq(dirN) < 0.5) dirN = face.normal
  const off = V.mul(dirN, distance)
  if (V.length(off) < MIN_LENGTH) return
  const alongNormal = V.dot(off, face.normal)
  const s = alongNormal < 0 ? -1 : 1

  // optional explicit holes (coplanar faces sitting inside the extruded face)
  for (const holeId of opts?.holeFaceIds ?? []) {
    const hole = geom.faces[holeId]
    if (!hole || holeId === faceId) continue
    if (!P.isCoplanar(hole.plane, face.plane, PLANAR_TOL * 4)) continue
    const loop: Loop = { edges: [...hole.outer.edges], vertices: [...hole.outer.vertices] }
    removeFace(geom, holeId, acc)
    const pts = loop.vertices.map((v) => vertexPoint(geom, v))
    const n = P.polygonNormal(pts)
    const oriented = n && V.dot(n, face.normal) > 0 ? reverseLoop(loop) : loop
    face.inner.push(oriented)
    for (const eId of oriented.edges) {
      const e = geom.edges[eId]
      if (e && !e.faces.includes(faceId)) e.faces.push(faceId)
    }
    acc.modifiedFaces.add(faceId)
  }

  const loops = faceLoops(face)
  const boundaryEdges: Id[] = []
  for (const loop of loops) for (const eId of loop.edges) boundaryEdges.push(eId)

  /* ---------------- stretch mode ---------------- */
  let stretch = !opts?.createNewStartingFace
  const walls = new Set<Id>()
  if (stretch) {
    for (const eId of boundaryEdges) {
      const e = geom.edges[eId]
      if (!e || e.faces.length !== 2) {
        stretch = false
        break
      }
      const otherId = e.faces.find((f) => f !== faceId)
      if (otherId === undefined || !isWall(geom, otherId, dirN)) {
        stretch = false
        break
      }
      walls.add(otherId)
    }
  }
  const vertexIds = new Set<Id>()
  for (const loop of loops) for (const vId of loop.vertices) vertexIds.add(vId)
  if (stretch) {
    for (const vId of vertexIds) {
      const v = geom.vertices[vId]
      if (!v) continue
      for (const eId of v.edges) {
        const e = geom.edges[eId]
        if (!e) continue
        for (const fId of e.faces) {
          if (fId !== faceId && !walls.has(fId)) stretch = false
        }
      }
    }
  }

  if (stretch) {
    moveVerticesMut(geom, [...vertexIds], off, acc)
    for (const wallId of walls) {
      refreshFacePlane(geom, wallId)
      acc.modifiedFaces.add(wallId)
    }
    acc.modifiedFaces.add(faceId)
    punchThrough(geom, faceId, acc)
    return
  }

  /* ---------------- extrude mode ---------------- */
  // Pushing into existing material carves a recess instead of adding a plug:
  // walls and cap face the other way round.
  const keepStart = opts?.createNewStartingFace === true
  // the parity test needs the real travel direction, not the face normal
  const travel = V.normalize(off)
  const carving = !keepStart && pushesIntoMaterial(geom, faceId, travel, V.length(off))
  // a face filling a hole of a coplanar neighbour is an interior interface
  // afterwards and must not survive the operation
  const dropStart = !keepStart && fillsHoleOfCoplanarFace(geom, face)
  const orient = carving ? -s : s

  const props = { tagId: face.tagId, materialId: null }
  const vMap = new Map<Id, Id>()
  for (const vId of vertexIds) {
    vMap.set(vId, createVertex(geom, V.add(vertexPoint(geom, vId), off), acc))
  }
  const topEdge = new Map<Id, Id>()
  for (const eId of boundaryEdges) {
    if (topEdge.has(eId)) continue
    const e = geom.edges[eId]
    if (!e) continue
    const a = vMap.get(e.a)
    const b = vMap.get(e.b)
    if (a === undefined || b === undefined) continue
    topEdge.set(eId, createEdge(geom, a, b, { ...props, soft: e.soft, smooth: e.smooth }, acc))
  }
  const railEdge = new Map<Id, Id>()
  for (const [oldV, newV] of vMap) {
    railEdge.set(oldV, createEdge(geom, oldV, newV, props, acc))
  }

  // side walls
  for (const loop of loops) {
    const n = loop.edges.length
    for (let i = 0; i < n; i++) {
      const eId = loop.edges[i]
      const aId = loop.vertices[i]
      const bId = loop.vertices[(i + 1) % n]
      const top = topEdge.get(eId)
      const at = vMap.get(aId)
      const bt = vMap.get(bId)
      const ra = railEdge.get(aId)
      const rb = railEdge.get(bId)
      if (top === undefined || at === undefined || bt === undefined || ra === undefined || rb === undefined) continue
      const wall: Loop =
        orient > 0
          ? { vertices: [aId, bId, bt, at], edges: [eId, rb, top, ra] }
          : { vertices: [bId, aId, at, bt], edges: [eId, ra, top, rb] }
      const pts = wall.vertices.map((v) => vertexPoint(geom, v))
      const normal = P.polygonNormal(pts)
      if (!normal) continue
      createFace(geom, wall, [], normal, { tagId: face.tagId }, acc)
    }
  }

  // cap
  const mapLoop = (loop: Loop): Loop => ({
    edges: loop.edges.map((e) => topEdge.get(e) as Id),
    vertices: loop.vertices.map((v) => vMap.get(v) as Id),
  })
  let capOuter = mapLoop(face.outer)
  let capInner = face.inner.map(mapLoop)
  let capNormal = face.normal
  if (orient < 0) {
    capOuter = reverseLoop(capOuter)
    capInner = capInner.map(reverseLoop)
    capNormal = V.negate(face.normal)
  }
  const capId = createFace(geom, capOuter, capInner, capNormal, {
    frontMaterialId: face.frontMaterialId,
    backMaterialId: face.backMaterialId,
    tagId: face.tagId,
    hidden: face.hidden,
  }, acc)

  if (dropStart) {
    // interior interface - the surrounding coplanar face keeps the opening
    removeFace(geom, faceId, acc)
  } else if (orient > 0) {
    // the starting face becomes the opposite cap, so its front has to look away
    // from the new volume
    flipFace(geom, faceId)
    acc.modifiedFaces.add(faceId)
  }

  punchThrough(geom, capId, acc)
}
