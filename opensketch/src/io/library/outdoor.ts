/**
 * Bibliothek: Aussenanlagen, Vegetation und Massstabsfiguren.
 *
 * Ursprung mittig in X/Y auf dem Gelaende (z = 0). Pflanzen und Figuren sind
 * bewusst grob aufgeloest - sie sollen den Massstab zeigen, nicht die
 * Szene sprengen.
 */

import { MAT } from './materials'
import {
  boxAt,
  circleProfile,
  cylinderBetween,
  cylinderZ,
  frustumBetween,
  frustumZ,
  prismZ,
  roundedRectProfile,
  slab,
  sphere,
} from './parts'
import { CATEGORY_OUTDOOR, defineEntry, type LibraryEntry } from './types'
import type { GeomBuilder } from '../common/geom'
import type { Vec3Like } from '@/shared/types'

const BARK = MAT['rinde']
const LEAF = MAT['laub-gruen']
const LEAF_AUTUMN = MAT['laub-herbst']
const WOOD = MAT['kiefer']
const WOOD_DARK = MAT['nussbaum']
const STEEL = MAT['stahl-lackiert']
const GALV = MAT['zinkblech']
const CONCRETE = MAT['beton']
const GRAVEL = MAT['kies']
const GLASS = MAT['getoentes-glas']
const TYRE = MAT['kunststoff-schwarz']
const CAR_PAINT = MAT['farbe-blau']
const SKIN = MAT['farbe-cremeweiss']
const CLOTH = MAT['farbe-anthrazit']

const TAU = Math.PI * 2

function p3(x: number, y: number, z: number): Vec3Like {
  return { x, y, z }
}

/* ------------------------------------------------------------------ */
/* Hilfsteile                                                          */
/* ------------------------------------------------------------------ */

/**
 * Laubkrone aus mehreren ueberlagerten Ellipsoiden - deutlich lebendiger als
 * eine einzelne Kugel und trotzdem guenstig.
 */
function crown(
  g: GeomBuilder,
  center: Vec3Like,
  radius: number,
  blobs: number,
  materialId: string,
  seed = 1,
): void {
  sphere(g, center, radius, 14, 9, materialId)
  for (let i = 0; i < blobs; i++) {
    const a = ((i + seed * 0.37) / blobs) * TAU
    const r = radius * 0.62
    const off = radius * 0.72
    const tilt = ((i % 3) - 1) * radius * 0.3
    sphere(
      g,
      p3(center.x + Math.cos(a) * off, center.y + Math.sin(a) * off, center.z + tilt),
      r,
      12,
      8,
      materialId,
    )
  }
}

/** Ast vom Stamm schraeg nach aussen. */
function branch(g: GeomBuilder, from: Vec3Like, angle: number, length: number, rise: number, radius: number): void {
  const to = p3(from.x + Math.cos(angle) * length, from.y + Math.sin(angle) * length, from.z + rise)
  frustumBetween(g, from, to, radius, radius * 0.45, 8, BARK)
}

/** Liegende Radscheibe, Achse entlang X. */
function wheel(g: GeomBuilder, cx: number, cy: number, cz: number, radius: number, width: number): void {
  frustumBetween(g, p3(cx - width / 2, cy, cz), p3(cx + width / 2, cy, cz), radius, radius, 16, TYRE)
  frustumBetween(
    g,
    p3(cx - width / 2 - 0.005, cy, cz),
    p3(cx + width / 2 + 0.005, cy, cz),
    radius * 0.6,
    radius * 0.6,
    14,
    GALV,
  )
}

/** Gliedmasse als leicht konischer Zylinder. */
function limb(g: GeomBuilder, a: Vec3Like, b: Vec3Like, r0: number, r1: number, materialId: string): void {
  frustumBetween(g, a, b, r0, r1, 10, materialId)
}

/* ------------------------------------------------------------------ */
/* Eintraege                                                           */
/* ------------------------------------------------------------------ */

export const OUTDOOR: LibraryEntry[] = [
  defineEntry({
    id: 'baum-laub',
    name: 'Laubbaum',
    category: CATEGORY_OUTDOOR,
    description: 'Ausgewachsener Laubbaum, gut 6 m hoch, mit verzweigtem Stamm und breiter Krone.',
    size: '455 × 455 × 635 cm',
    geometry(g) {
      // Stamm mit Wurzelanlauf
      frustumZ(g, 0, 0, 0, 0.28, 0.17, 0.5, 12, BARK)
      frustumZ(g, 0, 0, 0.5, 0.17, 0.13, 1.9, 12, BARK)
      // Hauptaeste
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4
        branch(g, p3(0, 0, 2.2), a, 0.85, 0.9, 0.075)
      }
      frustumZ(g, 0, 0, 2.4, 0.11, 0.05, 1.1, 10, BARK)
      crown(g, p3(0, 0, 4.6), 1.75, 5, LEAF, 3)
    },
  }),

  defineEntry({
    id: 'baum-jung',
    name: 'Jungbaum',
    category: CATEGORY_OUTDOOR,
    description: 'Frisch gepflanzter Straßenbaum, 4 m hoch, mit schmaler Krone.',
    size: '230 × 230 × 395 cm',
    geometry(g) {
      frustumZ(g, 0, 0, 0, 0.09, 0.06, 2.0, 10, BARK)
      for (let i = 0; i < 3; i++) {
        branch(g, p3(0, 0, 1.9), (i / 3) * TAU, 0.45, 0.55, 0.035)
      }
      crown(g, p3(0, 0, 3.0), 0.95, 4, LEAF, 7)
    },
  }),

  defineEntry({
    id: 'nadelbaum',
    name: 'Nadelbaum',
    category: CATEGORY_OUTDOOR,
    description: 'Fichte, 8 m hoch, kegelförmige Krone in drei Etagen.',
    size: '320 × 320 × 800 cm',
    geometry(g) {
      frustumZ(g, 0, 0, 0, 0.22, 0.09, 8.0, 12, BARK)
      frustumZ(g, 0, 0, 1.1, 1.6, 0.28, 2.6, 16, LEAF, { bottom: true, top: false })
      frustumZ(g, 0, 0, 3.4, 1.2, 0.2, 2.4, 16, LEAF, { bottom: true, top: false })
      frustumZ(g, 0, 0, 5.5, 0.8, 0.0, 2.5, 16, LEAF, { bottom: true })
    },
  }),

  defineEntry({
    id: 'strauch',
    name: 'Strauch',
    category: CATEGORY_OUTDOOR,
    description: 'Runder Zierstrauch, 120 cm breit und 110 cm hoch.',
    size: '118 × 115 × 115 cm',
    geometry(g) {
      sphere(g, p3(0, 0, 0.6), 0.6, 14, 9, LEAF, { x: 1, y: 1, z: 0.92 })
      sphere(g, p3(0.24, 0.12, 0.42), 0.34, 10, 7, LEAF)
      sphere(g, p3(-0.22, -0.16, 0.46), 0.3, 10, 7, LEAF)
      cylinderZ(g, 0, 0, 0, 0.05, 0.2, 8, BARK)
    },
  }),

  defineEntry({
    id: 'hecke',
    name: 'Heckenelement',
    category: CATEGORY_OUTDOOR,
    description: 'Geschnittene Hecke 200 cm lang, 50 cm tief, 150 cm hoch. Ab Ursprung nach +X.',
    size: '200 × 50 × 150 cm',
    geometry(g) {
      prismZ(g, roundedRectProfile(1.0, 0, 2.0, 0.5, 0.08), 0, 1.5, LEAF)
    },
  }),

  defineEntry({
    id: 'blumenkuebel',
    name: 'Pflanzkübel',
    category: CATEGORY_OUTDOOR,
    description: 'Konischer Pflanzkübel Ø 50 cm mit Bepflanzung.',
    size: '50 × 50 × 95 cm',
    geometry(g) {
      frustumZ(g, 0, 0, 0, 0.18, 0.25, 0.45, 20, CONCRETE, { top: false })
      prismZ(g, circleProfile(0, 0, 0.25, 20), 0.4, 0.05, CONCRETE, [circleProfile(0, 0, 0.21, 20)])
      prismZ(g, circleProfile(0, 0, 0.21, 20), 0.36, 0.04, MAT['erde'])
      sphere(g, p3(0, 0, 0.62), 0.24, 12, 8, LEAF_AUTUMN)
      sphere(g, p3(0.1, -0.06, 0.78), 0.16, 10, 7, LEAF)
    },
  }),

  defineEntry({
    id: 'zaunelement',
    name: 'Zaunelement',
    category: CATEGORY_OUTDOOR,
    description: 'Lattenzaun 200 cm lang, 120 cm hoch, mit zwei Pfosten und Querriegeln. Ab Ursprung nach +X.',
    size: '203 × 12,4 × 125 cm',
    geometry(g) {
      const length = 2.0
      const height = 1.2
      // Pfosten
      for (const x of [0.045, length - 0.045]) {
        boxAt(g, x, 0, 0, 0.09, 0.09, height, WOOD_DARK)
        // Pfostenkopf angeschraegt
        frustumZ(g, x, 0, height, 0.062, 0.02, 0.05, 4, WOOD_DARK)
      }
      // Riegel
      for (const z of [0.25, 0.92]) {
        boxAt(g, length / 2, 0, z, length - 0.18, 0.032, 0.07, WOOD)
      }
      // Latten
      const count = 13
      for (let i = 0; i < count; i++) {
        const x = 0.12 + (i * (length - 0.24)) / (count - 1)
        boxAt(g, x, -0.032, 0.06, 0.07, 0.02, height - 0.12, WOOD)
      }
    },
  }),

  defineEntry({
    id: 'gartenbank',
    name: 'Gartenbank',
    category: CATEGORY_OUTDOOR,
    description: 'Parkbank 180 cm mit Holzlatten und Stahlwangen, Sitzhöhe 45 cm.',
    size: '180 × 60 × 90 cm',
    geometry(g) {
      const w = 1.8
      // Wangen
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.12)
        boxAt(g, x, -0.18, 0, 0.05, 0.06, 0.45, STEEL)
        boxAt(g, x, 0.2, 0, 0.05, 0.06, 0.45, STEEL)
        boxAt(g, x, 0, 0.4, 0.05, 0.56, 0.05, STEEL)
        // Lehnenstuetze schraeg nach hinten
        cylinderBetween(g, p3(x, 0.2, 0.42), p3(x, 0.3, 0.85), 0.024, 8, STEEL)
        boxAt(g, x, -0.24, 0.4, 0.05, 0.06, 0.05, STEEL)
      }
      // Sitzlatten
      for (let i = 0; i < 5; i++) {
        boxAt(g, 0, -0.22 + i * 0.1, 0.45, w, 0.078, 0.026, WOOD)
      }
      // Lehnenlatten
      for (let i = 0; i < 4; i++) {
        const t = i / 3
        boxAt(g, 0, 0.21 + t * 0.09, 0.53 + t * 0.29, w, 0.026, 0.078, WOOD)
      }
    },
  }),

  defineEntry({
    id: 'papierkorb',
    name: 'Abfallbehälter',
    category: CATEGORY_OUTDOOR,
    description: 'Öffentlicher Abfallbehälter Ø 40 cm auf Standrohr, 95 cm hoch.',
    size: '42 × 42 × 95 cm',
    geometry(g) {
      cylinderZ(g, 0, 0, 0, 0.09, 0.02, 16, STEEL)
      cylinderZ(g, 0, 0, 0.02, 0.035, 0.42, 12, STEEL)
      prismZ(g, circleProfile(0, 0, 0.2, 20), 0.44, 0.44, STEEL, [circleProfile(0, 0, 0.185, 20)])
      prismZ(g, circleProfile(0, 0, 0.185, 20), 0.44, 0.02, STEEL)
      frustumZ(g, 0, 0, 0.88, 0.21, 0.14, 0.07, 20, STEEL, { bottom: false })
    },
  }),

  defineEntry({
    id: 'strassenlaterne',
    name: 'Straßenlaterne',
    category: CATEGORY_OUTDOOR,
    description: 'Mastleuchte 5 m hoch mit auskragendem Leuchtenkopf.',
    size: '124 × 28 × 490 cm',
    geometry(g) {
      cylinderZ(g, 0, 0, 0, 0.14, 0.06, 16, CONCRETE)
      frustumZ(g, 0, 0, 0.06, 0.09, 0.055, 4.54, 14, GALV)
      cylinderBetween(g, p3(0, 0, 4.6), p3(0.75, 0, 4.85), 0.05, 12, GALV)
      prismZ(g, roundedRectProfile(0.85, 0, 0.5, 0.24, 0.06), 4.78, 0.11, GALV)
      prismZ(g, roundedRectProfile(0.85, 0, 0.44, 0.19, 0.05), 4.74, 0.04, MAT['milchglas'])
    },
  }),

  defineEntry({
    id: 'auto',
    name: 'Auto (Kompaktklasse)',
    category: CATEGORY_OUTDOOR,
    description: 'Vereinfachter PKW 425 × 180 × 148 cm als Maßstabs- und Stellplatzreferenz. Front in -Y.',
    size: '196 × 428 × 146 cm',
    geometry(g) {
      const halfW = 0.87
      const wheelR = 0.32
      // Karosserie: Laengsschnitt in der YZ-Ebene, extrudiert entlang X
      const bodyLower = [
        { x: -2.06, y: 0.3 },
        { x: 2.06, y: 0.3 },
        { x: 2.12, y: 0.55 },
        { x: 2.02, y: 0.78 },
        { x: -1.96, y: 0.82 },
        { x: -2.12, y: 0.6 },
      ]
      // Profil liegt in (y, z); prismZ erwartet (x, y) in der XY-Ebene, also
      // wird es hier ueber prismOn-aequivalente Achsen gebaut.
      profileAlongX(g, bodyLower, -halfW, halfW, CAR_PAINT)
      const cabin = [
        { x: -1.28, y: 0.82 },
        { x: 0.72, y: 0.82 },
        { x: 0.42, y: 1.44 },
        { x: -0.86, y: 1.46 },
      ]
      profileAlongX(g, cabin, -halfW + 0.05, halfW - 0.05, GLASS)
      // Dach
      boxAt(g, 0, -0.22, 1.4, 2 * halfW - 0.12, 1.2, 0.06, CAR_PAINT)
      // Radhaeuser / Raeder
      for (const sy of [-1.35, 1.28]) {
        for (const sx of [-1, 1]) {
          wheel(g, sx * (halfW - 0.09), sy, wheelR, wheelR, 0.21)
        }
      }
      // Stossfaenger, Scheinwerfer, Rueckleuchten
      boxAt(g, 0, -2.09, 0.36, 2 * halfW - 0.06, 0.1, 0.22, MAT['pvc-grau'])
      boxAt(g, 0, 2.09, 0.36, 2 * halfW - 0.06, 0.1, 0.22, MAT['pvc-grau'])
      for (const sx of [-1, 1]) {
        boxAt(g, sx * 0.58, -2.11, 0.66, 0.34, 0.06, 0.14, MAT['farbe-weiss'])
        boxAt(g, sx * 0.6, 2.09, 0.7, 0.3, 0.06, 0.16, MAT['farbe-rot'])
        // Aussenspiegel
        boxAt(g, sx * (halfW + 0.05), -0.82, 0.98, 0.12, 0.06, 0.08, CAR_PAINT)
      }
    },
  }),

  defineEntry({
    id: 'fahrrad-staender',
    name: 'Fahrradständer',
    category: CATEGORY_OUTDOOR,
    description: 'Anlehnbügel aus Stahlrohr, 90 cm breit, 80 cm hoch.',
    size: '95 × 4,8 × 87 cm',
    geometry(g) {
      const w = 0.9
      const h = 0.8
      const r = 0.024
      cylinderBetween(g, p3(-w / 2, 0, -0.05), p3(-w / 2, 0, h - 0.12), r, 12, GALV)
      cylinderBetween(g, p3(w / 2, 0, -0.05), p3(w / 2, 0, h - 0.12), r, 12, GALV)
      // Bogen oben
      const seg = 8
      for (let i = 0; i < seg; i++) {
        const a0 = Math.PI * (i / seg)
        const a1 = Math.PI * ((i + 1) / seg)
        cylinderBetween(
          g,
          p3(-Math.cos(a0) * (w / 2), 0, h - 0.12 + Math.sin(a0) * 0.12),
          p3(-Math.cos(a1) * (w / 2), 0, h - 0.12 + Math.sin(a1) * 0.12),
          r,
          10,
          GALV,
        )
      }
    },
  }),

  defineEntry({
    id: 'person-stehend',
    name: 'Person stehend',
    category: CATEGORY_OUTDOOR,
    description: 'Maßstabsfigur 175 cm, stehend. Blickrichtung -Y.',
    size: '51 × 33 × 174 cm',
    geometry(g) {
      buildPerson(g)
    },
  }),

  defineEntry({
    id: 'terrassendiele',
    name: 'Terrassenfeld',
    category: CATEGORY_OUTDOOR,
    description: 'Holzdeck 300 × 200 cm aus Dielen mit Fugen, Oberkante auf z = 0.',
    size: '300 × 200 × 8,6 cm',
    geometry(g) {
      const w = 3.0
      const d = 2.0
      const boardWidth = 0.145
      const gap = 0.005
      const count = Math.floor((d + gap) / (boardWidth + gap))
      const total = count * boardWidth + (count - 1) * gap
      for (let i = 0; i < count; i++) {
        const y = -total / 2 + boardWidth / 2 + i * (boardWidth + gap)
        boxAt(g, 0, y, -0.026, w, boardWidth, 0.026, WOOD)
      }
      // Unterkonstruktion
      for (const x of [-w / 2 + 0.2, 0, w / 2 - 0.2]) {
        boxAt(g, x, 0, -0.086, 0.06, d, 0.06, WOOD_DARK)
      }
    },
  }),

  defineEntry({
    id: 'kiesbeet',
    name: 'Kiesbeet',
    category: CATEGORY_OUTDOOR,
    description: 'Kiesfläche 200 × 150 cm mit Randeinfassung, Oberkante auf z = 0.',
    size: '206 × 156 × 10 cm',
    geometry(g) {
      slab(g, 0, 0, -0.05, 2.0, 1.5, 0.05, 0.03, GRAVEL)
      prismZ(g, roundedRectProfile(0, 0, 2.06, 1.56, 0.04), -0.08, 0.1, CONCRETE, [
        roundedRectProfile(0, 0, 2.0, 1.5, 0.03),
      ])
    },
  }),
]

/* ------------------------------------------------------------------ */
/* Zusammengesetzte Teile                                              */
/* ------------------------------------------------------------------ */

/**
 * Extrudiert ein Profil aus der YZ-Ebene entlang X.
 * `profile[i] = { x: y-Koordinate, y: z-Koordinate }`.
 */
function profileAlongX(
  g: GeomBuilder,
  profile: readonly { x: number; y: number }[],
  x0: number,
  x1: number,
  materialId: string,
): void {
  const opts = { materialId }
  const n = profile.length
  const lo = profile.map((p) => p3(x0, p.x, p.y))
  const hi = profile.map((p) => p3(x1, p.x, p.y))
  // Deckel: die Aussenschleife laeuft in (y, z) gegen den Uhrzeigersinn,
  // damit zeigt cross(Y, Z) = +X - die x1-Seite ist also die Vorderseite.
  g.face(hi, [], opts)
  g.face([...lo].reverse(), [], opts)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    g.face([lo[i], lo[j], hi[j], hi[i]], [], opts)
  }
}

function buildPerson(g: GeomBuilder): void {
  const hip = 0.94
  const shoulder = 1.44
  const neck = 1.52
  // Beine
  for (const sx of [-1, 1]) {
    const x = sx * 0.095
    limb(g, p3(x, 0, 0.02), p3(x, 0.01, 0.5), 0.062, 0.055, CLOTH)
    limb(g, p3(x, 0.01, 0.5), p3(x, 0, hip), 0.055, 0.085, CLOTH)
    // Fuss
    boxAt(g, x, -0.045, 0, 0.09, 0.24, 0.045, MAT['leder-braun'])
  }
  // Becken und Rumpf
  limb(g, p3(0, 0, hip - 0.04), p3(0, 0, 1.16), 0.135, 0.145, CLOTH)
  limb(g, p3(0, 0, 1.16), p3(0, 0, shoulder), 0.145, 0.16, CLOTH)
  // Arme
  for (const sx of [-1, 1]) {
    const x = sx * 0.185
    limb(g, p3(x, 0, shoulder - 0.02), p3(sx * 0.21, 0.01, 1.1), 0.055, 0.045, CLOTH)
    limb(g, p3(sx * 0.21, 0.01, 1.1), p3(sx * 0.22, -0.02, 0.78), 0.045, 0.038, SKIN)
  }
  // Schultern, Hals, Kopf
  sphere(g, p3(0, 0, shoulder), 0.16, 12, 8, CLOTH, { x: 1, y: 0.62, z: 0.42 })
  limb(g, p3(0, 0, shoulder), p3(0, 0, neck + 0.02), 0.05, 0.048, SKIN)
  sphere(g, p3(0, -0.005, neck + 0.11), 0.105, 14, 10, SKIN, { x: 0.92, y: 1, z: 1.05 })
}
