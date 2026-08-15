/**
 * Bibliothek: Moebel.
 *
 * Alle Masse sind reale Moebelmasse in Metern. Der Ursprung liegt bei jedem
 * Stueck mittig in X/Y auf dem Fussboden (z = 0), damit sich die Komponenten
 * direkt auf einer Bodenflaeche absetzen lassen.
 */

import { MAT } from './materials'
import { boxAt, circleProfile, cylinderZ, frustumZ, legs, prismZ, roundedRectProfile, slab } from './parts'
import { CATEGORY_FURNITURE, defineEntry, type LibraryEntry } from './types'
import type { GeomBuilder } from '../common/geom'

const WOOD = MAT['eiche-hell']
const WOOD_DARK = MAT['nussbaum']
const BEECH = MAT['buche']
const WHITE = MAT['mdf-weiss']
const STEEL = MAT['stahl-gebuerstet']
const CHROME = MAT['chrom']
const FABRIC = MAT['stoff-grau']
const FABRIC_BLUE = MAT['stoff-blau']
const PLASTIC_BLACK = MAT['kunststoff-schwarz']
const ANTHRACITE = MAT['farbe-anthrazit']

/* ------------------------------------------------------------------ */
/* Kleinteile                                                          */
/* ------------------------------------------------------------------ */

/** Stangengriff parallel zu X, mittig bei (0, y, z). */
function barHandle(g: GeomBuilder, cx: number, y: number, z: number, width: number): void {
  boxAt(g, cx, y - 0.022, z, width, 0.016, 0.016, STEEL)
  boxAt(g, cx - width / 2 + 0.01, y - 0.011, z, 0.014, 0.022, 0.014, STEEL)
  boxAt(g, cx + width / 2 - 0.01, y - 0.011, z, 0.014, 0.022, 0.014, STEEL)
}

/** Schubladenfront mit Fuge und Griff. */
function drawerFront(
  g: GeomBuilder,
  cx: number,
  frontY: number,
  z: number,
  width: number,
  height: number,
  materialId: string,
): void {
  boxAt(g, cx, frontY - 0.009, z + 0.004, width - 0.006, 0.018, height - 0.008, materialId)
  barHandle(g, cx, frontY - 0.018, z + height / 2, Math.min(0.24, width * 0.45))
}

/** Sitzpolster mit weichen Kanten. */
function cushion(
  g: GeomBuilder,
  cx: number,
  cy: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  materialId: string,
): void {
  prismZ(g, roundedRectProfile(cx, cy, width, depth, Math.min(0.06, height)), z, height, materialId)
}

/* ------------------------------------------------------------------ */
/* Eintraege                                                           */
/* ------------------------------------------------------------------ */

export const FURNITURE: LibraryEntry[] = [
  defineEntry({
    id: 'stuhl',
    name: 'Stuhl',
    category: CATEGORY_FURNITURE,
    description: 'Klassischer Holzstuhl mit gerader Rueckenlehne, Sitzhoehe 45 cm.',
    size: '45 × 48 × 88 cm',
    geometry(g) {
      const w = 0.45
      const d = 0.45
      const seatZ = 0.44
      // Beine
      legs(g, w, d, seatZ, 0.04, 0.01, BEECH)
      // Zarge
      boxAt(g, 0, -d / 2 + 0.035, seatZ - 0.07, w - 0.08, 0.025, 0.06, BEECH)
      boxAt(g, 0, d / 2 - 0.035, seatZ - 0.07, w - 0.08, 0.025, 0.06, BEECH)
      // Sitzflaeche
      slab(g, 0, 0, seatZ, w, d, 0.035, 0.02, BEECH)
      // Rueckenlehne: zwei Holme und drei Querlatten
      const backY = d / 2 - 0.03
      boxAt(g, -w / 2 + 0.03, backY, seatZ, 0.04, 0.035, 0.44, BEECH)
      boxAt(g, w / 2 - 0.03, backY, seatZ, 0.04, 0.035, 0.44, BEECH)
      for (const z of [0.62, 0.72, 0.82]) {
        boxAt(g, 0, backY, z, w - 0.1, 0.022, 0.055, BEECH)
      }
    },
  }),

  defineEntry({
    id: 'buerostuhl',
    name: 'Bürostuhl',
    category: CATEGORY_FURNITURE,
    description: 'Drehstuhl mit Fünffußkreuz, Gasfeder, Armlehnen und Netzrücken.',
    size: '65 × 65 × 100 cm',
    geometry(g) {
      // Fusskreuz
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        const len = 0.31
        const prof = [
          { x: -0.028, y: -0.02 },
          { x: 0.028, y: -0.02 },
          { x: 0.018, y: len },
          { x: -0.018, y: len },
        ].map((p) => ({
          x: p.x * -dy + p.y * dx,
          y: p.x * dx + p.y * dy,
        }))
        prismZ(g, prof, 0.055, 0.035, PLASTIC_BLACK)
        // Rolle
        cylinderZ(g, dx * len, dy * len, 0.0, 0.028, 0.055, 10, PLASTIC_BLACK)
      }
      // Gasfeder
      cylinderZ(g, 0, 0, 0.09, 0.045, 0.14, 14, CHROME)
      cylinderZ(g, 0, 0, 0.23, 0.028, 0.21, 12, CHROME)
      // Sitz
      cushion(g, 0, 0, 0.44, 0.48, 0.46, 0.09, FABRIC)
      // Rueckenlehne
      boxAt(g, 0, 0.2, 0.53, 0.05, 0.05, 0.16, PLASTIC_BLACK)
      prismZ(g, roundedRectProfile(0, 0.22, 0.46, 0.06, 0.03), 0.62, 0.4, FABRIC)
      // Armlehnen
      for (const sx of [-1, 1]) {
        boxAt(g, sx * 0.26, 0.02, 0.53, 0.035, 0.035, 0.15, PLASTIC_BLACK)
        boxAt(g, sx * 0.26, -0.01, 0.68, 0.06, 0.24, 0.03, PLASTIC_BLACK)
      }
    },
  }),

  defineEntry({
    id: 'esstisch',
    name: 'Esstisch',
    category: CATEGORY_FURNITURE,
    description: 'Rechteckiger Esstisch für sechs Personen, massive Platte.',
    size: '160 × 90 × 75 cm',
    geometry(g) {
      const w = 1.6
      const d = 0.9
      slab(g, 0, 0, 0.71, w, d, 0.04, 0.01, WOOD)
      legs(g, w, d, 0.71, 0.07, 0.08, WOOD)
      // Zargen
      boxAt(g, 0, -d / 2 + 0.115, 0.63, w - 0.3, 0.03, 0.08, WOOD)
      boxAt(g, 0, d / 2 - 0.115, 0.63, w - 0.3, 0.03, 0.08, WOOD)
      boxAt(g, -w / 2 + 0.115, 0, 0.63, 0.03, d - 0.3, 0.08, WOOD)
      boxAt(g, w / 2 - 0.115, 0, 0.63, 0.03, d - 0.3, 0.08, WOOD)
    },
  }),

  defineEntry({
    id: 'schreibtisch',
    name: 'Schreibtisch',
    category: CATEGORY_FURNITURE,
    description: 'Schreibtisch mit Stahlgestell und Kabelblende.',
    size: '160 × 80 × 75 cm',
    geometry(g) {
      const w = 1.6
      const d = 0.8
      slab(g, 0, 0, 0.72, w, d, 0.03, 0.006, WOOD)
      // Wangen aus Stahlrohr
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.1)
        boxAt(g, x, -d / 2 + 0.08, 0, 0.05, 0.05, 0.72, STEEL)
        boxAt(g, x, d / 2 - 0.08, 0, 0.05, 0.05, 0.72, STEEL)
        boxAt(g, x, 0, 0.66, 0.05, d - 0.16, 0.05, STEEL)
      }
      boxAt(g, 0, 0, 0.66, w - 0.2, 0.04, 0.05, STEEL)
      // Kabelblende
      boxAt(g, 0, d / 2 - 0.06, 0.5, w - 0.3, 0.018, 0.2, ANTHRACITE)
    },
  }),

  defineEntry({
    id: 'couchtisch',
    name: 'Couchtisch',
    category: CATEGORY_FURNITURE,
    description: 'Niedriger Wohnzimmertisch mit Ablageboden.',
    size: '110 × 60 × 42 cm',
    geometry(g) {
      const w = 1.1
      const d = 0.6
      slab(g, 0, 0, 0.38, w, d, 0.04, 0.012, WOOD_DARK)
      legs(g, w, d, 0.38, 0.05, 0.05, WOOD_DARK)
      boxAt(g, 0, 0, 0.12, w - 0.22, d - 0.18, 0.02, WOOD_DARK)
    },
  }),

  defineEntry({
    id: 'sofa-2',
    name: 'Sofa 2-Sitzer',
    category: CATEGORY_FURNITURE,
    description: 'Zweisitzer mit Armlehnen und losen Sitzkissen.',
    size: '160 × 90 × 85 cm',
    geometry(g) {
      buildSofa(g, 1.6, 2)
    },
  }),

  defineEntry({
    id: 'sofa-3',
    name: 'Sofa 3-Sitzer',
    category: CATEGORY_FURNITURE,
    description: 'Dreisitzer mit Armlehnen und losen Sitzkissen.',
    size: '210 × 90 × 85 cm',
    geometry(g) {
      buildSofa(g, 2.1, 3)
    },
  }),

  defineEntry({
    id: 'sessel',
    name: 'Sessel',
    category: CATEGORY_FURNITURE,
    description: 'Gepolsterter Sessel passend zur Sofagarnitur.',
    size: '90 × 85 × 85 cm',
    geometry(g) {
      buildSofa(g, 0.9, 1)
    },
  }),

  defineEntry({
    id: 'bett-140',
    name: 'Bett 140 × 200',
    category: CATEGORY_FURNITURE,
    description: 'Doppelbett mit Kopfteil, Matratze 140 × 200 cm. Kopfende in -Y.',
    size: '146 × 212 × 95 cm',
    geometry(g) {
      buildBed(g, 1.4)
    },
  }),

  defineEntry({
    id: 'bett-180',
    name: 'Bett 180 × 200',
    category: CATEGORY_FURNITURE,
    description: 'Doppelbett mit Kopfteil, Matratze 180 × 200 cm. Kopfende in -Y.',
    size: '186 × 212 × 95 cm',
    geometry(g) {
      buildBed(g, 1.8)
    },
  }),

  defineEntry({
    id: 'nachttisch',
    name: 'Nachttisch',
    category: CATEGORY_FURNITURE,
    description: 'Nachtkonsole mit zwei Schubladen, Front in -Y.',
    size: '45 × 40 × 55 cm',
    geometry(g) {
      const w = 0.45
      const d = 0.4
      boxAt(g, 0, 0, 0.1, w, d, 0.45, WOOD)
      legs(g, w, d, 0.1, 0.035, 0.02, WOOD_DARK)
      drawerFront(g, 0, -d / 2, 0.13, w, 0.19, WOOD)
      drawerFront(g, 0, -d / 2, 0.33, w, 0.19, WOOD)
    },
  }),

  defineEntry({
    id: 'kleiderschrank',
    name: 'Kleiderschrank',
    category: CATEGORY_FURNITURE,
    description: 'Zweitüriger Kleiderschrank, Türen in -Y.',
    size: '150 × 60 × 200 cm',
    geometry(g) {
      const w = 1.5
      const d = 0.6
      const h = 2.0
      // Korpus
      boxAt(g, 0, 0.02, 0.06, w, d - 0.04, h - 0.06, WHITE)
      // Sockel
      boxAt(g, 0, 0.02, 0, w - 0.06, d - 0.1, 0.06, ANTHRACITE)
      // Tueren
      for (const sx of [-1, 1]) {
        boxAt(g, sx * (w / 4), -d / 2 + 0.009, 0.08, w / 2 - 0.006, 0.018, h - 0.11, WHITE)
        boxAt(g, sx * 0.05, -d / 2 - 0.012, 1.1, 0.02, 0.024, 0.36, STEEL)
      }
    },
  }),

  defineEntry({
    id: 'buecherregal',
    name: 'Bücherregal',
    category: CATEGORY_FURNITURE,
    description: 'Offenes Regal mit vier Einlegeböden, Rückwand geschlossen.',
    size: '80 × 30 × 180 cm',
    geometry(g) {
      const w = 0.8
      const d = 0.3
      const h = 1.8
      const t = 0.02
      // Seiten
      boxAt(g, -w / 2 + t / 2, 0, 0, t, d, h, WOOD)
      boxAt(g, w / 2 - t / 2, 0, 0, t, d, h, WOOD)
      // Boden und Deckel
      boxAt(g, 0, 0, 0, w - 2 * t, d, t, WOOD)
      boxAt(g, 0, 0, h - t, w - 2 * t, d, t, WOOD)
      // Einlegeboeden
      for (let i = 1; i <= 4; i++) {
        boxAt(g, 0, 0.008, (h - t) * (i / 5), w - 2 * t, d - 0.016, 0.018, WOOD)
      }
      // Rueckwand
      boxAt(g, 0, d / 2 - 0.005, t, w - 2 * t, 0.01, h - 2 * t, WHITE)
    },
  }),

  defineEntry({
    id: 'kommode',
    name: 'Kommode',
    category: CATEGORY_FURNITURE,
    description: 'Sideboard mit drei Schubladen, Front in -Y.',
    size: '100 × 45 × 80 cm',
    geometry(g) {
      const w = 1.0
      const d = 0.45
      const h = 0.8
      boxAt(g, 0, 0, 0.09, w, d, h - 0.09, WOOD)
      legs(g, w, d, 0.09, 0.04, 0.03, ANTHRACITE)
      for (let i = 0; i < 3; i++) {
        drawerFront(g, 0, -d / 2, 0.12 + i * 0.22, w, 0.21, WOOD)
      }
    },
  }),

  defineEntry({
    id: 'kuechenzeile',
    name: 'Küchen-Unterschrank',
    category: CATEGORY_FURNITURE,
    description: 'Unterschrankelement 60 cm mit Arbeitsplatte, Front in -Y.',
    size: '60 × 60 × 86 cm',
    geometry(g) {
      const w = 0.6
      const d = 0.58
      // Sockel
      boxAt(g, 0, 0.03, 0, w, d - 0.06, 0.1, ANTHRACITE)
      // Korpus
      boxAt(g, 0, 0.01, 0.1, w, d - 0.02, 0.72, WHITE)
      // Front
      boxAt(g, 0, -d / 2 + 0.009, 0.11, w - 0.004, 0.019, 0.7, WHITE)
      barHandle(g, 0, -d / 2 - 0.012, 0.76, 0.32)
      // Arbeitsplatte
      slab(g, 0, 0.01, 0.82, w, d + 0.02, 0.04, 0.004, MAT['granit'])
    },
  }),

  defineEntry({
    id: 'hocker',
    name: 'Hocker',
    category: CATEGORY_FURNITURE,
    description: 'Runder Holzhocker, stapelbar.',
    size: '38 × 38 × 45 cm',
    geometry(g) {
      prismZ(g, circleProfile(0, 0, 0.19, 24), 0.42, 0.035, BEECH)
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i / 4) * Math.PI * 2
        cylinderZ(g, Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0, 0.017, 0.42, 10, BEECH)
      }
      // Ringstrebe
      for (let i = 0; i < 4; i++) {
        const a0 = Math.PI / 4 + (i / 4) * Math.PI * 2
        const a1 = Math.PI / 4 + ((i + 1) / 4) * Math.PI * 2
        const x0 = Math.cos(a0) * 0.145
        const y0 = Math.sin(a0) * 0.145
        const x1 = Math.cos(a1) * 0.145
        const y1 = Math.sin(a1) * 0.145
        strut(g, x0, y0, x1, y1, 0.14, 0.02, BEECH)
      }
    },
  }),

  defineEntry({
    id: 'stehlampe',
    name: 'Stehlampe',
    category: CATEGORY_FURNITURE,
    description: 'Stehleuchte mit Metallfuß und konischem Schirm.',
    size: '40 × 40 × 160 cm',
    geometry(g) {
      cylinderZ(g, 0, 0, 0, 0.17, 0.025, 24, ANTHRACITE)
      cylinderZ(g, 0, 0, 0.025, 0.016, 1.29, 12, STEEL)
      frustumZ(g, 0, 0, 1.31, 0.2, 0.14, 0.29, 24, MAT['stoff-beige'], { bottom: false, top: false })
    },
  }),

  defineEntry({
    id: 'tischlampe',
    name: 'Tischlampe',
    category: CATEGORY_FURNITURE,
    description: 'Tischleuchte mit rundem Fuß und Stoffschirm.',
    size: '25 × 25 × 45 cm',
    geometry(g) {
      frustumZ(g, 0, 0, 0, 0.1, 0.07, 0.05, 24, ANTHRACITE)
      cylinderZ(g, 0, 0, 0.05, 0.012, 0.24, 10, STEEL)
      frustumZ(g, 0, 0, 0.28, 0.125, 0.09, 0.17, 24, MAT['stoff-beige'], { bottom: false, top: false })
    },
  }),

  defineEntry({
    id: 'esszimmerbank',
    name: 'Sitzbank',
    category: CATEGORY_FURNITURE,
    description: 'Schlichte Sitzbank für den Esstisch.',
    size: '140 × 35 × 45 cm',
    geometry(g) {
      slab(g, 0, 0, 0.42, 1.4, 0.35, 0.035, 0.012, WOOD)
      for (const sx of [-1, 1]) {
        boxAt(g, sx * 0.6, 0, 0, 0.035, 0.32, 0.42, WOOD)
      }
      boxAt(g, 0, 0, 0.34, 1.1, 0.025, 0.07, WOOD)
    },
  }),

  defineEntry({
    id: 'tv-lowboard',
    name: 'TV-Lowboard',
    category: CATEGORY_FURNITURE,
    description: 'Flaches Sideboard mit zwei Klappen, Front in -Y.',
    size: '180 × 40 × 45 cm',
    geometry(g) {
      const w = 1.8
      const d = 0.4
      boxAt(g, 0, 0, 0.06, w, d, 0.36, ANTHRACITE)
      legs(g, w, d, 0.06, 0.035, 0.05, STEEL)
      for (const sx of [-1, 1]) {
        boxAt(g, sx * (w / 4), -d / 2 + 0.009, 0.08, w / 2 - 0.006, 0.018, 0.32, WOOD_DARK)
      }
      barHandle(g, -w / 4, -d / 2 - 0.012, 0.24, 0.3)
      barHandle(g, w / 4, -d / 2 - 0.012, 0.24, 0.3)
    },
  }),
]

/* ------------------------------------------------------------------ */
/* Gemeinsame Bauteile                                                 */
/* ------------------------------------------------------------------ */

function strut(
  g: GeomBuilder,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
  size: number,
  materialId: string,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return
  const ux = dx / len
  const uy = dy / len
  const half = size / 2
  const profile = [
    { x: x0 + uy * half, y: y0 - ux * half },
    { x: x1 + uy * half, y: y1 - ux * half },
    { x: x1 - uy * half, y: y1 + ux * half },
    { x: x0 - uy * half, y: y0 + ux * half },
  ]
  prismZ(g, profile, z, size, materialId)
}

function buildSofa(g: GeomBuilder, width: number, seats: number): void {
  const depth = 0.9
  const armWidth = 0.2
  const seatZ = 0.4
  const baseZ = 0.08

  // Korpus
  boxAt(g, 0, 0, baseZ, width, depth, seatZ - baseZ, FABRIC)
  // Fuesse
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      cylinderZ(g, sx * (width / 2 - 0.09), sy * (depth / 2 - 0.09), 0, 0.022, baseZ, 10, WOOD_DARK)
    }
  }
  // Armlehnen
  for (const sx of [-1, 1]) {
    prismZ(
      g,
      roundedRectProfile(sx * (width / 2 - armWidth / 2), 0, armWidth, depth, 0.05),
      seatZ,
      0.28,
      FABRIC,
    )
  }
  // Rueckenlehne
  boxAt(g, 0, depth / 2 - 0.11, seatZ, width - 2 * armWidth, 0.22, 0.45, FABRIC)
  // Sitzkissen
  const innerWidth = width - 2 * armWidth
  const cw = innerWidth / seats
  for (let i = 0; i < seats; i++) {
    const cx = -innerWidth / 2 + cw * (i + 0.5)
    cushion(g, cx, -0.09, seatZ, cw - 0.015, depth - 0.28, 0.14, FABRIC_BLUE)
    // Rueckenkissen
    cushion(g, cx, depth / 2 - 0.27, seatZ + 0.14, cw - 0.02, 0.14, 0.34, FABRIC_BLUE)
  }
}

function buildBed(g: GeomBuilder, mattressWidth: number): void {
  const w = mattressWidth + 0.06
  const l = 2.12
  const frameZ = 0.12
  // Rahmen
  boxAt(g, 0, 0, frameZ, w, l, 0.22, WOOD)
  // Fuesse
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      boxAt(g, sx * (w / 2 - 0.05), sy * (l / 2 - 0.05), 0, 0.07, 0.07, frameZ, WOOD_DARK)
    }
  }
  // Matratze
  cushion(g, 0, 0.03, 0.3, mattressWidth, 2.0, 0.22, MAT['stoff-beige'])
  // Kopfteil (in -Y)
  boxAt(g, 0, -l / 2 + 0.03, frameZ, w, 0.06, 0.83, WOOD)
  // Kissen
  for (const sx of mattressWidth > 1.5 ? [-1, 1] : [0]) {
    cushion(g, sx * (mattressWidth / 4), -l / 2 + 0.34, 0.52, mattressWidth > 1.5 ? 0.8 : 0.9, 0.42, 0.1, WHITE)
  }
  // Tagesdecke
  cushion(g, 0, 0.42, 0.52, mattressWidth - 0.04, 1.3, 0.08, FABRIC_BLUE)
}
