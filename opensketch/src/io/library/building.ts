/**
 * Bibliothek: Bauteile.
 *
 * Tueren und Fenster stehen mittig auf z = 0 im Ursprung, die Wandebene liegt
 * bei y = 0 - so lassen sie sich direkt auf eine Wand kleben (`glueTo:
 * 'vertical'`, `cutsOpening: true`). Waende, Treppen und Platten beginnen am
 * Ursprung und wachsen nach +X / +Y / +Z.
 */

import { MAT } from './materials'
import {
  box,
  boxAt,
  cylinderZ,
  frameXZ,
  prismXZ,
  prismZ,
  rectProfile,
  wedge,
  type Pt2,
} from './parts'
import { CATEGORY_BUILDING, defineEntry, FLOOR_BEHAVIOR, OPENING_BEHAVIOR, type LibraryEntry } from './types'
import type { GeomBuilder } from '../common/geom'

const PLASTER = MAT['farbe-weiss']
const CONCRETE = MAT['beton']
const BRICK = MAT['ziegel-rot']
const WOOD = MAT['eiche-hell']
const WOOD_STRUCT = MAT['kiefer']
const WHITE = MAT['mdf-weiss']
const GLASS = MAT['klarglas']
const STEEL = MAT['stahl-gebuerstet']
const CHROME = MAT['chrom']

/* ------------------------------------------------------------------ */
/* Hilfsteile                                                          */
/* ------------------------------------------------------------------ */

/** Tuerblatt mit Drueckergarnitur, Blattmitte bei x = cx. */
function doorLeaf(g: GeomBuilder, cx: number, width: number, height: number, hingeLeft: boolean): void {
  const t = 0.039
  boxAt(g, cx, 0, 0.012, width, t, height, WHITE)
  const handleX = hingeLeft ? cx + width / 2 - 0.055 : cx - width / 2 + 0.055
  for (const sy of [-1, 1]) {
    cylinderZ(g, handleX, sy * (t / 2 + 0.012), 1.03, 0.026, 0.008, 12, CHROME)
    // Drueckerstange laeuft in -Y bzw. +Y aus der Rosette
    box(
      g,
      handleX - 0.012,
      sy > 0 ? t / 2 + 0.02 : -t / 2 - 0.075,
      1.018,
      handleX + 0.012,
      sy > 0 ? t / 2 + 0.075 : -t / 2 - 0.02,
      1.042,
      CHROME,
    )
  }
}

/** Fensterfluegel: Rahmen plus Glasscheibe. */
function sash(g: GeomBuilder, cx: number, width: number, z0: number, height: number): void {
  const p = 0.055
  const t = 0.062
  // Rahmenprofil des Fluegels
  box(g, cx - width / 2, -t / 2, z0, cx - width / 2 + p, t / 2, z0 + height, WHITE)
  box(g, cx + width / 2 - p, -t / 2, z0, cx + width / 2, t / 2, z0 + height, WHITE)
  box(g, cx - width / 2 + p, -t / 2, z0 + height - p, cx + width / 2 - p, t / 2, z0 + height, WHITE)
  box(g, cx - width / 2 + p, -t / 2, z0, cx + width / 2 - p, t / 2, z0 + p, WHITE)
  // Glas
  box(g, cx - width / 2 + p, -0.01, z0 + p, cx + width / 2 - p, 0.01, z0 + height - p, GLASS)
}

/** Kompletter Fensterbauteil: Blendrahmen, Fluegel, Fensterbank. */
function window(g: GeomBuilder, width: number, height: number, sill: number, sashes: number): void {
  const frame = 0.07
  const depth = 0.12
  // Blendrahmen ringsum
  frameXZ(g, width, height, depth, frame, sill, WHITE)
  box(g, -width / 2 + frame, -depth / 2, sill, width / 2 - frame, depth / 2, sill + frame, WHITE)
  // Fluegel
  const inner = width - 2 * frame
  const sw = inner / sashes
  for (let i = 0; i < sashes; i++) {
    sash(g, -inner / 2 + sw * (i + 0.5), sw - 0.004, sill + frame + 0.004, height - 2 * frame - 0.008)
  }
  // Fensterbank innen
  box(g, -width / 2 - 0.03, depth / 2 - 0.02, sill - 0.03, width / 2 + 0.03, depth / 2 + 0.13, sill, WOOD)
  // Aussenbank
  box(g, -width / 2 - 0.04, -depth / 2 - 0.06, sill - 0.035, width / 2 + 0.04, -depth / 2 + 0.02, sill, MAT['zinkblech'])
}

/** Treppenprofil in der XZ-Ebene. */
function stairProfile(steps: number, rise: number, tread: number): Pt2[] {
  const run = steps * tread
  const height = steps * rise
  const pts: Pt2[] = [
    { x: 0, y: 0 },
    { x: run, y: 0 },
    { x: run, y: height },
  ]
  for (let i = steps - 1; i >= 0; i--) {
    pts.push({ x: i * tread, y: (i + 1) * rise })
    pts.push({ x: i * tread, y: i * rise })
  }
  return pts
}

/* ------------------------------------------------------------------ */
/* Eintraege                                                           */
/* ------------------------------------------------------------------ */

export const BUILDING: LibraryEntry[] = [
  defineEntry({
    id: 'wand',
    name: 'Wand 24 cm',
    category: CATEGORY_BUILDING,
    description: 'Tragende Wand, 24 cm stark. Beginnt im Ursprung und läuft nach +X.',
    size: '300 × 24 × 250 cm',
    geometry(g) {
      box(g, 0, -0.12, 0, 3.0, 0.12, 2.5, PLASTER)
    },
  }),

  defineEntry({
    id: 'wand-leicht',
    name: 'Trennwand 11,5 cm',
    category: CATEGORY_BUILDING,
    description: 'Nichttragende Trennwand, 11,5 cm stark, ab Ursprung nach +X.',
    size: '300 × 11,5 × 250 cm',
    geometry(g) {
      box(g, 0, -0.0575, 0, 3.0, 0.0575, 2.5, PLASTER)
    },
  }),

  defineEntry({
    id: 'tuer-einfach',
    name: 'Tür einfach',
    category: CATEGORY_BUILDING,
    description: 'Innentür 88,5 × 201 cm mit Zarge und Drücker. Öffnung mittig im Ursprung.',
    size: '88,5 × 201 cm (Öffnung)',
    behavior: OPENING_BEHAVIOR,
    geometry(g) {
      const w = 0.885
      const h = 2.01
      const frame = 0.06
      const depth = 0.14
      frameXZ(g, w + 2 * frame, h + frame, depth, frame, 0, WHITE)
      doorLeaf(g, 0, w - 0.015, h - 0.02, true)
    },
  }),

  defineEntry({
    id: 'tuer-doppel',
    name: 'Doppeltür',
    category: CATEGORY_BUILDING,
    description: 'Zweiflügelige Tür 177 × 201 cm mit Zarge. Öffnung mittig im Ursprung.',
    size: '177 × 201 cm (Öffnung)',
    behavior: OPENING_BEHAVIOR,
    geometry(g) {
      const w = 1.77
      const h = 2.01
      const frame = 0.06
      const depth = 0.14
      frameXZ(g, w + 2 * frame, h + frame, depth, frame, 0, WHITE)
      doorLeaf(g, -w / 4, w / 2 - 0.015, h - 0.02, false)
      doorLeaf(g, w / 4, w / 2 - 0.015, h - 0.02, true)
    },
  }),

  defineEntry({
    id: 'fenster-einfach',
    name: 'Fenster einflügelig',
    category: CATEGORY_BUILDING,
    description: 'Fenster 100 × 130 cm, Brüstung 90 cm. Öffnung mittig im Ursprung.',
    size: '100 × 130 cm (Öffnung)',
    behavior: OPENING_BEHAVIOR,
    geometry(g) {
      window(g, 1.0, 1.3, 0.9, 1)
    },
  }),

  defineEntry({
    id: 'fenster-zwei',
    name: 'Fenster zweiflügelig',
    category: CATEGORY_BUILDING,
    description: 'Fenster 150 × 130 cm mit zwei Flügeln, Brüstung 90 cm.',
    size: '150 × 130 cm (Öffnung)',
    behavior: OPENING_BEHAVIOR,
    geometry(g) {
      window(g, 1.5, 1.3, 0.9, 2)
    },
  }),

  defineEntry({
    id: 'fenster-bodentief',
    name: 'Fenster bodentief',
    category: CATEGORY_BUILDING,
    description: 'Bodentiefes Fenster 100 × 220 cm ohne Brüstung.',
    size: '100 × 220 cm (Öffnung)',
    behavior: OPENING_BEHAVIOR,
    geometry(g) {
      window(g, 1.0, 2.2, 0.0, 1)
    },
  }),

  defineEntry({
    id: 'treppe-gerade',
    name: 'Treppe gerade',
    category: CATEGORY_BUILDING,
    description: '16 Steigungen à 17,5 cm, Auftritt 28 cm, Laufbreite 100 cm. Steigt nach +X.',
    size: '448 × 100 × 280 cm',
    geometry(g) {
      const width = 1.0
      prismXZ(g, stairProfile(16, 0.175, 0.28), width / 2, width, CONCRETE)
    },
  }),

  defineEntry({
    id: 'treppe-podest',
    name: 'Treppe halbes Geschoss',
    category: CATEGORY_BUILDING,
    description: '8 Steigungen à 17,5 cm für ein halbes Geschoss, Laufbreite 100 cm.',
    size: '224 × 100 × 140 cm',
    geometry(g) {
      prismXZ(g, stairProfile(8, 0.175, 0.28), 0.5, 1.0, CONCRETE)
    },
  }),

  defineEntry({
    id: 'gelaender',
    name: 'Geländer',
    category: CATEGORY_BUILDING,
    description: 'Stabgeländer 200 cm lang, 100 cm hoch, ab Ursprung nach +X.',
    size: '200 × 5 × 100 cm',
    geometry(g) {
      const length = 2.0
      const height = 1.0
      // Pfosten
      for (const x of [0.03, length / 2, length - 0.03]) {
        boxAt(g, x, 0, 0, 0.045, 0.045, height - 0.04, STEEL)
      }
      // Handlauf
      box(g, 0, -0.025, height - 0.04, length, 0.025, height, STEEL)
      // Fuellstaebe
      const bars = 16
      for (let i = 1; i < bars; i++) {
        const x = (length * i) / bars
        if (Math.abs(x - length / 2) < 0.04) continue
        boxAt(g, x, 0, 0.02, 0.014, 0.014, height - 0.06, STEEL)
      }
      box(g, 0, -0.012, 0.0, length, 0.012, 0.02, STEEL)
    },
  }),

  defineEntry({
    id: 'dachschraege',
    name: 'Dachschräge',
    category: CATEGORY_BUILDING,
    description: 'Dachschräge 35°, Grundfläche 400 × 300 cm, First bei 280 cm.',
    size: '400 × 300 × 280 cm',
    geometry(g) {
      wedge(g, 0, -1.5, 0, 4.0, 1.5, 2.8, MAT['dachziegel-rot'])
    },
  }),

  defineEntry({
    id: 'saeule-rund',
    name: 'Säule rund',
    category: CATEGORY_BUILDING,
    description: 'Rundstütze Ø 30 cm mit Fuß- und Kopfplatte, 280 cm hoch.',
    size: '40 × 40 × 280 cm',
    geometry(g) {
      boxAt(g, 0, 0, 0, 0.4, 0.4, 0.04, CONCRETE)
      cylinderZ(g, 0, 0, 0.04, 0.15, 2.72, 24, CONCRETE)
      boxAt(g, 0, 0, 2.76, 0.4, 0.4, 0.04, CONCRETE)
    },
  }),

  defineEntry({
    id: 'stuetze-eckig',
    name: 'Stütze 24 × 24',
    category: CATEGORY_BUILDING,
    description: 'Quadratische Stahlbetonstütze 24 × 24 cm, 280 cm hoch.',
    size: '24 × 24 × 280 cm',
    geometry(g) {
      boxAt(g, 0, 0, 0, 0.24, 0.24, 2.8, CONCRETE)
    },
  }),

  defineEntry({
    id: 'fundamentplatte',
    name: 'Fundamentplatte',
    category: CATEGORY_BUILDING,
    description: 'Bodenplatte 500 × 400 cm, 25 cm stark. Oberkante liegt auf z = 0.',
    size: '500 × 400 × 25 cm',
    behavior: FLOOR_BEHAVIOR,
    geometry(g) {
      box(g, -2.5, -2.0, -0.25, 2.5, 2.0, 0, CONCRETE)
    },
  }),

  defineEntry({
    id: 'balken',
    name: 'Holzbalken',
    category: CATEGORY_BUILDING,
    description: 'Konstruktionsvollholz 12 × 24 cm, 400 cm lang, ab Ursprung nach +X.',
    size: '400 × 12 × 24 cm',
    geometry(g) {
      box(g, 0, -0.06, 0, 4.0, 0.06, 0.24, WOOD_STRUCT)
    },
  }),

  defineEntry({
    id: 'sturz',
    name: 'Ziegelsturz',
    category: CATEGORY_BUILDING,
    description: 'Fertigteilsturz 24 cm breit, 1,25 m lang, für Öffnungen bis 100 cm.',
    size: '125 × 24 × 11,3 cm',
    geometry(g) {
      box(g, 0, -0.12, 0, 1.25, 0.12, 0.113, BRICK)
    },
  }),

  defineEntry({
    id: 'geschossdecke',
    name: 'Geschossdecke',
    category: CATEGORY_BUILDING,
    description: 'Stahlbetondecke 500 × 400 cm, 20 cm stark. Oberkante liegt auf z = 0.',
    size: '500 × 400 × 20 cm',
    behavior: FLOOR_BEHAVIOR,
    geometry(g) {
      box(g, -2.5, -2.0, -0.2, 2.5, 2.0, 0, CONCRETE)
    },
  }),

  defineEntry({
    id: 'dachgaube',
    name: 'Schleppgaube',
    category: CATEGORY_BUILDING,
    description: 'Gaubenkörper 180 × 150 cm mit Fensteröffnung, Pultdach.',
    size: '180 × 150 × 190 cm',
    geometry(g) {
      const w = 1.8
      const d = 1.5
      // Wangen - das Profil muss in (x, z) gegen den Uhrzeigersinn laufen,
      // sonst zeigen die Normalen nach innen.
      for (const sx of [-1, 1]) {
        const outerX = sx * (w / 2)
        const innerX = sx * (w / 2 - 0.12)
        const ring: Pt2[] = [
          { x: Math.min(outerX, innerX), y: 0 },
          { x: Math.max(outerX, innerX), y: 0 },
          { x: Math.max(outerX, innerX), y: 1.6 },
          { x: Math.min(outerX, innerX), y: 1.6 },
        ]
        prismXZ(g, ring, -d / 2, d, PLASTER)
      }
      // Front
      box(g, -w / 2, -d / 2, 0, w / 2, -d / 2 + 0.12, 1.6, PLASTER)
      // Pultdach
      wedge(g, -w / 2 - 0.08, -d / 2 - 0.1, 1.6, w / 2 + 0.08, d / 2, 1.9, MAT['zinkblech'])
    },
  }),

  defineEntry({
    id: 'sockelleiste',
    name: 'Sockelleiste',
    category: CATEGORY_BUILDING,
    description: 'Fußleiste 6 cm hoch, 2 m lang, ab Ursprung nach +X.',
    size: '200 × 1,6 × 6 cm',
    geometry(g) {
      prismZ(g, rectProfile(1.0, 0, 2.0, 0.016), 0, 0.06, WHITE)
    },
  }),
]

export function buildingParts(): LibraryEntry[] {
  return BUILDING
}
