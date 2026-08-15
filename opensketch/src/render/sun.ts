/**
 * Sonnenstand nach dem NOAA Solar Calculator.
 *
 * Eingabe sind Datum, Ortszeit, geografische Breite/Laenge und Zeitzone aus
 * `SunSettings`; Ausgabe sind Azimut (im Uhrzeigersinn von Nord) und Elevation
 * ueber dem Horizont, sowie der daraus abgeleitete Richtungsvektor im
 * Modellkoordinatensystem (Z ist oben, +Y ist Norden bei `northAngle === 0`).
 *
 * Referenz: NOAA Global Monitoring Laboratory, "Solar Calculation Details".
 *
 * OWNERSHIP: Render-Entwickler.
 */

import type { SunSettings, Vec3Like } from '@/shared/types'

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

export interface SolarPosition {
  /** Grad, im Uhrzeigersinn von Nord (0 = Nord, 90 = Ost) */
  azimuth: number
  /** Grad ueber dem Horizont, negativ = unter dem Horizont */
  elevation: number
  /** Sonnendeklination in Grad */
  declination: number
  /** Zeitgleichung in Minuten */
  equationOfTime: number
  /** Sonnenaufgang / -untergang als Minuten seit Mitternacht (null = Polartag/-nacht) */
  sunrise: number | null
  sunset: number | null
  /** true, wenn die Sonne ueber dem Horizont steht */
  isUp: boolean
}

/* ------------------------------------------------------------------ */
/* Julianisches Datum                                                  */
/* ------------------------------------------------------------------ */

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  if (!m) return { year: 2024, month: 6, day: 21 }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { year: 2024, month: 6, day: 21 }
  }
  return { year, month, day }
}

/** Julianisches Datum um 00:00 UT des angegebenen Kalendertages. */
export function julianDay(year: number, month: number, day: number): number {
  let y = year
  let m = month
  if (m <= 2) {
    y -= 1
    m += 12
  }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5
}

/* ------------------------------------------------------------------ */
/* NOAA Kernrechnung                                                   */
/* ------------------------------------------------------------------ */

interface OrbitTerms {
  declination: number
  equationOfTime: number
  hourAngleSunrise: number | null
}

function orbitTerms(julianCentury: number, latitude: number): OrbitTerms {
  const t = julianCentury

  const geomMeanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const l0 = geomMeanLong < 0 ? geomMeanLong + 360 : geomMeanLong
  const geomMeanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

  const sunEqOfCtr =
    Math.sin(D2R * geomMeanAnom) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(D2R * 2 * geomMeanAnom) * (0.019993 - 0.000101 * t) +
    Math.sin(D2R * 3 * geomMeanAnom) * 0.000289

  const sunTrueLong = l0 + sunEqOfCtr
  const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(D2R * (125.04 - 1934.136 * t))

  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliqCorr = meanObliq + 0.00256 * Math.cos(D2R * (125.04 - 1934.136 * t))

  const declination = R2D * Math.asin(clampUnit(Math.sin(D2R * obliqCorr) * Math.sin(D2R * sunAppLong)))

  const varY = Math.tan(D2R * (obliqCorr / 2)) * Math.tan(D2R * (obliqCorr / 2))
  const equationOfTime =
    4 *
    R2D *
    (varY * Math.sin(2 * D2R * l0) -
      2 * eccent * Math.sin(D2R * geomMeanAnom) +
      4 * eccent * varY * Math.sin(D2R * geomMeanAnom) * Math.cos(2 * D2R * l0) -
      0.5 * varY * varY * Math.sin(4 * D2R * l0) -
      1.25 * eccent * eccent * Math.sin(2 * D2R * geomMeanAnom))

  // Stundenwinkel des Sonnenaufgangs (Zenit 90.833 Grad inkl. Refraktion)
  const cosHa =
    Math.cos(D2R * 90.833) / (Math.cos(D2R * latitude) * Math.cos(D2R * declination)) -
    Math.tan(D2R * latitude) * Math.tan(D2R * declination)
  const hourAngleSunrise = cosHa >= -1 && cosHa <= 1 ? R2D * Math.acos(cosHa) : null

  return { declination, equationOfTime, hourAngleSunrise }
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

/**
 * Atmosphaerische Refraktion in Grad, NOAA-Naeherung.
 * Sorgt dafuer, dass die Sonne am Horizont nicht abrupt verschwindet.
 */
function refraction(elevation: number): number {
  if (elevation > 85) return 0
  const te = Math.tan(D2R * elevation)
  let correction: number
  if (elevation > 5) {
    correction = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / (te * te * te * te * te)
  } else if (elevation > -0.575) {
    correction = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
  } else {
    correction = -20.772 / te
  }
  return correction / 3600
}

/** Vollstaendige Sonnenstandsberechnung fuer die Einstellungen aus dem Dokument. */
export function solarPosition(sun: SunSettings): SolarPosition {
  const { year, month, day } = parseIsoDate(sun.date)
  const latitude = clampNumber(sun.latitude, -89.9, 89.9, 52.52)
  const longitude = clampNumber(sun.longitude, -180, 180, 13.405)
  const timezone = clampNumber(sun.timezone, -14, 14, 0)
  const minutes = clampNumber(sun.time, 0, 1440, 720)

  // Julianisches Datum des Zeitpunkts in UT
  const jd = julianDay(year, month, day) + (minutes - timezone * 60) / 1440
  const t = (jd - 2451545) / 36525

  const { declination, equationOfTime, hourAngleSunrise } = orbitTerms(t, latitude)

  const trueSolarTime = mod(minutes + equationOfTime + 4 * longitude - 60 * timezone, 1440)
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180

  const cosZenith =
    Math.sin(D2R * latitude) * Math.sin(D2R * declination) +
    Math.cos(D2R * latitude) * Math.cos(D2R * declination) * Math.cos(D2R * hourAngle)
  const zenith = R2D * Math.acos(clampUnit(cosZenith))
  const rawElevation = 90 - zenith
  const elevation = rawElevation + refraction(rawElevation)

  let azimuth: number
  const denom = Math.cos(D2R * latitude) * Math.sin(D2R * zenith)
  if (Math.abs(denom) > 1e-9) {
    const inner = clampUnit((Math.sin(D2R * latitude) * Math.cos(D2R * zenith) - Math.sin(D2R * declination)) / denom)
    const acos = R2D * Math.acos(inner)
    azimuth = hourAngle > 0 ? mod(acos + 180, 360) : mod(540 - acos, 360)
  } else {
    azimuth = latitude > 0 ? 180 : 0
  }

  // Sonnenauf-/-untergang als Ortszeit in Minuten
  let sunrise: number | null = null
  let sunset: number | null = null
  if (hourAngleSunrise !== null) {
    const solarNoon = 720 - 4 * longitude - equationOfTime + timezone * 60
    sunrise = solarNoon - hourAngleSunrise * 4
    sunset = solarNoon + hourAngleSunrise * 4
  }

  return {
    azimuth,
    elevation,
    declination,
    equationOfTime,
    sunrise,
    sunset,
    isUp: elevation > 0,
  }
}

function clampNumber(v: number, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return v < lo ? lo : v > hi ? hi : v
}

function mod(a: number, n: number): number {
  const r = a % n
  return r < 0 ? r + n : r
}

/* ------------------------------------------------------------------ */
/* Umrechnung in Modellkoordinaten                                     */
/* ------------------------------------------------------------------ */

/**
 * Einheitsvektor vom Modell ZUR Sonne, im Modellkoordinatensystem.
 *
 * Grundlage ist ein geografischer Rahmen mit +Y = Nord, +X = Ost, +Z = oben.
 * `northAngle` gibt an, um wie viel Grad die Nordrichtung des Modells im
 * Uhrzeigersinn gegenueber +Y gedreht ist; der Vektor wird entsprechend
 * mitgedreht (Drehung um -northAngle um die Z-Achse, weil "im Uhrzeigersinn"
 * in einem rechtshaendigen System mit Z oben negativ ist).
 */
export function sunVector(position: SolarPosition, northAngle: number): Vec3Like {
  const el = D2R * position.elevation
  const az = D2R * position.azimuth
  const cosEl = Math.cos(el)
  // geografischer Rahmen: Azimut im Uhrzeigersinn von Nord (+Y)
  const gx = cosEl * Math.sin(az)
  const gy = cosEl * Math.cos(az)
  const gz = Math.sin(el)

  const a = -D2R * (Number.isFinite(northAngle) ? northAngle : 0)
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: gx * c - gy * s, y: gx * s + gy * c, z: gz }
}

/** Richtung, in die das Sonnenlicht faellt (entgegengesetzt zu `sunVector`). */
export function sunLightDirection(position: SolarPosition, northAngle: number): Vec3Like {
  const v = sunVector(position, northAngle)
  return { x: -v.x, y: -v.y, z: -v.z }
}

/** Nordrichtung des Modells als Einheitsvektor in der XY-Ebene. */
export function northVector(northAngle: number): Vec3Like {
  const a = -D2R * (Number.isFinite(northAngle) ? northAngle : 0)
  return { x: -Math.sin(a), y: Math.cos(a), z: 0 }
}
