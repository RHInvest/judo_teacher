/**
 * SVG-Pfadparser.
 *
 * Unterstuetzt alle Kommandos in absoluter und relativer Schreibweise:
 * `M m L l H h V v C c S s Q q T t A a Z z`. Kurven werden gleichmaessig
 * diskretisiert, Boegen ueber die Endpunkt-Parametrisierung aus dem
 * SVG-Standard (Anhang F.6) in Kreisboegen umgerechnet.
 *
 * Ergebnis sind Konturen in SVG-Nutzerkoordinaten; das Umrechnen in
 * Modellkoordinaten macht der Importer.
 */

export interface Pt {
  x: number
  y: number
}

export interface SubPath {
  points: Pt[]
  closed: boolean
}

export interface PathOptions {
  /** Segmente je Bezier-Kurve */
  curveSegments?: number
  /** maximaler Winkel je Bogensegment in Radiant */
  arcStep?: number
}

const DEFAULT_CURVE_SEGMENTS = 16
const DEFAULT_ARC_STEP = Math.PI / 12

/** Zerlegt `d` in Kommandos. */
export function tokenizePath(d: string): { command: string; args: number[] }[] {
  const out: { command: string; args: number[] }[] = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(d)) !== null) {
    const command = match[1]
    const args: number[] = []
    const numberRe = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g
    let numberMatch: RegExpExecArray | null
    while ((numberMatch = numberRe.exec(match[2])) !== null) {
      const value = parseFloat(numberMatch[0])
      if (Number.isFinite(value)) args.push(value)
    }
    out.push({ command, args })
  }
  return out
}

export function parsePath(d: string, opts: PathOptions = {}): SubPath[] {
  const segments = Math.max(2, opts.curveSegments ?? DEFAULT_CURVE_SEGMENTS)
  const arcStep = opts.arcStep ?? DEFAULT_ARC_STEP

  const paths: SubPath[] = []
  let current: SubPath | null = null
  let cursor: Pt = { x: 0, y: 0 }
  let start: Pt = { x: 0, y: 0 }
  // letzter Kontrollpunkt fuer S/T
  let lastCubic: Pt | null = null
  let lastQuadratic: Pt | null = null

  const begin = (p: Pt): void => {
    current = { points: [{ ...p }], closed: false }
    paths.push(current)
  }
  const lineTo = (p: Pt): void => {
    if (!current) begin(cursor)
    current!.points.push({ ...p })
  }

  for (const { command, args } of tokenizePath(d)) {
    const relative = command === command.toLowerCase() && command !== 'Z' && command !== 'z'
    const upper = command.toUpperCase()

    if (upper === 'Z') {
      if (current) {
        current.closed = true
        cursor = { ...start }
      }
      current = null
      lastCubic = null
      lastQuadratic = null
      continue
    }

    const step = ARG_COUNT[upper] ?? 2
    // Wiederholte Argumentgruppen: "L 1 2 3 4" = zwei Liniensegmente
    for (let i = 0; i + step <= args.length; i += step) {
      const a = args.slice(i, i + step)
      switch (upper) {
        case 'M': {
          const p = relative ? { x: cursor.x + a[0], y: cursor.y + a[1] } : { x: a[0], y: a[1] }
          if (i === 0) {
            begin(p)
            start = { ...p }
          } else {
            lineTo(p)
          }
          cursor = p
          lastCubic = null
          lastQuadratic = null
          break
        }
        case 'L': {
          const p = relative ? { x: cursor.x + a[0], y: cursor.y + a[1] } : { x: a[0], y: a[1] }
          lineTo(p)
          cursor = p
          lastCubic = null
          lastQuadratic = null
          break
        }
        case 'H': {
          const p = { x: relative ? cursor.x + a[0] : a[0], y: cursor.y }
          lineTo(p)
          cursor = p
          lastCubic = null
          lastQuadratic = null
          break
        }
        case 'V': {
          const p = { x: cursor.x, y: relative ? cursor.y + a[0] : a[0] }
          lineTo(p)
          cursor = p
          lastCubic = null
          lastQuadratic = null
          break
        }
        case 'C': {
          const c1 = rel(cursor, a[0], a[1], relative)
          const c2 = rel(cursor, a[2], a[3], relative)
          const end = rel(cursor, a[4], a[5], relative)
          emitCubic(lineTo, cursor, c1, c2, end, segments)
          cursor = end
          lastCubic = c2
          lastQuadratic = null
          break
        }
        case 'S': {
          const c1 = lastCubic ? mirror(cursor, lastCubic) : { ...cursor }
          const c2 = rel(cursor, a[0], a[1], relative)
          const end = rel(cursor, a[2], a[3], relative)
          emitCubic(lineTo, cursor, c1, c2, end, segments)
          cursor = end
          lastCubic = c2
          lastQuadratic = null
          break
        }
        case 'Q': {
          const c = rel(cursor, a[0], a[1], relative)
          const end = rel(cursor, a[2], a[3], relative)
          emitQuadratic(lineTo, cursor, c, end, segments)
          cursor = end
          lastQuadratic = c
          lastCubic = null
          break
        }
        case 'T': {
          const c = lastQuadratic ? mirror(cursor, lastQuadratic) : { ...cursor }
          const end = rel(cursor, a[0], a[1], relative)
          emitQuadratic(lineTo, cursor, c, end, segments)
          cursor = end
          lastQuadratic = c
          lastCubic = null
          break
        }
        case 'A': {
          const end = rel(cursor, a[5], a[6], relative)
          emitArc(lineTo, cursor, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, end, arcStep)
          cursor = end
          lastCubic = null
          lastQuadratic = null
          break
        }
        default:
          break
      }
    }
  }

  return paths.filter((p) => p.points.length >= 2)
}

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }

function rel(cursor: Pt, x: number, y: number, relative: boolean): Pt {
  return relative ? { x: cursor.x + x, y: cursor.y + y } : { x, y }
}

function mirror(cursor: Pt, control: Pt): Pt {
  return { x: 2 * cursor.x - control.x, y: 2 * cursor.y - control.y }
}

function emitCubic(lineTo: (p: Pt) => void, p0: Pt, c1: Pt, c2: Pt, p1: Pt, segments: number): void {
  for (let i = 1; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    lineTo({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    })
  }
}

function emitQuadratic(lineTo: (p: Pt) => void, p0: Pt, c: Pt, p1: Pt, segments: number): void {
  for (let i = 1; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    lineTo({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    })
  }
}

/**
 * Elliptischer Bogen nach SVG-Anhang F.6.5: Endpunkt- in
 * Mittelpunktparametrisierung umrechnen und abfahren.
 */
function emitArc(
  lineTo: (p: Pt) => void,
  p0: Pt,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Pt,
  arcStep: number,
): void {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx < 1e-12 || ry < 1e-12 || (Math.abs(p1.x - p0.x) < 1e-12 && Math.abs(p1.y - p0.y) < 1e-12)) {
    lineTo(p1)
    return
  }
  const phi = (rotationDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1 = cosPhi * dx + sinPhi * dy
  const y1 = -sinPhi * dx + cosPhi * dy

  // Radien notfalls vergroessern, damit der Bogen ueberhaupt passt
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    const factor = Math.sqrt(lambda)
    rx *= factor
    ry *= factor
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let coefficient = denominator > 0 ? Math.sqrt(Math.max(0, numerator / denominator)) : 0
  if (largeArc === sweep) coefficient = -coefficient

  const cx1 = (coefficient * rx * y1) / ry
  const cy1 = (-coefficient * ry * x1) / rx
  const cx = cosPhi * cx1 - sinPhi * cy1 + (p0.x + p1.x) / 2
  const cy = sinPhi * cx1 + cosPhi * cy1 + (p0.y + p1.y) / 2

  const angleOf = (ux: number, uy: number): number => Math.atan2(uy, ux)
  const theta0 = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry)
  let deltaTheta = angleOf((-x1 - cx1) / rx, (-y1 - cy1) / ry) - theta0
  if (!sweep && deltaTheta > 0) deltaTheta -= Math.PI * 2
  else if (sweep && deltaTheta < 0) deltaTheta += Math.PI * 2

  const steps = Math.max(2, Math.ceil(Math.abs(deltaTheta) / Math.max(1e-3, arcStep)))
  for (let i = 1; i <= steps; i++) {
    const theta = theta0 + (deltaTheta * i) / steps
    const ex = rx * Math.cos(theta)
    const ey = ry * Math.sin(theta)
    lineTo({ x: cosPhi * ex - sinPhi * ey + cx, y: sinPhi * ex + cosPhi * ey + cy })
  }
}
