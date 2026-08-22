/**
 * `ExportResult.warnings` - was der Export weglaesst, muss er sagen.
 *
 * Der Projektstandard "Kein stilles Scheitern" gilt auch auf der
 * Ausgabeseite: Ein flaechenloser Grundriss ergibt eine gueltige, leere
 * STL-Datei, und ohne Warnung sieht das fuer den Nutzer aus wie Erfolg.
 *
 * Jedes Format bekommt deshalb zwei Testarten:
 *  - einen Fall, in dem etwas verloren geht und eine Warnung entsteht,
 *  - einen Fall, in dem nichts verloren geht und `warnings` leer bleibt.
 *
 * Die leeren Faelle sind die wichtigeren: Eine Warnung, die immer kommt,
 * liest nach der dritten Datei niemand mehr.
 */

import { describe, expect, it } from 'vitest'
import type { Id, InstanceEntity, Material, SketchDocument, Vec3Like } from '@/shared/types'
import { newId } from '@/shared/ids'
import { M } from '@/core/math'
import type { ExportFormat } from '../api-types'
import { exportDocument } from '..'
import { exportAs, exportOsk } from '../exporters'
import { exportStlAscii, exportStlBinary } from '../exporters/stl'
import { exportObj } from '../exporters/obj'
import { exportDae } from '../exporters/dae'
import { exportGlb, exportGltf } from '../exporters/gltf'
import { exportSvg } from '../exporters/svg'
import { exportPng, pngFromDataUrl } from '../exporters/png'
import { GeomBuilder } from '../common/geom'
import { bytesToDataUrl } from '../common/util'
import { addBox, addGroup, cubeDoc, emptyDoc, rootGeometry } from './helpers'

/* ------------------------------------------------------------------ */
/* Testmodelle                                                         */
/* ------------------------------------------------------------------ */

const RECT: Vec3Like[] = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 4, y: 3, z: 0 },
  { x: 0, y: 3, z: 0 },
]

/** Gezeichneter, noch nicht geschlossener Grundriss: vier Kanten, keine Flaeche. */
function outlineDoc(): SketchDocument {
  const doc = emptyDoc('Grundriss')
  new GeomBuilder(rootGeometry(doc)).polyline(RECT, true)
  return doc
}

/** Einzelne Flaeche in der Ebene z = 0 - fuer die Draufsicht ohne Tiefe. */
function flatFaceDoc(): SketchDocument {
  const doc = emptyDoc('Platte')
  new GeomBuilder(rootGeometry(doc)).face(RECT)
  return doc
}

/** Wuerfel plus eine freistehende Kante daneben. */
function cubeWithLooseEdge(): SketchDocument {
  const doc = cubeDoc(2)
  new GeomBuilder(rootGeometry(doc)).edgePoints({ x: 5, y: 0, z: 0 }, { x: 7, y: 0, z: 0 })
  return doc
}

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  return bytes
}

/** Wuerfel mit texturiertem Material; `dataUrl` steuert Lesbarkeit. */
function texturedCubeDoc(dataUrl = bytesToDataUrl('image/png', pngBytes())): SketchDocument {
  const doc = emptyDoc('Wuerfel')
  const textureId: Id = newId('t')
  doc.textures[textureId] = { id: textureId, name: 'Ziegel', dataUrl, width: 4, height: 4 }
  const material: Material = {
    id: newId('m'),
    name: 'Ziegel',
    color: '#a0522d',
    opacity: 1,
    textureId,
    textureWidth: 1,
    textureHeight: 1,
    roughness: 0.8,
    metalness: 0,
    category: 'Mauerwerk',
    colorize: false,
  }
  doc.materials[material.id] = material
  addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, material.id)
  return doc
}

/** Flaeche mit eigenem Rueckseitenmaterial. */
function backMaterialDoc(): SketchDocument {
  const doc = emptyDoc('Zweiseitig')
  const front = newId('m')
  const back = newId('m')
  for (const [id, name, color] of [
    [front, 'Vorne', '#ffffff'],
    [back, 'Hinten', '#333333'],
  ] as const) {
    doc.materials[id] = {
      id,
      name,
      color,
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.5,
      metalness: 0,
      category: 'Test',
      colorize: false,
    }
  }
  new GeomBuilder(rootGeometry(doc)).face(RECT, [], { materialId: front, backMaterialId: back })
  return doc
}

/**
 * Flaeche mit einem NaN-Eckpunkt. Genau der Fall aus CLAUDE.md: NaN besteht
 * jede Toleranzpruefung der Form "ist der Betrag kleiner als ...", rutschte
 * deshalb bis in die Datei und wurde von `num()` zu einer erfundenen 0.
 */
function nanFaceDoc(): SketchDocument {
  const doc = emptyDoc('Entartet')
  const geom = rootGeometry(doc)
  new GeomBuilder(geom).face(RECT)
  Object.values(geom.vertices)[0].p = { x: NaN, y: 0, z: 0 }
  return doc
}

/** Gruppe, die eine Instanz ihrer selbst enthaelt - die Traversierung bricht ab. */
function cyclicDoc(): SketchDocument {
  const doc = emptyDoc('Ring')
  const { definition } = addGroup(doc, 'Ring', M.identity(), (geom) => {
    addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
  })
  const inner: InstanceEntity = {
    id: newId('e'),
    type: 'instance',
    name: 'Ring in sich',
    definitionId: definition.id,
    transform: M.translation({ x: 2, y: 0, z: 0 }),
    isGroup: true,
    materialId: null,
    tagId: null,
    hidden: false,
    locked: false,
  }
  doc.entities[inner.id] = inner
  definition.children.push(inner.id)
  return doc
}

/** Alle Warnungen eines Ergebnisses als ein durchsuchbarer Text. */
function joined(warnings: string[]): string {
  return warnings.join('\n')
}

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

describe('Contract', () => {
  it('liefert bei jedem Format eine Warnungsliste, nie undefined', async () => {
    const image = new Blob([pngBytes().slice().buffer], { type: 'image/png' })
    const formats: ExportFormat[] = ['osk', 'obj', 'stl', 'stl-ascii', 'gltf', 'glb', 'dae', 'svg', 'png']
    for (const format of formats) {
      const result = await exportAs(cubeDoc(2), format, { image })
      expect(Array.isArray(result.warnings), format).toBe(true)
    }
  })

  it('reicht die Warnungen durch die oeffentliche Fassade durch', async () => {
    const result = await exportDocument(outlineDoc(), 'stl')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('formuliert alle Warnungen auf Deutsch, mit Umlauten und Handlungshinweis', async () => {
    const result = await exportDocument(outlineDoc(), 'stl')
    for (const text of result.warnings) {
      expect(text.endsWith('.')).toBe(true)
      // Kein Entwicklerdeutsch: keine Bezeichner, keine englischen Reste
      expect(text).not.toMatch(/undefined|null|ExportOptions|warning/i)
    }
    expect(joined(result.warnings)).toMatch(/Fläche/)
  })
})

/* ------------------------------------------------------------------ */
/* Entartete Geometrie                                                 */
/* ------------------------------------------------------------------ */

describe('Entartete Geometrie', () => {
  it('nennt in jedem Format die Anzahl der nicht zerlegbaren Flaechen', () => {
    const doc = nanFaceDoc()
    for (const warnings of [
      exportStlBinary(doc).warnings,
      exportObj(doc).warnings,
      exportGltf(doc).warnings,
      exportDae(doc).warnings,
      exportSvg(doc).warnings,
    ]) {
      expect(joined(warnings)).toMatch(/1 Fläche liess sich nicht in Dreiecke zerlegen/)
    }
  })

  it('meldet Kanten mit ungueltigen Koordinaten getrennt', () => {
    expect(joined(exportStlBinary(nanFaceDoc()).warnings)).toMatch(/2 Kanten haben ungültige Koordinaten/)
  })

  it('laesst kein NaN und keine erfundene Null in die Datei', async () => {
    const doc = nanFaceDoc()
    // STL binaer: nur der 84-Byte-Kopf, kein Dreieck mit NaN-Gleitkommazahlen
    expect((await exportStlBinary(doc).blob.arrayBuffer()).byteLength).toBe(84)
    // OBJ: `num()` haette aus NaN eine 0 gemacht - eine Ecke, die es nie gab
    const obj = await exportObj(doc).blob.text()
    expect(obj).not.toMatch(/NaN/)
    expect(obj).not.toMatch(/^v /m)
  })
})

/* ------------------------------------------------------------------ */
/* OSK                                                                 */
/* ------------------------------------------------------------------ */

describe('OSK-Export', () => {
  it('warnt, dass eine Auswahl nicht ausgewertet wird', () => {
    const result = exportOsk(cubeDoc(2), { selectionOnly: true, selectedEntityIds: [] })
    expect(joined(result.warnings)).toMatch(/Nur Auswahl/)
    expect(joined(result.warnings)).toMatch(/vollständige Dokument/)
  })

  it('bleibt ohne Auswahl warnungsfrei - das Format ist verlustfrei', () => {
    expect(exportOsk(texturedCubeDoc()).warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* STL                                                                 */
/* ------------------------------------------------------------------ */

describe('STL-Export', () => {
  it('sagt es, wenn die Datei leer bleibt', () => {
    const text = joined(exportStlBinary(outlineDoc()).warnings)
    expect(text).toMatch(/bleibt leer/)
    expect(text).toMatch(/Schliesse den Grundriss zu einer Fläche/)
  })

  it('nennt die Kanten ohne Flaeche mit Anzahl', () => {
    const text = joined(exportStlAscii(cubeWithLooseEdge()).warnings)
    expect(text).toMatch(/1 Kante ohne Fläche/)
    expect(text).toMatch(/STL speichert nur Dreiecke/)
  })

  it('meldet den Verlust von Materialien und Farben', () => {
    expect(joined(exportStlBinary(texturedCubeDoc()).warnings)).toMatch(/Materialien und Farben gehen verloren/)
  })

  it('meldet uebersprungene Instanzen', () => {
    expect(joined(exportStlBinary(cyclicDoc()).warnings)).toMatch(/übersprungen/)
  })

  it('warnt bei einem geschlossenen Koerper ohne Material gar nicht', () => {
    expect(exportStlBinary(cubeDoc(2)).warnings).toEqual([])
    expect(exportStlAscii(cubeDoc(2)).warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* OBJ                                                                 */
/* ------------------------------------------------------------------ */

describe('OBJ-Export', () => {
  it('sagt es, wenn weder Flaeche noch Kante in die Datei kommt', () => {
    expect(joined(exportObj(emptyDoc()).warnings)).toMatch(/bleibt leer/)
  })

  it('weist auf die abgeschaltete Kantenausgabe hin', () => {
    const text = joined(exportObj(cubeWithLooseEdge()).warnings)
    expect(text).toMatch(/1 Kante ohne Fläche/)
    expect(text).toMatch(/Kanten mitexportieren/)
  })

  it('meldet Texturen, die referenziert, aber nicht mitgeschrieben werden', () => {
    const text = joined(exportObj(texturedCubeDoc()).warnings)
    expect(text).toMatch(/in der MTL-Datei referenziert, aber nicht/)
    expect(text).toMatch(/glTF\/GLB/)
  })

  it('unterscheidet abgeschaltetes Einbetten vom fehlenden Container', () => {
    const text = joined(exportObj(texturedCubeDoc(), { embedTextures: false }).warnings)
    expect(text).toMatch(/Einbetten/)
    expect(text).not.toMatch(/MTL-Datei referenziert/)
  })

  it('meldet verlorene Rueckseitenmaterialien', () => {
    expect(joined(exportObj(backMaterialDoc()).warnings)).toMatch(/Rückseitenmaterial/)
  })

  it('bleibt beim Wuerfel mit Kantenausgabe warnungsfrei', () => {
    expect(exportObj(cubeDoc(2), { includeEdges: true }).warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* COLLADA                                                             */
/* ------------------------------------------------------------------ */

describe('DAE-Export', () => {
  it('sagt es, wenn keine Dreiecke entstehen', () => {
    const text = joined(exportDae(outlineDoc()).warnings)
    expect(text).toMatch(/bleibt leer/)
    expect(text).toMatch(/COLLADA/)
  })

  it('meldet, dass Texturen nicht mitgeschrieben werden', () => {
    const text = joined(exportDae(texturedCubeDoc()).warnings)
    expect(text).toMatch(/1 Textur geht verloren/)
    expect(text).toMatch(/glTF oder GLB/)
  })

  it('nennt Kanten ohne Flaeche', () => {
    expect(joined(exportDae(cubeWithLooseEdge()).warnings)).toMatch(/1 Kante ohne Fläche/)
  })

  it('bleibt beim Wuerfel ohne Material warnungsfrei', () => {
    expect(exportDae(cubeDoc(2)).warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* glTF                                                                */
/* ------------------------------------------------------------------ */

describe('glTF-Export', () => {
  it('sagt es, wenn kein Mesh entsteht', () => {
    expect(joined(exportGltf(outlineDoc()).warnings)).toMatch(/bleibt leer/)
    expect(joined(exportGlb(outlineDoc()).warnings)).toMatch(/bleibt leer/)
  })

  it('nennt Kanten ohne Flaeche', () => {
    expect(joined(exportGltf(cubeWithLooseEdge()).warnings)).toMatch(/1 Kante ohne Fläche/)
  })

  it('meldet eine Textur, die sich nicht lesen laesst', () => {
    const text = joined(exportGltf(texturedCubeDoc('das ist keine Data-URL')).warnings)
    expect(text).toMatch(/Die Textur „Ziegel“ liess sich nicht lesen/)
  })

  it('meldet abgeschaltetes Einbetten', () => {
    const text = joined(exportGlb(texturedCubeDoc(), { embedTextures: false }).warnings)
    expect(text).toMatch(/Einbetten/)
  })

  it('bleibt mit lesbarer Textur warnungsfrei', () => {
    expect(exportGltf(texturedCubeDoc()).warnings).toEqual([])
    expect(exportGlb(texturedCubeDoc()).warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* SVG                                                                 */
/* ------------------------------------------------------------------ */

describe('SVG-Export', () => {
  it('sagt, dass die Zeichnung eine Projektion ist, sobald Tiefe da ist', () => {
    const text = joined(exportSvg(cubeDoc(2), { view: 'iso' }).warnings)
    expect(text).toMatch(/Projektion \(Isometrie\)/)
    expect(text).toMatch(/verdeckte Kanten/)
  })

  it('sagt es, wenn nichts zu zeichnen ist', () => {
    expect(joined(exportSvg(emptyDoc()).warnings)).toMatch(/bleibt leer/)
  })

  it('meldet Texturen, die zur reinen Farbe werden', () => {
    expect(joined(exportSvg(texturedCubeDoc(), { view: 'top' }).warnings)).toMatch(/einfarbige Fläche/)
  })

  it('schweigt bei einem flachen Grundriss in der Draufsicht', () => {
    expect(exportSvg(flatFaceDoc(), { view: 'top' }).warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

describe('PNG-Export', () => {
  it('meldet ein Bild, das gar kein PNG ist', () => {
    const image = new Blob([pngBytes().slice().buffer], { type: 'image/jpeg' })
    const text = joined(exportPng(emptyDoc('Ansicht'), { image }).warnings)
    expect(text).toMatch(/image\/jpeg/)
    expect(text).toMatch(/kein echtes PNG/)
  })

  it('meldet, dass die Auswahl das Bild nicht einschraenkt', () => {
    const image = new Blob([pngBytes().slice().buffer], { type: 'image/png' })
    const result = exportPng(emptyDoc('Ansicht'), { image, selectionOnly: true })
    expect(joined(result.warnings)).toMatch(/Nur Auswahl/)
  })

  it('bleibt bei einem echten PNG warnungsfrei', () => {
    const image = new Blob([pngBytes().slice().buffer], { type: 'image/png' })
    expect(exportPng(emptyDoc('Ansicht'), { image }).warnings).toEqual([])
    expect(pngFromDataUrl(bytesToDataUrl('image/png', pngBytes()), 'Ansicht').warnings).toEqual([])
  })

  it('wirft weiter, wenn gar kein Bild da ist - eine leere Datei waere schlimmer', () => {
    expect(() => exportPng(emptyDoc('Ansicht'))).toThrow(/Viewport/)
  })
})
