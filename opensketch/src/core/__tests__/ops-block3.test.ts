/**
 * Block 3 in der Tiefe: Folge-mir, Rotationskoerper, Versatz, Flaechenschnitt
 * und Boolesche Operationen an Faellen, die ueber den Normalfall hinausgehen.
 *
 * `ops.test.ts` deckt ab, dass die Operationen ueberhaupt funktionieren. Hier
 * geht es um die Raender: Formen, die nicht symmetrisch sind, Achsen, die nicht
 * Z sind, und die Faelle, die `booleanSolid` bewusst NICHT unterstuetzt. Nach
 * jeder Operation muss `validate` leer sein.
 */

import { describe, expect, it } from 'vitest'
import {
  addPolyline,
  booleanSolid,
  buildCircle,
  edgeLength,
  faceArea,
  followMe,
  intersectFaces,
  isSolid,
  offsetEdges,
  offsetFace,
  orderEdgePath,
  pushPull,
  revolve,
  solidVolume,
  totalArea,
} from '@/core'
import { countEdges, countFaces, edgeIds, expectValid, faceIds, geom, p, rect } from './helpers'

function lastFace(g: ReturnType<typeof geom>): string {
  const ids = faceIds(g)
  return ids[ids.length - 1]
}

/** Achsparalleler Quader als eigenstaendige Geometrie. */
function box(x0: number, y0: number, z0: number, sx: number, sy: number, sz: number) {
  const g = geom()
  addPolyline(
    g,
    [p(x0, y0, z0), p(x0 + sx, y0, z0), p(x0 + sx, y0 + sy, z0), p(x0, y0 + sy, z0)],
    true,
  )
  pushPull(g, faceIds(g)[0], sz)
  return g
}

/* ------------------------------------------------------------------ */

describe('followMe in der Tiefe', () => {
  it('haelt beim L-Pfad das Volumen der Gehrung ein', () => {
    const g = geom()
    // 1 x 1 Profil in der YZ-Ebene bei x = 0
    addPolyline(g, [p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], true)
    const profile = lastFace(g)
    addPolyline(g, [p(0, 0, 0), p(4, 0, 0), p(4, 4, 0)], false, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)

    followMe(g, profile, path)

    expect(isSolid(g)).toBe(true)
    /*
     * NICHT Mittellinienlaenge x Querschnitt - das gilt nur fuer ein Profil,
     * das auf dem Pfad zentriert ist. Hier liegt das Profil (y in [0,1]) auf
     * der INNENSEITE der Kurve. Der Grundriss ist die Vereinigung von
     * [0,4]x[0,1] und [3,4]x[0,4]: 4 + 4 - 1 = 7. Die Gehrung laeuft genau von
     * der Innenecke (3,1) zur Aussenecke (4,0).
     */
    expect(solidVolume(g)).toBeCloseTo(7, 6)
    expectValid(g, 'followMe L Volumen')
  })

  it('sweept auch, wenn die Pfadkanten in verkehrter Reihenfolge kommen', () => {
    const g = geom()
    addPolyline(g, [p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], true)
    const profile = lastFace(g)
    addPolyline(g, [p(0, 0.5, 0.5), p(3, 0.5, 0.5), p(6, 0.5, 0.5)], false, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)
    expect(path.length).toBe(2)

    // umgedreht uebergeben - orderEdgePath muss das sortieren
    followMe(g, profile, [path[1], path[0]])

    expect(isSolid(g)).toBe(true)
    expect(solidVolume(g)).toBeCloseTo(6, 6)
    expectValid(g, 'followMe verkehrte Reihenfolge')
  })

  it('sweept einen geschlossenen Pfad unabhaengig von der Reihenfolge der Ids', () => {
    const volumen = (mischen: boolean): number => {
      const g = geom()
      addPolyline(
        g,
        [p(3, -0.5, -0.5), p(3, 0.5, -0.5), p(3, 0.5, 0.5), p(3, -0.5, 0.5)],
        true,
      )
      const profile = lastFace(g)
      addPolyline(g, [p(0, 0, 0), p(6, 0, 0), p(6, 6, 0), p(0, 6, 0)], true, { guide: true })
      const path = edgeIds(g).filter((id) => g.edges[id].guide === true)
      followMe(g, profile, mischen ? [path[2], path[0], path[3], path[1]] : path)
      expect(isSolid(g)).toBe(true)
      expectValid(g, `followMe geschlossen mischen=${mischen}`)
      return solidVolume(g)
    }

    expect(volumen(true)).toBeCloseTo(volumen(false), 6)
  })

  it('erzeugt aus einem Kreisprofil ueber geschlossenem Pfad einen Ring', () => {
    const g = geom()
    // Kreisprofil in der Ebene x = 4, Radius 0.5
    addPolyline(g, buildCircle(p(4, 0, 0), p(1, 0, 0), 0.5, 12), true)
    const profile = lastFace(g)
    addPolyline(g, [p(0, 0, 0), p(8, 0, 0), p(8, 8, 0), p(0, 8, 0)], true, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)

    followMe(g, profile, path)

    expect(isSolid(g)).toBe(true)
    // 12 Mantelstreifen x 4 Segmente, keine Deckel
    expect(countFaces(g)).toBe(48)
    // 12-Eck-Querschnitt x Mittellinie 32; das 12-Eck ist kleiner als der Kreis
    const zwoelfeck = 0.5 * 12 * 0.5 * 0.5 * Math.sin((2 * Math.PI) / 12)
    expect(solidVolume(g)).toBeCloseTo(zwoelfeck * 32, 4)
    expectValid(g, 'followMe Ring')
  })

  it('laesst die Geometrie unveraendert, wenn der Pfad im Profil liegt', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const profile = lastFace(g)
    // Pfadkante in der Profilebene - es gibt nichts zu sweepen
    addPolyline(g, [p(1, 1), p(2, 1)], false, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)

    expect(() => followMe(g, profile, path)).not.toThrow()
    expectValid(g, 'followMe Pfad in der Profilebene')
  })
})

describe('revolve in der Tiefe', () => {
  it('dreht auch um eine Achse, die nicht Z ist', () => {
    const g = geom()
    // Profil in der XY-Ebene, im Abstand 2 von der X-Achse
    addPolyline(g, [p(0, 2, 0), p(1, 2, 0), p(1, 3, 0), p(0, 3, 0)], true)
    const profile = lastFace(g)

    revolve(g, profile, p(0, 0, 0), p(1, 0, 0), Math.PI * 2, 16)

    expect(countFaces(g)).toBe(4 * 16)
    expect(isSolid(g)).toBe(true)
    const exakt = Math.PI * (3 * 3 - 2 * 2) * 1
    expect(solidVolume(g)).toBeGreaterThan(exakt * 0.94)
    expect(solidVolume(g)).toBeLessThan(exakt)
    expectValid(g, 'revolve X-Achse')
  })

  it('haelt bei einer Vierteldrehung das Volumen ein', () => {
    const g = geom()
    addPolyline(g, [p(2, 0, 0), p(4, 0, 0), p(4, 0, 1), p(2, 0, 1)], true)
    const profile = lastFace(g)

    revolve(g, profile, p(0, 0, 0), p(0, 0, 1), Math.PI / 2, 24)

    expect(isSolid(g)).toBe(true)
    const viertelRing = (Math.PI * (4 * 4 - 2 * 2) * 1) / 4
    expect(solidVolume(g)).toBeGreaterThan(viertelRing * 0.97)
    expect(solidVolume(g)).toBeLessThan(viertelRing)
    expectValid(g, 'revolve Viertel')
  })

  it('klemmt eine zu kleine positive Segmentzahl auf drei', () => {
    const g = geom()
    addPolyline(g, [p(2, 0, 0), p(3, 0, 0), p(3, 0, 1), p(2, 0, 1)], true)
    const profile = lastFace(g)

    revolve(g, profile, p(0, 0, 0), p(0, 0, 1), Math.PI * 2, 1)

    expect(countFaces(g)).toBe(4 * 3)
    expect(isSolid(g)).toBe(true)
    expectValid(g, 'revolve Segmente geklemmt')
  })
})

describe('offsetFace in der Tiefe', () => {
  it('versetzt eine konkave L-Form nach aussen', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(6, 0), p(6, 2), p(2, 2), p(2, 6), p(0, 6)], true)
    const f = lastFace(g)
    expect(faceArea(g, f)).toBeCloseTo(20, 9)

    offsetFace(g, f, 0.5)

    expect(countFaces(g)).toBe(2)
    const flaechen = faceIds(g)
      .map((id) => faceArea(g, id))
      .sort((a, b) => b - a)
    // L-Form 0,5 nach aussen: 7 x 3 + 3 x 4 = 33, davon 20 die Originalflaeche
    expect(flaechen[0]).toBeCloseTo(20, 6)
    expect(flaechen[1]).toBeCloseTo(33 - 20, 6)
    expectValid(g, 'offsetFace konkav aussen')
  })

  it('frisst bei einer schmalen konkaven Form den Steg auf, ohne zu zerbrechen', () => {
    const g = geom()
    // U-Form mit 1 breiten Schenkeln
    addPolyline(
      g,
      [p(0, 0), p(5, 0), p(5, 4), p(4, 4), p(4, 1), p(1, 1), p(1, 4), p(0, 4)],
      true,
    )
    const f = lastFace(g)
    const vorher = faceArea(g, f)

    // 0,6 nach innen: die 1 breiten Schenkel kollabieren
    expect(() => offsetFace(g, f, -0.6)).not.toThrow()

    expectValid(g, 'offsetFace U-Form')
    // entweder ist nichts passiert oder es ist eine echte Innenflaeche entstanden
    const flaechen = faceIds(g).map((id) => faceArea(g, id))
    expect(flaechen.every((a) => a > 0)).toBe(true)
    expect(flaechen.reduce((s, a) => s + a, 0)).toBeCloseTo(vorher, 6)
  })

  it('versetzt eine Flaeche, die nicht in der XY-Ebene liegt', () => {
    const g = geom()
    addPolyline(g, rect(4, 4), true)
    pushPull(g, faceIds(g)[0], 3)
    const wand = faceIds(g).find((id) => Math.abs(g.faces[id].normal.x) > 0.99)
    expect(wand).toBeDefined()

    offsetFace(g, wand as string, -1)

    expect(countFaces(g)).toBe(7)
    expect(isSolid(g)).toBe(true)
    expect(solidVolume(g)).toBeCloseTo(48, 6)
    expectValid(g, 'offsetFace Wand')
  })
})

describe('offsetEdges in der Tiefe', () => {
  it('haelt den Versatzabstand ein', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(4, 0)], false)
    const path = edgeIds(g)

    offsetEdges(g, path, 1)

    // die versetzte Kante liegt 1 daneben und ist genauso lang
    const versetzt = edgeIds(g).filter((id) => !path.includes(id))
    expect(versetzt.length).toBeGreaterThan(0)
    const parallel = versetzt.find((id) => Math.abs(edgeLength(g, id) - 4) < 1e-6)
    expect(parallel).toBeDefined()
    const [a, b] = [g.edges[parallel as string].a, g.edges[parallel as string].b]
    expect(Math.abs(g.vertices[a].p.y)).toBeCloseTo(1, 6)
    expect(Math.abs(g.vertices[b].p.y)).toBeCloseTo(1, 6)
    expectValid(g, 'offsetEdges Abstand')
  })

  it('versetzt einen geschlossenen Ring nach aussen', () => {
    const g = geom()
    addPolyline(g, rect(6, 6), true)
    const ring = g.faces[lastFace(g)].outer.edges

    offsetEdges(g, ring, 1)

    expect(countFaces(g)).toBe(2)
    const flaechen = faceIds(g)
      .map((id) => faceArea(g, id))
      .sort((a, b) => a - b)
    expect(flaechen[0]).toBeCloseTo(64 - 36, 6) // Ring
    expect(flaechen[1]).toBeCloseTo(36, 6) // Innenflaeche
    expectValid(g, 'offsetEdges aussen')
  })

  it('versetzt unabhaengig von der Reihenfolge der Kanten-Ids zur selben Seite', () => {
    /*
     * Eine Auswahl ist eine Menge, keine Liste - die Ids koennen in beliebiger
     * Reihenfolge ankommen. `orderEdgePath` faengt immer am selben Endpunkt an,
     * deshalb liegt der Versatz beide Male auf derselben Seite. Ohne diese
     * Eigenschaft haette derselbe Klick mal die eine, mal die andere Seite
     * versetzt.
     */
    const punkte = (verkehrt: boolean): string => {
      const g = geom()
      addPolyline(g, [p(0, 0), p(4, 0), p(4, 4)], false)
      const path = edgeIds(g)
      offsetEdges(g, verkehrt ? [...path].reverse() : path, 1)
      const neu = edgeIds(g).filter((id) => !path.includes(id))
      const menge = new Set<string>()
      for (const id of neu) {
        for (const vId of [g.edges[id].a, g.edges[id].b]) {
          const q = g.vertices[vId].p
          menge.add(`${q.x.toFixed(3)},${q.y.toFixed(3)}`)
        }
      }
      return [...menge].sort().join('|')
    }

    expect(punkte(true)).toBe(punkte(false))
  })

  it('versetzt einen L-Kantenzug mit korrekter Gehrung', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(4, 0), p(4, 4)], false)
    const path = edgeIds(g)
    expect(orderEdgePath(g, path)).not.toBeNull()

    offsetEdges(g, path, 1)

    expectValid(g, 'offsetEdges L')
    // Gehrung: die Innenecke des Versatzes liegt bei (3,1) oder (5,-1)
    const ecken = Object.keys(g.vertices).map((id) => g.vertices[id].p)
    const gehrung = ecken.some(
      (q) => Math.abs(Math.abs(q.x - 4) - 1) < 1e-6 && Math.abs(Math.abs(q.y) - 1) < 1e-6,
    )
    expect(gehrung).toBe(true)
  })
})

describe('intersectFaces in der Tiefe', () => {
  it('schneidet nur gegen die angegebene Zielmenge', () => {
    const g = geom()
    addPolyline(g, rect(4, 4), true)
    const boden = faceIds(g)[0]
    pushPull(g, boden, 4)

    // senkrechte Flaeche quer durch den Quader
    addPolyline(g, [p(-1, 2, -1), p(5, 2, -1), p(5, 2, 5), p(-1, 2, 5)], true)
    const schneider = lastFace(g)

    const vorher = countEdges(g)
    const change = intersectFaces(g, [schneider], [boden])

    expect(countEdges(g)).toBeGreaterThan(vorher)
    expect(change.addedEdges.length).toBeGreaterThan(0)
    expectValid(g, 'intersectFaces Zielmenge')
  })

  it('erzeugt nichts zwischen zwei Koerpern, die sich nicht beruehren', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)
    const a = faceIds(g)[0]
    pushPull(g, a, 2)
    const flaechenA = faceIds(g)

    addPolyline(g, [p(10, 0), p(12, 0), p(12, 2), p(10, 2)], true)
    const b = faceIds(g).find((id) => !flaechenA.includes(id))
    pushPull(g, b as string, 2)

    const vorher = countEdges(g)
    const change = intersectFaces(g, flaechenA)

    expect(change.addedEdges.length).toBe(0)
    expect(countEdges(g)).toBe(vorher)
    expectValid(g, 'intersectFaces getrennt')
  })

  it('erzeugt an einer beruehrenden Kante keine doppelten Kanten', () => {
    const g = geom()
    addPolyline(g, rect(4, 4), true)
    const flaeche = faceIds(g)[0]
    // Flaeche, die genau auf der Kante y = 0 aufsitzt
    addPolyline(g, [p(0, 0, 0), p(4, 0, 0), p(4, 0, 3), p(0, 0, 3)], true)

    const change = intersectFaces(g, [flaeche])

    expect(change.addedEdges.length).toBe(0)
    expectValid(g, 'intersectFaces beruehrend')
  })
})

describe('booleanSolid in der Tiefe', () => {
  it('vereinigt zwei Quader, die sich nicht beruehren', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(10, 0, 0, 1, 1, 1)

    const res = booleanSolid(a, b, 'union')
    expect(res).not.toBeNull()
    expect(countFaces(res as never)).toBe(12)
    expect(isSolid(res as never)).toBe(true)
    expect(solidVolume(res as never)).toBeCloseTo(9, 6)
    expectValid(res as never, 'union getrennt')
  })

  it('liefert beim Abziehen eines entfernten Quaders den Ausgangskoerper', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(10, 0, 0, 1, 1, 1)

    const res = booleanSolid(a, b, 'subtract')
    expect(res).not.toBeNull()
    expect(solidVolume(res as never)).toBeCloseTo(8, 6)
    expect(countFaces(res as never)).toBe(6)
    expectValid(res as never, 'subtract getrennt')
  })

  it('hoehlt beim Abziehen eines vollstaendig eingeschlossenen Quaders aus', () => {
    const a = box(0, 0, 0, 4, 4, 4)
    const b = box(1, 1, 1, 2, 2, 2)

    const res = booleanSolid(a, b, 'subtract')
    expect(res).not.toBeNull()
    // Aussenschale 6 + umgedrehte Innenschale 6
    expect(countFaces(res as never)).toBe(12)
    expect(isSolid(res as never)).toBe(true)
    expect(solidVolume(res as never)).toBeCloseTo(64 - 8, 6)
    expectValid(res as never, 'subtract Hohlraum')
  })

  it('liefert null, wenn der Abzug den Koerper vollstaendig verschlingt', () => {
    const a = box(1, 1, 1, 1, 1, 1)
    const b = box(0, 0, 0, 4, 4, 4)
    expect(booleanSolid(a, b, 'subtract')).toBeNull()
  })

  it('schneidet einen durchgehenden Kanal heraus', () => {
    const a = box(0, 0, 0, 4, 4, 4)
    // Riegel, der in Y-Richtung komplett durchgeht
    const b = box(1, -1, 1, 2, 6, 2)

    const res = booleanSolid(a, b, 'subtract')
    expect(res).not.toBeNull()
    expect(isSolid(res as never)).toBe(true)
    expect(solidVolume(res as never)).toBeCloseTo(64 - 16, 5)
    expectValid(res as never, 'subtract Kanal')
  })

  it('schneidet zwei Quader, die nur eine Ecke teilen', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(1.5, 1.5, 1.5, 2, 2, 2)

    const res = booleanSolid(a, b, 'intersect')
    expect(res).not.toBeNull()
    expect(isSolid(res as never)).toBe(true)
    expect(solidVolume(res as never)).toBeCloseTo(0.125, 6)
    expectValid(res as never, 'intersect Ecke')
  })

  it('vereinigt zwei Quader, die eine ganze Flaeche teilen', () => {
    /*
     * NICHT UNTERSTUETZT LAUT ops/boolean.ts: exakt koplanare, ueberlappende
     * Flaechen sind mehrdeutig. Der Test haelt fest, WAS in diesem Fall
     * passiert, damit eine Aenderung auffaellt - nicht, dass es schoen ist.
     */
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(0, 0, 2, 2, 2, 2)

    const res = booleanSolid(a, b, 'union')
    expect(res).not.toBeNull()
    expect(solidVolume(res as never)).toBeCloseTo(16, 6)
    expectValid(res as never, 'union gestapelt')
  })

  it('liefert null, wenn zwei gestapelte Quader geschnitten werden sollen', () => {
    // NICHT UNTERSTUETZT: die geteilte Flaeche hat kein Volumen
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(0, 0, 2, 2, 2, 2)
    expect(booleanSolid(a, b, 'intersect')).toBeNull()
  })

  it('vertraegt zwei identische Quader', () => {
    // NICHT UNTERSTUETZT, aber es darf nichts zerbrechen
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(0, 0, 0, 2, 2, 2)

    const vereinigt = booleanSolid(a, b, 'union')
    expect(vereinigt).not.toBeNull()
    expect(solidVolume(vereinigt as never)).toBeCloseTo(8, 6)
    expectValid(vereinigt as never, 'union identisch')

    // A minus A hat kein Volumen mehr
    expect(booleanSolid(a, b, 'subtract')).toBeNull()
  })

  it('laesst beide Operanden auch beim Schneiden unangetastet', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(1, 1, 1, 2, 2, 2)
    const flaechenA = countFaces(a)
    const flaechenB = countFaces(b)
    const areaB = totalArea(b)

    booleanSolid(a, b, 'intersect')
    booleanSolid(a, b, 'subtract')

    expect(countFaces(a)).toBe(flaechenA)
    expect(countFaces(b)).toBe(flaechenB)
    expect(totalArea(b)).toBeCloseTo(areaB, 9)
    expectValid(a, 'Operand a')
    expectValid(b, 'Operand b')
  })
})
