/**
 * Bibliothek: Grundkoerper.
 *
 * Einheitsgrosse Bausteine (Kantenlaenge bzw. Durchmesser 1 m), zentriert in
 * X/Y und auf z = 0 stehend. Sie sind der schnellste Weg, um mit dem
 * Skalierwerkzeug etwas Beliebiges zu bauen.
 */

import { MAT } from './materials'
import { box, cylinderZ, frustumZ, prismZ, pyramid, sphere, torus, tubeZ, wedge, circleProfile } from './parts'
import { CATEGORY_PRIMITIVE, defineEntry, type LibraryEntry } from './types'

const DEFAULT = MAT['farbe-hellgrau']

export const PRIMITIVES: LibraryEntry[] = [
  defineEntry({
    id: 'quader',
    name: 'Quader',
    category: CATEGORY_PRIMITIVE,
    description: 'Würfel mit 1 m Kantenlänge, zentriert über dem Ursprung.',
    size: '100 × 100 × 100 cm',
    geometry(g) {
      box(g, -0.5, -0.5, 0, 0.5, 0.5, 1.0, DEFAULT)
    },
  }),

  defineEntry({
    id: 'zylinder',
    name: 'Zylinder',
    category: CATEGORY_PRIMITIVE,
    description: 'Zylinder Ø 100 cm, 100 cm hoch, 24 Segmente.',
    size: 'Ø 100 × 100 cm',
    geometry(g) {
      cylinderZ(g, 0, 0, 0, 0.5, 1.0, 24, DEFAULT)
    },
  }),

  defineEntry({
    id: 'kugel',
    name: 'Kugel',
    category: CATEGORY_PRIMITIVE,
    description: 'Kugel Ø 100 cm, sie liegt auf z = 0 auf.',
    size: 'Ø 100 cm',
    geometry(g) {
      sphere(g, { x: 0, y: 0, z: 0.5 }, 0.5, 24, 14, DEFAULT)
    },
  }),

  defineEntry({
    id: 'kegel',
    name: 'Kegel',
    category: CATEGORY_PRIMITIVE,
    description: 'Kegel Ø 100 cm Grundfläche, 100 cm hoch.',
    size: 'Ø 100 × 100 cm',
    geometry(g) {
      frustumZ(g, 0, 0, 0, 0.5, 0, 1.0, 24, DEFAULT)
    },
  }),

  defineEntry({
    id: 'kegelstumpf',
    name: 'Kegelstumpf',
    category: CATEGORY_PRIMITIVE,
    description: 'Kegelstumpf, unten Ø 100 cm, oben Ø 50 cm, 100 cm hoch.',
    size: 'Ø 100 × 100 cm',
    geometry(g) {
      frustumZ(g, 0, 0, 0, 0.5, 0.25, 1.0, 24, DEFAULT)
    },
  }),

  defineEntry({
    id: 'pyramide',
    name: 'Pyramide',
    category: CATEGORY_PRIMITIVE,
    description: 'Pyramide über quadratischer Grundfläche 100 × 100 cm, 100 cm hoch.',
    size: '100 × 100 × 100 cm',
    geometry(g) {
      pyramid(g, 0, 0, 0, 1.0, 1.0, 1.0, DEFAULT)
    },
  }),

  defineEntry({
    id: 'torus',
    name: 'Torus',
    category: CATEGORY_PRIMITIVE,
    description: 'Torus, Ringdurchmesser 100 cm, Rohrdurchmesser 30 cm, liegt in der XY-Ebene.',
    size: '130 × 130 × 30 cm',
    geometry(g) {
      torus(g, { x: 0, y: 0, z: 0.15 }, 0.5, 0.15, 32, 14, DEFAULT)
    },
  }),

  defineEntry({
    id: 'keil',
    name: 'Keil',
    category: CATEGORY_PRIMITIVE,
    description: 'Rampe 100 × 100 cm, ansteigend nach +X auf 100 cm Höhe.',
    size: '100 × 100 × 100 cm',
    geometry(g) {
      wedge(g, -0.5, -0.5, 0, 0.5, 0.5, 1.0, DEFAULT)
    },
  }),

  defineEntry({
    id: 'rohr',
    name: 'Rohr',
    category: CATEGORY_PRIMITIVE,
    description: 'Hohlzylinder, außen Ø 100 cm, innen Ø 80 cm, 100 cm hoch.',
    size: 'Ø 100 × 100 cm',
    geometry(g) {
      tubeZ(g, 0, 0, 0, 0.5, 0.4, 1.0, 24, DEFAULT)
    },
  }),

  defineEntry({
    id: 'prisma-sechseck',
    name: 'Sechskantprisma',
    category: CATEGORY_PRIMITIVE,
    description: 'Regelmäßiges Sechseck, Umkreis Ø 100 cm, 100 cm hoch.',
    size: '100 × 87 × 100 cm',
    geometry(g) {
      prismZ(g, circleProfile(0, 0, 0.5, 6), 0, 1.0, DEFAULT)
    },
  }),

  defineEntry({
    id: 'halbkugel',
    name: 'Halbkugel',
    category: CATEGORY_PRIMITIVE,
    description: 'Kuppel Ø 100 cm, 50 cm hoch, mit geschlossener Bodenfläche.',
    size: 'Ø 100 × 50 cm',
    geometry(g) {
      const segments = 24
      const rings = 7
      const opts = { materialId: DEFAULT, soft: true, smooth: true }
      const at = (iu: number, iv: number) => {
        const theta = (iu / segments) * Math.PI * 2
        const phi = (iv / rings) * (Math.PI / 2)
        const cp = Math.cos(phi)
        return {
          x: Math.cos(theta) * cp * 0.5,
          y: Math.sin(theta) * cp * 0.5,
          z: Math.sin(phi) * 0.5,
        }
      }
      for (let iv = 0; iv < rings; iv++) {
        for (let iu = 0; iu < segments; iu++) {
          const a = at(iu, iv)
          const b = at(iu + 1, iv)
          const c = at(iu + 1, iv + 1)
          const d = at(iu, iv + 1)
          if (iv === rings - 1) g.face([a, b, c], [], opts)
          else g.face([a, b, c, d], [], opts)
        }
      }
      // Bodenscheibe
      g.face([...circleProfile(0, 0, 0.5, segments).map((p) => ({ x: p.x, y: p.y, z: 0 }))].reverse(), [], {
        materialId: DEFAULT,
      })
    },
  }),

  defineEntry({
    id: 'platte',
    name: 'Platte',
    category: CATEGORY_PRIMITIVE,
    description: 'Dünne Platte 100 × 100 cm, 2 cm stark - Ausgangspunkt für Bleche und Deckel.',
    size: '100 × 100 × 2 cm',
    geometry(g) {
      box(g, -0.5, -0.5, 0, 0.5, 0.5, 0.02, DEFAULT)
    },
  }),
]
