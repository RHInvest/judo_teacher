/**
 * Strahltest gegen einen Geometrie-Kontext.
 *
 * Vertices schlagen Kanten, Kanten schlagen Flaechen, solange die Treffer
 * hoechstens `tolerance` voneinander entfernt liegen. Flaechen werden mit
 * Moeller-Trumbore gegen die Triangulierung geprueft, Kanten mit einem
 * Kapseltest, Vertices mit einem Kugeltest.
 *
 * BEDEUTUNG VON `tolerance` - bewusst nicht fuer alle Arten gleich:
 *
 *  - Kanten und Vertices: `tolerance` ist ein echter FANGRADIUS in
 *    Modelleinheiten. Ein Vertex innerhalb dieses Radius um den Strahl gilt als
 *    getroffen, auch wenn der Strahl ihn verfehlt. Der Renderer rechnet dafuer
 *    seine Pixeltoleranz in Weltmass um.
 *  - Flaechen: `tolerance` weitet die Flaeche NICHT auf. Wer neben dem Koerper
 *    klickt, trifft die Flaeche nicht - sonst wuerde der Farbeimer Flaechen
 *    faerben, die gar nicht unter dem Cursor liegen. `tolerance` steuert bei
 *    Flaechen nur die Kandidatensuche im BVH (siehe unten) und die Rangfolge
 *    beim Sortieren.
 *
 * Der Rand einer Flaeche gehoert dabei zur Flaeche: ein Strahl, der die
 * Triangulierung um hoechstens POINT_TOL verfehlt, gilt als Treffer, und der
 * gemeldete Punkt liegt auf die Flaeche geklemmt. POINT_TOL ist dieselbe
 * Konstante, nach der zwei Punkte im Modell derselbe Punkt sind - was
 * modellweit auf der Flaeche liegt, trifft sie also auch beim Picken. Das ist
 * eine rein NUMERISCHE Randhaut (0.01 mm), keine Bedienhilfe, und sie haengt
 * bewusst nicht an `tolerance`.
 *
 * ZWEI WEGE, EINE ANTWORT: Der Renderer kann denselben Test auf seinen
 * Puffern fahren (`render/picking.ts`, `bufferRaycast`). Beide Pfade benutzen
 * R.intersectTriangle; damit sie dieselbe Antwort geben, muss die
 * BVH-Kandidatensuche hier mindestens so weit greifen wie der Dreieckstest
 * danach. Frueher lief die Flaechensuche mit pad = 0: ein Klick genau auf einen
 * Flaechenrand, durch die Bildschirmprojektion um ~1e-14 nach aussen versetzt,
 * fiel schon im BVH heraus, obwohl der Dreieckstest ihn angenommen haette.
 * Deshalb padded der Flaechenpfad jetzt wie der Kantenpfad.
 */

import type { Geometry, Id, Vec3Like } from '@/shared/types'
import { P, POINT_TOL, R, V, type Ray } from '@/core/math'
import { faceTriangles } from './triangulate'
import { queryRay, spatialIndex } from './spatial'

export interface RaycastHit {
  kind: 'face' | 'edge' | 'vertex'
  id: Id
  point: Vec3Like
  distance: number
  normal: Vec3Like | null
}

export interface RaycastOptions {
  tolerance?: number
  kinds?: ('face' | 'edge' | 'vertex')[]
  ignore?: Id[]
  backfaces?: boolean
}

const RANK: Record<RaycastHit['kind'], number> = { vertex: 0, edge: 1, face: 2 }

/**
 * Ein Strahl ohne endliche Koordinaten oder ohne Richtung erzeugt sonst ueberall
 * NaN-Vergleiche und damit unvorhersagbare Treffer. Lieber gar kein Treffer.
 */
function isUsableRay(ray: Ray): boolean {
  if (!ray) return false
  const o = ray.origin
  const d = ray.dir
  if (!o || !d) return false
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.z)) return false
  if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.z)) return false
  return V.lengthSq(d) > 0
}

/** Abstand eines Punktes zum Dreiecksrand plus der naechste Randpunkt. */
function closestOnTriangleBorder(
  p: Vec3Like,
  a: Vec3Like,
  b: Vec3Like,
  c: Vec3Like,
): { distance: number; point: Vec3Like } {
  let best = { distance: Infinity, point: a }
  for (const [s, e] of [
    [a, b],
    [b, c],
    [c, a],
  ] as const) {
    const near = R.closestPointOnSegment(s, e, p).point
    const d = V.distance(near, p)
    if (d < best.distance) best = { distance: d, point: near }
  }
  return best
}

/**
 * Rueckfall fuer den Flaechenrand: Der Strahl hat kein Dreieck getroffen. Trifft
 * er die Flaechenebene hoechstens POINT_TOL neben der Triangulierung, gilt das
 * als Treffer auf dem Rand; gemeldet wird der auf die Flaeche geklemmte Punkt.
 */
function borderHit(
  ray: Ray,
  plane: { n: Vec3Like; d: number },
  tris: readonly [Vec3Like, Vec3Like, Vec3Like][],
): { t: number; point: Vec3Like } | null {
  const t = P.intersectRay(plane, ray.origin, ray.dir)
  if (t === null || t < 0 || !Number.isFinite(t)) return null
  const onPlane = R.at(ray, t)
  let best: { distance: number; point: Vec3Like } | null = null
  for (const [a, b, c] of tris) {
    const near = closestOnTriangleBorder(onPlane, a, b, c)
    if (!best || near.distance < best.distance) best = near
  }
  if (!best || best.distance > POINT_TOL) return null
  return { t: Math.max(0, V.dot(V.sub(best.point, ray.origin), ray.dir)), point: best.point }
}

/**
 * RUECKGABE - ein ARRAY, nie null.
 *
 *  - Ein LEERES Array heisst: kein Treffer. Es ist kein Fehlerzustand und kein
 *    "weiss nicht"; der Aufrufer braucht keinen weiteren Pfad zu befragen.
 *  - Sind Treffer da, ist der ERSTE der beste. Wer nur einen braucht, nimmt
 *    `hits[0]`.
 *  - SORTIERREIHENFOLGE: primaer nach `distance` (Strahlparameter, aufsteigend,
 *    also von der Kamera weg). Liegen zwei Treffer weniger als
 *    max(tolerance, POINT_TOL) auseinander, gelten sie als gleich weit weg und
 *    die Art entscheidet: vertex vor edge vor face. Nur so gewinnt eine
 *    Kante gegen die Flaeche, auf der sie liegt - beide haben ja praktisch
 *    denselben Abstand.
 *  - Es kann MEHRERE Treffer derselben Art geben (Vorder- und Rueckseite eines
 *    Koerpers, verdeckte Flaechen). Wer nur die vorderste Flaeche will,
 *    filtert selbst; `backfaces: false` wirft die vom Strahl abgewandten
 *    Flaechen vorher weg.
 *  - Der Strahl wird als HALBGERADE behandelt: Treffer mit `distance < 0`
 *    hinter dem Ursprung kommen nicht vor.
 *  - `ignore` filtert nach Id, unabhaengig von der Art.
 *
 * Unsinnige Eingaben liefern ein leeres Array statt zu werfen: unbekannte Ids
 * in `ignore`, leere Geometrie, `tolerance` als NaN oder negativ (wird als 0
 * gelesen), ein Strahl mit Richtung 0 oder NaN.
 */
export function raycast(geom: Geometry, ray: Ray, opts?: RaycastOptions): RaycastHit[] {
  if (!isUsableRay(ray)) return []
  const tolerance = Number.isFinite(opts?.tolerance) ? Math.max(0, opts!.tolerance as number) : 0
  const kinds = new Set(opts?.kinds ?? ['face', 'edge', 'vertex'])
  const ignore = new Set(opts?.ignore ?? [])
  const backfaces = opts?.backfaces ?? true
  const hits: RaycastHit[] = []
  const index = spatialIndex(geom)

  if (kinds.has('edge') || kinds.has('vertex')) {
    const pad = Math.max(tolerance, POINT_TOL)
    const candidates = queryRay(index.edges, ray, pad)
    const seenVertex = new Set<Id>()
    for (const eId of candidates) {
      const e = geom.edges[eId]
      if (!e) continue
      const a = geom.vertices[e.a]
      const b = geom.vertices[e.b]
      if (!a || !b) continue
      if (kinds.has('vertex')) {
        for (const v of [a, b]) {
          if (seenVertex.has(v.id) || ignore.has(v.id)) continue
          seenVertex.add(v.id)
          const along = V.dot(V.sub(v.p, ray.origin), ray.dir)
          if (along < 0) continue
          const closest = V.addScaled(ray.origin, ray.dir, along)
          if (V.distance(closest, v.p) > pad) continue
          hits.push({ kind: 'vertex', id: v.id, point: { ...v.p }, distance: along, normal: null })
        }
      }
      if (!kinds.has('edge') || ignore.has(eId)) continue
      const seg = R.rayToSegment(ray, a.p, b.p)
      if (seg.distance > pad) continue
      if (seg.rayT < 0) continue
      hits.push({
        kind: 'edge',
        id: eId,
        point: seg.pointOnSegment,
        distance: seg.rayT,
        normal: null,
      })
    }
  }

  if (kinds.has('face')) {
    /*
     * Padding wie im Kantenpfad. Ohne das faellt eine Flaeche schon in der
     * Kandidatensuche heraus, wenn der Strahl ihre Huellbox um Rundungsrauschen
     * verfehlt - der Dreieckstest danach haette sie angenommen. Siehe die
     * Erlaeuterung im Dateikopf.
     */
    const facePad = Math.max(tolerance, POINT_TOL)
    for (const fId of queryRay(index.faces, ray, facePad)) {
      if (ignore.has(fId)) continue
      const face = geom.faces[fId]
      if (!face) continue
      if (!backfaces && V.dot(face.normal, ray.dir) > 0) continue
      const tris = faceTriangles(geom, fId)
      let best: { t: number; point: Vec3Like } | null = null
      for (const [a, b, c] of tris) {
        const hit = R.intersectTriangle(ray, a, b, c, false)
        if (!hit) continue
        if (!best || hit.t < best.t) best = { t: hit.t, point: hit.point }
      }
      if (!best) best = borderHit(ray, face.plane, tris)
      if (!best) continue
      hits.push({
        kind: 'face',
        id: fId,
        point: best.point,
        distance: best.t,
        normal: { ...face.normal },
      })
    }
  }

  const tie = Math.max(tolerance, POINT_TOL)
  hits.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) <= tie) return RANK[a.kind] - RANK[b.kind]
    return a.distance - b.distance
  })
  return hits
}
