/**
 * Sonnenstand nach NOAA.
 *
 * Geprueft werden Groessenordnungen, die sich aus der Astronomie ergeben und
 * nicht von der Implementierung abhaengen: Sonnenhoechststand zur Mittagszeit,
 * Deklination zu den Sonnenwenden, Auf-/Untergang, Polarnacht und die
 * Umrechnung in Modellkoordinaten inklusive Nordwinkel.
 */

import { describe, expect, it } from 'vitest'
import { V } from '@/core/math'
import type { SunSettings } from '@/shared/types'
import { DEFAULT_SUN } from '../defaults'
import { julianDay, northVector, solarPosition, sunLightDirection, sunVector } from '../sun'

function sun(patch: Partial<SunSettings>): SunSettings {
  return { ...DEFAULT_SUN, ...patch }
}

describe('julianDay', () => {
  it('trifft die bekannten Stuetzstellen', () => {
    expect(julianDay(2000, 1, 1)).toBeCloseTo(2451544.5, 6)
    expect(julianDay(2024, 6, 21)).toBeCloseTo(2460482.5, 6)
  })

  it('ist streng monoton', () => {
    expect(julianDay(2024, 3, 1)).toBeGreaterThan(julianDay(2024, 2, 29))
    expect(julianDay(2024, 2, 29)).toBeGreaterThan(julianDay(2024, 2, 28))
  })
})

describe('solarPosition', () => {
  it('steht in Berlin zur Sommersonnenwende mittags hoch im Sueden', () => {
    const p = solarPosition(sun({ date: '2024-06-21', time: 13 * 60, timezone: 2, latitude: 52.52, longitude: 13.405 }))
    // Maximale Hoehe = 90 - Breite + Deklination = 90 - 52.52 + 23.44 ~ 60.9
    expect(p.elevation).toBeGreaterThan(58)
    expect(p.elevation).toBeLessThan(63)
    expect(p.azimuth).toBeGreaterThan(160)
    expect(p.azimuth).toBeLessThan(200)
    expect(p.declination).toBeGreaterThan(23.2)
    expect(p.declination).toBeLessThan(23.5)
    expect(p.isUp).toBe(true)
  })

  it('steht zur Wintersonnenwende deutlich tiefer', () => {
    const winter = solarPosition(sun({ date: '2024-12-21', time: 12 * 60, timezone: 1 }))
    expect(winter.declination).toBeLessThan(-23.2)
    expect(winter.elevation).toBeGreaterThan(10)
    expect(winter.elevation).toBeLessThan(16)
  })

  it('steht am Aequator zur Tagundnachtgleiche fast im Zenit', () => {
    const p = solarPosition(sun({ date: '2024-03-20', time: 12 * 60, timezone: 0, latitude: 0, longitude: 0 }))
    expect(p.elevation).toBeGreaterThan(88)
    expect(Math.abs(p.declination)).toBeLessThan(0.6)
  })

  it('liefert nachts eine negative Hoehe', () => {
    const p = solarPosition(sun({ date: '2024-06-21', time: 0, timezone: 2 }))
    expect(p.elevation).toBeLessThan(0)
    expect(p.isUp).toBe(false)
  })

  it('liefert Auf- und Untergang symmetrisch um den Sonnenhoechststand', () => {
    const p = solarPosition(sun({ date: '2024-06-21', time: 12 * 60, timezone: 2 }))
    expect(p.sunrise).not.toBeNull()
    expect(p.sunset).not.toBeNull()
    const sunrise = p.sunrise as number
    const sunset = p.sunset as number
    expect(sunrise).toBeLessThan(sunset)
    // Berlin, 21. Juni: gut 16 Stunden Tageslicht
    expect((sunset - sunrise) / 60).toBeGreaterThan(15.5)
    expect((sunset - sunrise) / 60).toBeLessThan(17.5)
  })

  it('erkennt den Polartag', () => {
    const p = solarPosition(sun({ date: '2024-06-21', time: 12 * 60, latitude: 85, longitude: 0, timezone: 0 }))
    expect(p.sunrise).toBeNull()
    expect(p.sunset).toBeNull()
    expect(p.isUp).toBe(true)
  })

  it('faengt unsinnige Eingaben ab', () => {
    const p = solarPosition(sun({ date: 'kaputt', time: Number.NaN, latitude: Number.POSITIVE_INFINITY }))
    expect(Number.isFinite(p.elevation)).toBe(true)
    expect(Number.isFinite(p.azimuth)).toBe(true)
  })
})

describe('sunVector', () => {
  it('zeigt bei 90 Grad Hoehe nach oben', () => {
    const v = sunVector({ azimuth: 180, elevation: 90, declination: 0, equationOfTime: 0, sunrise: null, sunset: null, isUp: true }, 0)
    expect(v.z).toBeCloseTo(1, 6)
    expect(Math.hypot(v.x, v.y)).toBeLessThan(1e-6)
  })

  it('zeigt bei Azimut 0 nach Norden - auch bei gedrehtem Nordwinkel', () => {
    for (const northAngle of [0, 45, 90, 180, -30]) {
      const v = sunVector(
        { azimuth: 0, elevation: 0, declination: 0, equationOfTime: 0, sunrise: null, sunset: null, isUp: true },
        northAngle,
      )
      const north = northVector(northAngle)
      expect(V.dot(v, north)).toBeCloseTo(1, 6)
    }
  })

  it('liefert einen Einheitsvektor', () => {
    const p = solarPosition(sun({ date: '2024-09-10', time: 9 * 60 }))
    expect(V.length(sunVector(p, 33))).toBeCloseTo(1, 9)
  })

  it('Lichtrichtung ist die Gegenrichtung', () => {
    const p = solarPosition(sun({ date: '2024-09-10', time: 15 * 60 }))
    const to = sunVector(p, 0)
    const light = sunLightDirection(p, 0)
    expect(light.x).toBeCloseTo(-to.x, 9)
    expect(light.y).toBeCloseTo(-to.y, 9)
    expect(light.z).toBeCloseTo(-to.z, 9)
  })
})

describe('northVector', () => {
  it('ist bei 0 Grad die +Y-Achse und dreht im Uhrzeigersinn', () => {
    const n0 = northVector(0)
    expect(n0.x).toBeCloseTo(0, 9)
    expect(n0.y).toBeCloseTo(1, 9)
    const n90 = northVector(90)
    expect(n90.x).toBeCloseTo(1, 9)
    expect(n90.y).toBeCloseTo(0, 9)
  })
})
