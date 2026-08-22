/**
 * Bibliothek: Sanitaer und Kueche.
 *
 * Konvention wie bei den Moebeln: Ursprung mittig in X/Y auf dem Fussboden
 * (z = 0), die Bedienseite zeigt nach -Y, die Wand liegt also in +Y. Alle
 * Masse sind reale Produktmasse in Metern.
 */

import { MAT } from './materials'
import {
  boxAt,
  circleProfile,
  cylinderBetween,
  cylinderZ,
  frustumZ,
  prismZ,
  rectProfile,
  roundedRectProfile,
  slab,
  type Pt2,
} from './parts'
import { CATEGORY_SANITARY, defineEntry, type LibraryEntry } from './types'
import type { GeomBuilder } from '../common/geom'

const CERAMIC = MAT['farbe-weiss']
const CHROME = MAT['chrom']
const STEEL = MAT['edelstahl']
const GLASS = MAT['klarglas']
const WHITE = MAT['mdf-weiss']
const ANTHRACITE = MAT['farbe-anthrazit']
const BLACK = MAT['kunststoff-schwarz']

/* ------------------------------------------------------------------ */
/* Hilfsteile                                                          */
/* ------------------------------------------------------------------ */

/**
 * Becken als offene Wanne: volle Bodenplatte plus Koerper mit Durchbruch.
 * Die gemeinsame Trennebene liegt komplett im Inneren, es entstehen keine
 * sichtbaren Doppelflaechen.
 */
function basin(
  g: GeomBuilder,
  outer: readonly Pt2[],
  bowl: readonly Pt2[],
  z0: number,
  floorThickness: number,
  bodyHeight: number,
  materialId: string,
): void {
  prismZ(g, outer, z0, floorThickness, materialId)
  prismZ(g, outer, z0 + floorThickness, bodyHeight, materialId, [bowl])
}

/** Einhebelmischer: Sockel, Saeule, Auslauf, Hebel. */
function faucet(g: GeomBuilder, cx: number, cy: number, z: number, reach: number, height = 0.28): void {
  cylinderZ(g, cx, cy, z, 0.026, 0.035, 16, CHROME)
  cylinderZ(g, cx, cy, z + 0.035, 0.019, height - 0.035, 16, CHROME)
  // Auslauf nach -Y
  cylinderBetween(
    g,
    { x: cx, y: cy, z: z + height },
    { x: cx, y: cy - reach, z: z + height },
    0.014,
    12,
    CHROME,
  )
  cylinderBetween(
    g,
    { x: cx, y: cy - reach, z: z + height },
    { x: cx, y: cy - reach, z: z + height - 0.03 },
    0.012,
    12,
    CHROME,
  )
  // Bedienhebel
  boxAt(g, cx, cy + 0.03, z + height - 0.02, 0.022, 0.09, 0.02, CHROME)
}

/** Abfluss / Ablaufgarnitur. */
function drain(g: GeomBuilder, cx: number, cy: number, z: number, radius = 0.035): void {
  cylinderZ(g, cx, cy, z - 0.002, radius, 0.006, 16, CHROME)
}

/* ------------------------------------------------------------------ */
/* Eintraege                                                           */
/* ------------------------------------------------------------------ */

export const SANITARY: LibraryEntry[] = [
  defineEntry({
    id: 'waschbecken',
    name: 'Waschbecken',
    category: CATEGORY_SANITARY,
    description: 'Waschtisch 60 × 48 cm, Oberkante 85 cm, mit Einhebelmischer und Siphon. Wandseite in +Y.',
    size: '60 × 50 × 45 cm',
    geometry(g) {
      const outer = roundedRectProfile(0, 0, 0.6, 0.48, 0.03)
      const bowl = roundedRectProfile(0, -0.03, 0.42, 0.3, 0.06)
      // Oberkante = 0,70 + 0,02 + 0,13 = 0,85 m; darauf sitzt die Armatur.
      basin(g, outer, bowl, 0.7, 0.02, 0.13, CERAMIC)
      drain(g, 0, -0.03, 0.72)
      faucet(g, 0, 0.185, 0.85, 0.13, 0.16)
      // Siphon
      cylinderZ(g, 0, -0.03, 0.58, 0.022, 0.12, 12, CHROME)
      cylinderBetween(g, { x: 0, y: -0.03, z: 0.59 }, { x: 0, y: 0.2, z: 0.59 }, 0.02, 12, CHROME)
      // Konsole zur Wand
      boxAt(g, 0, 0.21, 0.66, 0.4, 0.04, 0.06, CERAMIC)
    },
  }),

  defineEntry({
    id: 'waschtisch-unterschrank',
    name: 'Waschtisch mit Unterschrank',
    category: CATEGORY_SANITARY,
    description: 'Waschtisch 80 × 46 cm auf zweitürigem Unterschrank, Oberkante 85 cm.',
    size: '80 × 50 × 103 cm',
    geometry(g) {
      // Unterschrank
      boxAt(g, 0, 0.02, 0.12, 0.8, 0.42, 0.58, WHITE)
      boxAt(g, 0, 0.02, 0, 0.74, 0.36, 0.12, ANTHRACITE)
      for (const sx of [-1, 1]) {
        boxAt(g, sx * 0.2, -0.22, 0.14, 0.386, 0.018, 0.54, WHITE)
        boxAt(g, sx * 0.055, -0.242, 0.41, 0.016, 0.024, 0.2, STEEL)
      }
      // Aufsatzbecken
      const outer = roundedRectProfile(0, 0, 0.8, 0.46, 0.02)
      const bowl = roundedRectProfile(0, -0.02, 0.56, 0.28, 0.05)
      basin(g, outer, bowl, 0.7, 0.02, 0.13, CERAMIC)
      drain(g, 0, -0.02, 0.72)
      faucet(g, 0, 0.175, 0.85, 0.12, 0.17)
    },
  }),

  defineEntry({
    id: 'wc',
    name: 'WC mit Spülkasten',
    category: CATEGORY_SANITARY,
    description: 'Stand-WC 36 × 68 cm mit aufgesetztem Spülkasten und Sitz. Wandseite in +Y.',
    size: '36 × 68 × 78 cm',
    geometry(g) {
      // Fuss
      prismZ(g, roundedRectProfile(0, 0.06, 0.22, 0.4, 0.06), 0, 0.2, CERAMIC)
      // Keramikkoerper mit Becken
      const outer = roundedRectProfile(0, -0.06, 0.36, 0.52, 0.14)
      const bowl = roundedRectProfile(0, -0.07, 0.26, 0.4, 0.11)
      basin(g, outer, bowl, 0.2, 0.06, 0.16, CERAMIC)
      // Sitzring und Deckel
      prismZ(g, roundedRectProfile(0, -0.06, 0.37, 0.53, 0.14), 0.42, 0.02, WHITE, [
        roundedRectProfile(0, -0.07, 0.25, 0.39, 0.11),
      ])
      boxAt(g, 0, 0.19, 0.44, 0.34, 0.05, 0.02, WHITE)
      // Spuelkasten
      boxAt(g, 0, 0.24, 0.44, 0.36, 0.2, 0.34, CERAMIC)
      boxAt(g, 0, 0.24, 0.78, 0.36, 0.2, 0.02, WHITE)
      // Spueltaste
      boxAt(g, 0, 0.145, 0.72, 0.1, 0.012, 0.06, CHROME)
    },
  }),

  defineEntry({
    id: 'wc-wandhaengend',
    name: 'Wand-WC',
    category: CATEGORY_SANITARY,
    description: 'Wandhängendes WC 36 × 54 cm, Sitzhöhe 42 cm, Vorwandinstallation in +Y.',
    size: '37 × 58 × 20 cm',
    geometry(g) {
      const outer = roundedRectProfile(0, -0.04, 0.36, 0.5, 0.14)
      const bowl = roundedRectProfile(0, -0.05, 0.26, 0.38, 0.11)
      basin(g, outer, bowl, 0.26, 0.05, 0.11, CERAMIC)
      // Anschluss zur Vorwand
      boxAt(g, 0, 0.24, 0.24, 0.26, 0.08, 0.16, CERAMIC)
      prismZ(g, roundedRectProfile(0, -0.04, 0.37, 0.51, 0.14), 0.42, 0.02, WHITE, [
        roundedRectProfile(0, -0.05, 0.25, 0.37, 0.11),
      ])
    },
  }),

  defineEntry({
    id: 'dusche',
    name: 'Dusche 90 × 90',
    category: CATEGORY_SANITARY,
    description: 'Eckdusche 90 × 90 cm mit flacher Wanne, zwei Glaswänden und Kopfbrause. Ecke in +X/+Y.',
    size: '90 × 90 × 212 cm',
    geometry(g) {
      const s = 0.9
      const h = 2.0
      // Duschtasse
      const outer = rectProfile(0, 0, s, s)
      const bowl = rectProfile(0, 0, s - 0.09, s - 0.09)
      basin(g, outer, bowl, 0, 0.015, 0.045, CERAMIC)
      drain(g, 0, 0, 0.016, 0.045)
      // Glaswaende an +X und +Y
      boxAt(g, s / 2 - 0.004, 0, 0.06, 0.008, s, h - 0.06, GLASS)
      boxAt(g, 0, s / 2 - 0.004, 0.06, s - 0.016, 0.008, h - 0.06, GLASS)
      // Profile
      boxAt(g, s / 2 - 0.012, -s / 2 + 0.012, 0.06, 0.024, 0.024, h - 0.06, STEEL)
      boxAt(g, s / 2 - 0.012, s / 2 - 0.012, 0.06, 0.024, 0.024, h - 0.06, STEEL)
      boxAt(g, -s / 2 + 0.012, s / 2 - 0.012, 0.06, 0.024, 0.024, h - 0.06, STEEL)
      // Armatur und Kopfbrause an der Wand +Y
      cylinderZ(g, -s / 2 + 0.18, s / 2 - 0.05, 1.1, 0.026, 0.16, 16, CHROME)
      cylinderZ(g, -s / 2 + 0.18, s / 2 - 0.05, 1.26, 0.014, 0.86, 12, CHROME)
      cylinderBetween(
        g,
        { x: -s / 2 + 0.18, y: s / 2 - 0.05, z: 2.02 },
        { x: -s / 2 + 0.18, y: s / 2 - 0.32, z: 2.02 },
        0.013,
        12,
        CHROME,
      )
      prismZ(g, circleProfile(-s / 2 + 0.18, s / 2 - 0.32, 0.11, 24), 1.98, 0.025, CHROME)
    },
  }),

  defineEntry({
    id: 'badewanne',
    name: 'Badewanne',
    category: CATEGORY_SANITARY,
    description: 'Rechteck-Badewanne 170 × 75 cm, Einbauhöhe 58 cm, mit Wannenrandarmatur.',
    size: '170 × 75 × 73 cm',
    geometry(g) {
      const outer = roundedRectProfile(0, 0, 1.7, 0.75, 0.05)
      const bowl = roundedRectProfile(0, 0, 1.52, 0.6, 0.12)
      basin(g, outer, bowl, 0, 0.16, 0.42, CERAMIC)
      drain(g, -0.6, 0, 0.17)
      // Armatur am Wannenrand
      faucet(g, -0.72, 0.3, 0.58, 0.16, 0.14)
    },
  }),

  defineEntry({
    id: 'spuele',
    name: 'Spüle',
    category: CATEGORY_SANITARY,
    description: 'Einbauspüle aus Edelstahl mit Becken und Abtropffläche, Oberkante 86 cm (passt auf den Küchen-Unterschrank).',
    size: '86 × 53 × 49 cm',
    geometry(g) {
      const outer = roundedRectProfile(0, 0, 0.86, 0.5, 0.02)
      const bowl = roundedRectProfile(-0.19, -0.01, 0.4, 0.36, 0.04)
      basin(g, outer, bowl, 0.68, 0.02, 0.16, STEEL)
      drain(g, -0.19, -0.01, 0.7)
      // Abtropfrillen
      for (let i = 0; i < 5; i++) {
        boxAt(g, 0.13 + i * 0.055, 0, 0.858, 0.012, 0.3, 0.004, ANTHRACITE)
      }
      faucet(g, -0.19, 0.2, 0.86, 0.2, 0.3)
    },
  }),

  defineEntry({
    id: 'herd',
    name: 'Herd mit Backofen',
    category: CATEGORY_SANITARY,
    description: 'Standherd 60 × 60 cm mit vier Kochzonen, Backofentür und Bedienblende. Front in -Y.',
    size: '60 × 65 × 86 cm',
    geometry(g) {
      const w = 0.6
      const d = 0.6
      // Korpus
      boxAt(g, 0, 0.01, 0.06, w, d - 0.02, 0.79, STEEL)
      boxAt(g, 0, 0.02, 0, w - 0.04, d - 0.08, 0.06, ANTHRACITE)
      // Backofentuer mit Sichtfenster
      boxAt(g, 0, -d / 2 + 0.01, 0.1, w - 0.01, 0.022, 0.5, STEEL)
      boxAt(g, 0, -d / 2 - 0.004, 0.18, w - 0.14, 0.008, 0.34, MAT['getoentes-glas'])
      boxAt(g, 0, -d / 2 - 0.035, 0.63, w - 0.06, 0.022, 0.022, STEEL)
      // Bedienblende
      boxAt(g, 0, -d / 2 + 0.006, 0.68, w - 0.01, 0.014, 0.08, ANTHRACITE)
      for (let i = 0; i < 4; i++) {
        cylinderBetween(
          g,
          { x: -0.21 + i * 0.14, y: -d / 2 - 0.001, z: 0.72 },
          { x: -0.21 + i * 0.14, y: -d / 2 - 0.022, z: 0.72 },
          0.018,
          14,
          BLACK,
        )
      }
      // Glaskeramik-Kochfeld
      slab(g, 0, 0.01, 0.85, w - 0.02, d - 0.04, 0.01, 0.01, BLACK)
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          prismZ(g, circleProfile(sx * 0.13, 0.01 + sy * 0.13, sy > 0 ? 0.09 : 0.075, 24), 0.859, 0.001, ANTHRACITE)
        }
      }
    },
  }),

  defineEntry({
    id: 'kuehlschrank',
    name: 'Kühl-Gefrierkombination',
    category: CATEGORY_SANITARY,
    description: 'Standgerät 60 × 65 cm, 185 cm hoch, zwei Türen mit Stangengriffen. Front in -Y.',
    size: '60 × 69 × 185 cm',
    geometry(g) {
      const w = 0.6
      const d = 0.65
      const h = 1.85
      // Korpus
      boxAt(g, 0, 0.015, 0.02, w, d - 0.03, h - 0.02, STEEL)
      boxAt(g, 0, 0.02, 0, w - 0.06, d - 0.1, 0.02, ANTHRACITE)
      // Kuehlteil oben, Gefrierteil unten
      const splitZ = 0.62
      boxAt(g, 0, -d / 2 + 0.012, splitZ + 0.012, w - 0.006, 0.026, h - splitZ - 0.024, STEEL)
      boxAt(g, 0, -d / 2 + 0.012, 0.03, w - 0.006, 0.026, splitZ - 0.03, STEEL)
      // Fugendichtung
      boxAt(g, 0, -d / 2 + 0.012, splitZ - 0.002, w - 0.006, 0.026, 0.008, ANTHRACITE)
      // Stangengriffe
      for (const z of [splitZ + 0.1, splitZ - 0.14]) {
        boxAt(g, w / 2 - 0.07, -d / 2 - 0.03, z, 0.02, 0.02, 0.28, STEEL)
        boxAt(g, w / 2 - 0.07, -d / 2 - 0.012, z + 0.13, 0.02, 0.024, 0.02, STEEL)
        boxAt(g, w / 2 - 0.07, -d / 2 - 0.012, z - 0.13, 0.02, 0.024, 0.02, STEEL)
      }
    },
  }),

  defineEntry({
    id: 'oberschrank',
    name: 'Küchen-Oberschrank',
    category: CATEGORY_SANITARY,
    description: 'Hängeschrank 60 × 35 cm, Unterkante üblicherweise 145 cm über dem Boden. Front in -Y.',
    size: '60 × 37 × 72 cm',
    geometry(g) {
      const w = 0.6
      const d = 0.35
      boxAt(g, 0, 0.01, 0, w, d - 0.02, 0.72, WHITE)
      boxAt(g, 0, -d / 2 + 0.009, 0.004, w - 0.004, 0.019, 0.712, WHITE)
      boxAt(g, 0, -d / 2 - 0.012, 0.06, 0.32, 0.024, 0.016, STEEL)
    },
  }),

  defineEntry({
    id: 'heizkoerper',
    name: 'Heizkörper',
    category: CATEGORY_SANITARY,
    description: 'Flachheizkörper 120 × 60 cm mit Thermostatventil, Wandseite in +Y.',
    size: '125 × 8 × 75 cm',
    geometry(g) {
      const w = 1.2
      const h = 0.6
      const z0 = 0.15
      boxAt(g, 0, -0.025, z0, w, 0.03, h, CERAMIC)
      boxAt(g, 0, 0.025, z0, w, 0.03, h, CERAMIC)
      // Konvektorbleche
      for (let i = 0; i < 24; i++) {
        boxAt(g, -w / 2 + 0.03 + i * ((w - 0.06) / 23), 0, z0 + 0.02, 0.008, 0.04, h - 0.04, CERAMIC)
      }
      // Anschluesse und Thermostat
      cylinderZ(g, -w / 2 + 0.06, 0, z0 - 0.15, 0.012, 0.15, 10, CHROME)
      cylinderZ(g, w / 2 - 0.06, 0, z0 - 0.15, 0.012, 0.15, 10, CHROME)
      cylinderBetween(
        g,
        { x: w / 2 - 0.06, y: 0, z: z0 + 0.06 },
        { x: w / 2 + 0.05, y: 0, z: z0 + 0.06 },
        0.023,
        14,
        WHITE,
      )
    },
  }),
]

/** Nur fuer die Typpruefung der selten benutzten Helfer. */
void frustumZ
