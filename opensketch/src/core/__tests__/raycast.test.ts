/**
 * Strahltest: Trefferarten, Sortierreihenfolge, Flaechenrand, Robustheit.
 *
 * Der Flaechenrand-Block haelt die Entscheidung fest, die aus dem Befund von
 * `render-dev` entstanden ist: Der Kernel liefert am Flaechenrand denselben
 * Treffer wie der Pufferpfad des Renderers. Faellt einer dieser Tests, ist die
 * Deckungsgleichheit der beiden Wege gebrochen.
 */

import { describe, expect, it } from 'vitest'
import { addPolyline, moveVertices, pushPull, raycast } from '@/core'
import { POINT_TOL, R } from '@/core/math'
import { faceTriangles } from '@/core/query/triangulate'
import { queryRay, spatialIndex } from '@/core/query/spatial'
import { edgeIds, faceIds, geom, p, rect } from './helpers'

/** Strahl senkrecht von oben auf die XY-Ebene. */
function down(x: number, y: number, z = 5) {
  return R.ray(p(x, y, z), p(0, 0, -1))
}

describe('raycast Grundfaelle', () => {
  it('trifft eine Flaeche in der Mitte', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    const hits = raycast(g, down(2, 1.5))
    const face = hits.find((h) => h.kind === 'face')
    expect(face).toBeDefined()
    expect(face?.id).toBe(faceIds(g)[0])
    expect(face?.distance).toBeCloseTo(5, 9)
    expect(face?.point.z).toBeCloseTo(0, 9)
    expect(face?.normal).not.toBeNull()
  })

  it('liefert ein leeres Array, wenn der Strahl vorbeigeht', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    const hits = raycast(g, down(20, 20))
    expect(hits).toEqual([])
  })

  it('ignoriert Treffer hinter dem Strahlursprung', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    // Ursprung unter der Ebene, Blick nach unten - die Flaeche liegt dahinter
    const hits = raycast(g, R.ray(p(2, 1.5, -5), p(0, 0, -1)))
    expect(hits).toEqual([])
  })

  it('setzt bei gleicher Entfernung Vertex vor Kante vor Flaeche', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    const hits = raycast(g, down(0, 0), { tolerance: 0.1 })
    expect(hits.length).toBeGreaterThan(2)
    expect(hits[0].kind).toBe('vertex')
    const kinds = hits.map((h) => h.kind)
    expect(kinds.indexOf('edge')).toBeLessThan(kinds.indexOf('face'))
  })

  it('sortiert weiter entfernte Treffer nach hinten', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    pushPull(g, faceIds(g)[0], 2)

    const hits = raycast(g, down(2, 1.5, 10), { kinds: ['face'] })
    expect(hits.length).toBe(2)
    expect(hits[0].distance).toBeLessThan(hits[1].distance)
    // Deckel bei z = 2, Boden bei z = 0
    expect(hits[0].point.z).toBeCloseTo(2, 6)
    expect(hits[1].point.z).toBeCloseTo(0, 6)
  })

  it('wirft mit backfaces: false die abgewandten Flaechen weg', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    pushPull(g, faceIds(g)[0], 2)

    const all = raycast(g, down(2, 1.5, 10), { kinds: ['face'] })
    const front = raycast(g, down(2, 1.5, 10), { kinds: ['face'], backfaces: false })
    expect(all.length).toBe(2)
    expect(front.length).toBe(1)
    expect(front[0].point.z).toBeCloseTo(2, 6)
  })

  it('beachtet kinds und ignore', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const fId = faceIds(g)[0]

    expect(raycast(g, down(2, 1.5), { kinds: ['edge'] })).toEqual([])
    expect(raycast(g, down(2, 1.5), { kinds: ['face'], ignore: [fId] })).toEqual([])
    // unbekannte Ids in ignore stoeren nicht
    const hits = raycast(g, down(2, 1.5), { kinds: ['face'], ignore: ['gibtsnicht'] })
    expect(hits.length).toBe(1)
  })

  it('trifft eine Kante ueber den Fangradius, auch ohne Flaeche', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(4, 0)], false)

    const near = raycast(g, down(2, 0.05), { tolerance: 0.1 })
    expect(near.length).toBe(1)
    expect(near[0].kind).toBe('edge')
    expect(raycast(g, down(2, 0.05), { tolerance: 0 })).toEqual([])
  })
})

describe('raycast Flaechenrand', () => {
  /*
   * Die Bildschirmprojektion rundet. Ein Klick, der geometrisch genau auf dem
   * Flaechenrand liegt, kommt im Modell um Rundungsrauschen daneben an. Die
   * Flaeche muss trotzdem getroffen werden - sonst greift ein Werkzeug wie der
   * Farbeimer am Rand scheinbar zufaellig nicht.
   */

  it('trifft die Flaeche bei Rundungsrauschen genau auf der Randkante', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    const hits = raycast(g, down(4 + 1e-14, 1.5), { kinds: ['face'] })
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('face')
  })

  it('trifft die Flaeche auch genau auf einer Ecke', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    const hits = raycast(g, down(4 + 1e-12, 3 + 1e-12), { kinds: ['face'] })
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('face')
  })

  it('klemmt den gemeldeten Randtreffer auf die Flaeche', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    // knapp ausserhalb, aber innerhalb der numerischen Randhaut
    const hits = raycast(g, down(4 + POINT_TOL * 0.5, 1.5), { kinds: ['face'] })
    expect(hits.length).toBe(1)
    expect(hits[0].point.x).toBeLessThanOrEqual(4 + POINT_TOL)
    expect(hits[0].point.y).toBeCloseTo(1.5, 9)
  })

  it('blaeht die Flaeche NICHT um die Nutzertoleranz auf', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    // 5 cm neben der Flaeche, Toleranz 10 cm: Kante ja, Flaeche nein
    const hits = raycast(g, down(4.05, 1.5), { tolerance: 0.1 })
    expect(hits.some((h) => h.kind === 'edge')).toBe(true)
    expect(hits.some((h) => h.kind === 'face')).toBe(false)
  })

  it('haelt die Kandidatensuche des BVH und den Dreieckstest deckungsgleich', () => {
    /*
     * Kern der Sache: Wenn R.intersectTriangle einen Treffer liefert, darf die
     * BVH-Vorauswahl die Flaeche nicht vorher wegwerfen. Genau das war der Fall,
     * solange der Flaechenpfad ohne Padding suchte.
     */
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const fId = faceIds(g)[0]
    const ray = down(4 + 1e-14, 1.5)

    const triHit = faceTriangles(g, fId).some(
      ([a, b, c]) => R.intersectTriangle(ray, a, b, c, false) !== null,
    )
    expect(triHit).toBe(true)

    const pad = Math.max(0.01, POINT_TOL)
    expect(queryRay(spatialIndex(g).faces, ray, pad)).toContain(fId)
    expect(raycast(g, ray, { kinds: ['face'], tolerance: 0.01 }).length).toBe(1)
  })
})

describe('raycast Genauigkeit', () => {
  it('rechnet auf float64-Vertexpositionen, nicht auf dem float32-Mesh', () => {
    /*
     * Das Render-Mesh ist eine Float32Array. Bei Gebaeudekoordinaten im
     * Tausenderbereich liegt sein Rand bis zu 0,05 mm neben der echten Kante -
     * das Fuenffache von POINT_TOL. Picking, Volumen und CSG duerfen darauf
     * nicht rechnen.
     */
    const g = geom()
    const x = 1234.5678
    const y = 987.6543
    addPolyline(g, [p(0, 0), p(x, 0), p(x, y), p(0, y)], true)
    const fId = faceIds(g)[0]

    for (const tri of faceTriangles(g, fId)) {
      for (const pt of tri) {
        expect([0, x]).toContain(pt.x)
        expect([0, y]).toContain(pt.y)
      }
    }

    // 1e-9 innerhalb der echten Kante - aber ausserhalb des float32-Randes,
    // der schon bei 1234.56774902 endet
    const hits = raycast(g, down(x - 1e-9, y / 2), { kinds: ['face'] })
    expect(hits.length).toBe(1)
    expect(Math.abs(hits[0].point.x - x)).toBeLessThan(1e-8)
  })

  it('sieht verschobene Vertices sofort', () => {
    /*
     * Der raeumliche Index ist nur ueber die Primitivanzahlen signiert. Wird ein
     * Vertex bewegt, ohne dass sich eine Anzahl aendert, muss die Fassade den
     * Index verwerfen - sonst trifft der Strahl an der alten Stelle.
     */
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const fId = faceIds(g)[0]
    expect(raycast(g, down(2, 1.5), { kinds: ['face'] }).length).toBe(1)

    const vIds = Object.keys(g.vertices)
    moveVertices(g, vIds, p(100, 0, 0))

    expect(raycast(g, down(2, 1.5), { kinds: ['face'] })).toEqual([])
    const moved = raycast(g, down(102, 1.5), { kinds: ['face'] })
    expect(moved.length).toBe(1)
    expect(moved[0].id).toBe(fId)
  })
})

describe('raycast Unsinnseingaben', () => {
  it('liefert bei leerer Geometrie ein leeres Array', () => {
    expect(raycast(geom(), down(0, 0))).toEqual([])
  })

  it('wirft nicht bei NaN im Strahl', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    expect(raycast(g, { origin: p(NaN, 0, 5), dir: p(0, 0, -1) })).toEqual([])
    expect(raycast(g, { origin: p(2, 1.5, 5), dir: p(NaN, 0, -1) })).toEqual([])
    expect(raycast(g, { origin: p(2, 1.5, 5), dir: p(Infinity, 0, 0) })).toEqual([])
  })

  it('wirft nicht bei einem Strahl ohne Richtung', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    expect(raycast(g, { origin: p(2, 1.5, 5), dir: p(0, 0, 0) })).toEqual([])
  })

  it('liest NaN- und Minustoleranz als 0', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    const nan = raycast(g, down(2, 1.5), { tolerance: NaN, kinds: ['face'] })
    expect(nan.length).toBe(1)
    const negative = raycast(g, down(2, 1.5), { tolerance: -5, kinds: ['face'] })
    expect(negative.length).toBe(1)
    // eine negative Toleranz darf keinen Fangradius erzeugen
    expect(raycast(g, down(2, 0.05), { kinds: ['edge'], tolerance: -5 })).toEqual([])
  })

  it('wirft nicht bei leerer kinds-Liste', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    expect(raycast(g, down(2, 1.5), { kinds: [] })).toEqual([])
  })

  it('uebersteht eine Geometrie mit verwaisten Verweisen', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    // Kante von Hand kaputtmachen, wie es ein fehlerhafter Import tun koennte
    const eId = edgeIds(g)[0]
    g.edges[eId].a = 'weg'

    expect(() => raycast(g, down(2, 1.5), { tolerance: 0.1 })).not.toThrow()
  })
})
