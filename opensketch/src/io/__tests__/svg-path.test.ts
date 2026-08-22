/**
 * SVG-Pfadparser: jedes Kommando einzeln, absolut und relativ.
 *
 * Der Parser ist der empfindlichste Teil des SVG-Imports - ein falsch
 * gelesener Bogen oder ein vergessener Kontrollpunkt faellt beim Zeichnen
 * nicht auf, sondern erst, wenn jemand das Ergebnis bemasst.
 */

import { describe, expect, it } from 'vitest'
import { parsePath, tokenizePath, type Pt, type SubPath } from '../importers/svg-path'

function first(d: string): SubPath {
  const paths = parsePath(d)
  expect(paths.length, `"${d}" ergab keinen Teilpfad`).toBeGreaterThan(0)
  return paths[0]
}

/** Vergleicht eine Punktfolge auf 6 Nachkommastellen. */
function expectPoints(actual: Pt[], wanted: [number, number][]): void {
  expect(actual.length).toBe(wanted.length)
  actual.forEach((p, i) => {
    expect(p.x, `Punkt ${i}.x`).toBeCloseTo(wanted[i][0], 6)
    expect(p.y, `Punkt ${i}.y`).toBeCloseTo(wanted[i][1], 6)
  })
}

function last(points: Pt[]): Pt {
  return points[points.length - 1]
}

/* ------------------------------------------------------------------ */
/* Zerlegung                                                           */
/* ------------------------------------------------------------------ */

describe('tokenizePath', () => {
  it('trennt Kommando und Argumente', () => {
    expect(tokenizePath('M 10 20 L 30 40 Z')).toEqual([
      { command: 'M', args: [10, 20] },
      { command: 'L', args: [30, 40] },
      { command: 'Z', args: [] },
    ])
  })

  it('kommt ohne Trennzeichen aus', () => {
    expect(tokenizePath('M10,20L30-40z')).toEqual([
      { command: 'M', args: [10, 20] },
      { command: 'L', args: [30, -40] },
      { command: 'z', args: [] },
    ])
  })

  it('liest Dezimalzahlen ohne fuehrende Null und Exponenten', () => {
    expect(tokenizePath('M .5 -.5 L 1.5.25 1e2 2E-1')).toEqual([
      { command: 'M', args: [0.5, -0.5] },
      { command: 'L', args: [1.5, 0.25, 100, 0.2] },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* Geradlinige Kommandos                                               */
/* ------------------------------------------------------------------ */

describe('Pfadkommandos M L H V Z', () => {
  it('M und L absolut', () => {
    expectPoints(first('M 10 10 L 20 10 L 20 20').points, [
      [10, 10],
      [20, 10],
      [20, 20],
    ])
  })

  it('m und l relativ', () => {
    expectPoints(first('m 10 10 l 10 0 l 0 10').points, [
      [10, 10],
      [20, 10],
      [20, 20],
    ])
  })

  it('behandelt weitere Paare nach M als Linien', () => {
    // "M 0 0 5 5" ist ein moveto plus ein implizites lineto
    expectPoints(first('M 0 0 5 5 10 0').points, [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
    // relativ sind die impliziten Linien ebenfalls relativ
    expectPoints(first('m 1 1 2 0 0 2').points, [
      [1, 1],
      [3, 1],
      [3, 3],
    ])
  })

  it('wiederholt Argumentgruppen bei L', () => {
    expectPoints(first('M 0 0 L 1 0 2 0 3 0').points, [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ])
  })

  it('H und V absolut', () => {
    expectPoints(first('M 5 5 H 20 V 30').points, [
      [5, 5],
      [20, 5],
      [20, 30],
    ])
  })

  it('h und v relativ', () => {
    expectPoints(first('M 5 5 h 15 v 25').points, [
      [5, 5],
      [20, 5],
      [20, 30],
    ])
  })

  it('H und V nehmen mehrere Argumente an', () => {
    expectPoints(first('M 0 0 H 1 2 3').points, [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ])
  })

  it('Z schliesst den Teilpfad, ohne den Anfangspunkt zu doppeln', () => {
    const sub = first('M 0 0 L 10 0 L 10 10 Z')
    expect(sub.closed).toBe(true)
    expectPoints(sub.points, [
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  it('z setzt den Cursor auf den Anfang des Teilpfads zurueck', () => {
    // nach Z beginnt "l 5 0" relativ zum Startpunkt (10, 10)
    const paths = parsePath('M 10 10 L 20 10 L 20 20 z l 5 0 l 0 5')
    expect(paths.length).toBe(2)
    expect(paths[0].closed).toBe(true)
    expectPoints(paths[1].points, [
      [10, 10],
      [15, 10],
      [15, 15],
    ])
  })

  it('trennt mehrere Teilpfade an M', () => {
    const paths = parsePath('M 0 0 L 1 0 Z M 5 5 L 6 5 Z')
    expect(paths.length).toBe(2)
    expect(paths.every((p) => p.closed)).toBe(true)
    expectPoints(paths[1].points, [
      [5, 5],
      [6, 5],
    ])
  })
})

/* ------------------------------------------------------------------ */
/* Kurven                                                              */
/* ------------------------------------------------------------------ */

describe('Pfadkommandos C S Q T', () => {
  it('C laeuft vom Start zum Ende', () => {
    const points = first('M 0 0 C 0 10 10 10 10 0').points
    expectPoints([points[0]], [[0, 0]])
    expect(last(points).x).toBeCloseTo(10, 6)
    expect(last(points).y).toBeCloseTo(0, 6)
    // die Kurve beult zwischendurch aus, bleibt aber im Rahmen
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(5)
    expect(Math.max(...points.map((p) => p.y))).toBeLessThanOrEqual(10)
  })

  it('c ist die relative Fassung von C', () => {
    const absolute = first('M 5 5 C 5 15 15 15 15 5').points
    const relative = first('M 5 5 c 0 10 10 10 10 0').points
    expectPoints(relative, absolute.map((p) => [p.x, p.y]) as [number, number][])
  })

  it('C trifft die Bezier-Mitte exakt', () => {
    // Kontrollpunkte symmetrisch: t = 0,5 liegt bei (5, 7,5)
    const points = parsePath('M 0 0 C 0 10 10 10 10 0', { curveSegments: 2 })[0].points
    expectPoints(points, [
      [0, 0],
      [5, 7.5],
      [10, 0],
    ])
  })

  it('S spiegelt den Kontrollpunkt der vorigen Kurve', () => {
    // Vorige Kurve endet in (10,0) mit c2 = (10,10) -> gespiegelt (10,-10)
    const points = parsePath('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0', { curveSegments: 2 })[0].points
    const mid = points[3]
    expect(mid.x).toBeCloseTo(15, 6)
    expect(mid.y).toBeCloseTo(-7.5, 6)
    expect(last(points).x).toBeCloseTo(20, 6)
  })

  it('S ohne vorige Kurve benutzt den aktuellen Punkt als Kontrollpunkt', () => {
    const points = parsePath('M 0 0 S 10 10 10 0', { curveSegments: 2 })[0].points
    // c1 = (0,0), c2 = (10,10), Ende (10,0) -> t = 0,5 liegt bei (5, 3,75)
    expect(points[1].x).toBeCloseTo(5, 6)
    expect(points[1].y).toBeCloseTo(3.75, 6)
  })

  it('s ist die relative Fassung von S', () => {
    const absolute = parsePath('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0', { curveSegments: 4 })[0].points
    const relative = parsePath('M 0 0 c 0 10 10 10 10 0 s 10 -10 10 0', { curveSegments: 4 })[0].points
    expectPoints(relative, absolute.map((p) => [p.x, p.y]) as [number, number][])
  })

  it('Q trifft die quadratische Mitte exakt', () => {
    // t = 0,5 liegt bei (5, 5)
    const points = parsePath('M 0 0 Q 5 10 10 0', { curveSegments: 2 })[0].points
    expectPoints(points, [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
  })

  it('q ist die relative Fassung von Q', () => {
    const absolute = parsePath('M 2 2 Q 7 12 12 2', { curveSegments: 4 })[0].points
    const relative = parsePath('M 2 2 q 5 10 10 0', { curveSegments: 4 })[0].points
    expectPoints(relative, absolute.map((p) => [p.x, p.y]) as [number, number][])
  })

  it('T spiegelt den quadratischen Kontrollpunkt', () => {
    // Q-Kontrolle (5,10), Ende (10,0) -> T-Kontrolle gespiegelt (15,-10)
    const points = parsePath('M 0 0 Q 5 10 10 0 T 20 0', { curveSegments: 2 })[0].points
    const mid = points[3]
    expect(mid.x).toBeCloseTo(15, 6)
    expect(mid.y).toBeCloseTo(-5, 6)
    expect(last(points).x).toBeCloseTo(20, 6)
    expect(last(points).y).toBeCloseTo(0, 6)
  })

  it('t ist die relative Fassung von T', () => {
    const absolute = parsePath('M 0 0 Q 5 10 10 0 T 20 0', { curveSegments: 4 })[0].points
    const relative = parsePath('M 0 0 q 5 10 10 0 t 10 0', { curveSegments: 4 })[0].points
    expectPoints(relative, absolute.map((p) => [p.x, p.y]) as [number, number][])
  })

  it('folgt der Vorgabe fuer die Segmentzahl', () => {
    expect(parsePath('M 0 0 C 0 5 5 5 5 0', { curveSegments: 8 })[0].points.length).toBe(9)
    expect(parsePath('M 0 0 C 0 5 5 5 5 0', { curveSegments: 32 })[0].points.length).toBe(33)
  })
})

/* ------------------------------------------------------------------ */
/* Boegen                                                              */
/* ------------------------------------------------------------------ */

describe('Pfadkommando A', () => {
  it('faehrt einen Viertelkreis ab', () => {
    // von (10,0) nach (0,10) auf dem Einheitskreis mit Radius 10 um (0,0)
    const points = first('M 10 0 A 10 10 0 0 1 0 10').points
    expect(last(points).x).toBeCloseTo(0, 6)
    expect(last(points).y).toBeCloseTo(10, 6)
    for (const p of points) {
      expect(Math.hypot(p.x, p.y), 'Punkt liegt nicht auf dem Kreis').toBeCloseTo(10, 6)
    }
  })

  it('unterscheidet sweep 0 von sweep 1', () => {
    // Zwei Kreise mit Radius 10 gehen durch (10,0) und (0,10): einer um
    // (0,0), einer um (10,10). Das sweep-Flag waehlt aus, welcher benutzt
    // wird - beide kurzen Boegen enden gleich, woelben sich aber gegensinnig.
    const sweepOff = first('M 10 0 A 10 10 0 0 0 0 10').points
    const sweepOn = first('M 10 0 A 10 10 0 0 1 0 10').points
    expect(last(sweepOff).x).toBeCloseTo(0, 6)
    expect(last(sweepOn).x).toBeCloseTo(0, 6)
    for (const p of sweepOn) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6)
    for (const p of sweepOff) expect(Math.hypot(p.x - 10, p.y - 10)).toBeCloseTo(10, 6)
    // die Bogenmitten liegen auf verschiedenen Seiten der Sehne
    expect(sweepOn[3].x).toBeCloseTo(7.0710678, 6)
    expect(sweepOff[3].x).toBeCloseTo(2.9289322, 6)
  })

  it('unterscheidet large-arc 0 von large-arc 1', () => {
    const small = first('M 10 0 A 10 10 0 0 1 0 10').points
    const large = first('M 10 0 A 10 10 0 1 1 0 10').points
    // 270 Grad statt 90: dreimal so viele Segmente bei gleichem arcStep
    expect(large.length - 1).toBe((small.length - 1) * 3)
    // der grosse Bogen liegt auf dem anderen der beiden moeglichen Kreise
    for (const p of large) expect(Math.hypot(p.x - 10, p.y - 10)).toBeCloseTo(10, 6)
    expect(last(large).x).toBeCloseTo(0, 6)
    expect(last(large).y).toBeCloseTo(10, 6)
  })

  it('faehrt eine Ellipse mit unterschiedlichen Radien ab', () => {
    const points = first('M 20 0 A 20 10 0 0 1 -20 0').points
    expect(last(points).x).toBeCloseTo(-20, 6)
    for (const p of points) {
      expect((p.x / 20) ** 2 + (p.y / 10) ** 2).toBeCloseTo(1, 6)
    }
  })

  it('beachtet die Achsendrehung', () => {
    const upright = first('M 20 0 A 20 10 0 0 1 -20 0').points
    const turned = first('M 0 20 A 20 10 90 0 1 0 -20').points
    expect(turned.length).toBe(upright.length)
    // um 90 Grad gedreht: (x, y) -> (-y, x)
    turned.forEach((p, i) => {
      expect(p.x).toBeCloseTo(-upright[i].y, 6)
      expect(p.y).toBeCloseTo(upright[i].x, 6)
    })
  })

  it('vergroessert zu kleine Radien, statt aufzugeben', () => {
    // Radius 1 kann 20 Einheiten nicht ueberbruecken - SVG verlangt Skalieren
    const points = first('M 0 0 A 1 1 0 0 1 20 0').points
    expect(last(points).x).toBeCloseTo(20, 6)
    for (const p of points) {
      expect(Math.hypot(p.x - 10, p.y)).toBeCloseTo(10, 6)
    }
  })

  it('macht aus einem Bogen mit Radius 0 eine Gerade', () => {
    expectPoints(first('M 0 0 A 0 0 0 0 1 10 0').points, [
      [0, 0],
      [10, 0],
    ])
  })

  it('a ist die relative Fassung von A', () => {
    const absolute = first('M 10 0 A 10 10 0 0 1 0 10').points
    const relative = first('M 10 0 a 10 10 0 0 1 -10 10').points
    expectPoints(relative, absolute.map((p) => [p.x, p.y]) as [number, number][])
  })

  it('verdichtet den Bogen nach arcStep', () => {
    const coarse = first('M 10 0 A 10 10 0 1 1 -10 0')
    const fine = parsePath('M 10 0 A 10 10 0 1 1 -10 0', { arcStep: Math.PI / 90 })[0]
    expect(fine.points.length).toBeGreaterThan(coarse.points.length)
  })
})

/* ------------------------------------------------------------------ */
/* Robustheit                                                          */
/* ------------------------------------------------------------------ */

describe('Pfadparser, Randfaelle', () => {
  it('liefert bei leerem d nichts', () => {
    expect(parsePath('')).toEqual([])
    expect(parsePath('   ')).toEqual([])
  })

  it('verwirft Teilpfade mit nur einem Punkt', () => {
    expect(parsePath('M 5 5')).toEqual([])
    expect(parsePath('M 5 5 M 7 7 L 8 8').length).toBe(1)
  })

  it('ignoriert unvollstaendige Argumentgruppen', () => {
    // das letzte, halbe Paar faellt weg
    expectPoints(first('M 0 0 L 1 1 2').points, [
      [0, 0],
      [1, 1],
    ])
  })

  it('beginnt einen Pfad auch ohne fuehrendes M', () => {
    expectPoints(first('L 10 0 L 10 10').points, [
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  it('kommt mit Zeilenumbruechen und ueberfluessigen Leerzeichen zurecht', () => {
    const sub = first('M 0 0\n  L 10 0\n  L 10 10\n  Z\n')
    expect(sub.closed).toBe(true)
    expect(sub.points.length).toBe(3)
  })

  it('setzt die Kontrollpunkt-Spiegelung nach Z zurueck', () => {
    // nach Z gibt es keine vorige Kurve mehr: S benutzt den aktuellen Punkt
    const paths = parsePath('M 0 0 C 0 10 10 10 10 0 Z M 0 0 S 10 10 10 0', { curveSegments: 2 })
    expect(paths.length).toBe(2)
    expect(paths[1].points[1].x).toBeCloseTo(5, 6)
    expect(paths[1].points[1].y).toBeCloseTo(3.75, 6)
  })
})
