/**
 * glTF 2.0 und GLB.
 *
 * Zwei Dinge muessen stimmen, sonst laedt die Datei nirgends:
 *  1. die Pflichtfelder - asset.version, scenes, nodes, meshes, accessors mit
 *     passendem componentType/count/type, bufferViews mit byteOffset und
 *     byteLength innerhalb des Puffers,
 *  2. die Achsenkonvention. Das Modell ist Z-oben, glTF ist Y-oben. Die
 *     Drehung gehoert in die WURZEL-NODE; werden stattdessen alle Vertices
 *     einzeln gedreht, sieht das Ergebnis zwar gleich aus, aber die Zahlen im
 *     Puffer stimmen nicht mehr mit dem Modell ueberein.
 */

import { describe, expect, it } from 'vitest'
import { buildGltfJson, exportGlb, exportGltf, packGlb, zUpToYUpMatrix } from '../exporters/gltf'
import { importGltf, looksLikeGlb, unpackGlb, yUpToZUpMatrix } from '../importers/gltf'
import { addBox, addGroup, blobBytes, blobText, cubeDoc, cubeWithMaterial, emptyDoc, rootGeometry } from './helpers'
import { dataUrlToBytes } from '../common/util'
import { M, V } from '@/core/math'

const SIZE = 2

const FLOAT = 5126
const UNSIGNED_INT = 5125
const TRIANGLES = 4

function json(doc = cubeDoc(SIZE)) {
  return buildGltfJson(doc)
}

/* ------------------------------------------------------------------ */
/* Pflichtfelder                                                       */
/* ------------------------------------------------------------------ */

describe('glTF-Pflichtfelder', () => {
  it('meldet asset.version 2.0 und einen Generator', () => {
    const g = json()
    expect(g.asset.version).toBe('2.0')
    expect(g.asset.generator).toContain('OpenSketch')
  })

  it('hat genau eine Szene, auf die scene zeigt', () => {
    const g = json()
    expect(g.scene).toBe(0)
    expect(g.scenes.length).toBe(1)
    expect(g.scenes[0].nodes).toEqual([0])
    expect(g.scenes[0].name).toBe('Wuerfel')
  })

  it('verweist nur auf vorhandene Nodes, Meshes und Materialien', () => {
    const g = buildGltfJson(cubeWithMaterial(SIZE).doc)
    for (const node of g.nodes) {
      for (const child of node.children ?? []) {
        expect(child).toBeGreaterThanOrEqual(0)
        expect(child).toBeLessThan(g.nodes.length)
      }
      if (node.mesh !== undefined) expect(node.mesh).toBeLessThan(g.meshes.length)
    }
    for (const mesh of g.meshes) {
      expect(mesh.primitives.length).toBeGreaterThan(0)
      for (const prim of mesh.primitives) {
        expect(prim.mode).toBe(TRIANGLES)
        if (prim.material !== undefined) {
          expect(prim.material).toBeLessThan(g.materials?.length ?? 0)
        }
      }
    }
  })

  it('beschreibt jeden Accessor vollstaendig und passend zum bufferView', () => {
    const g = buildGltfJson(cubeWithMaterial(SIZE).doc)
    const bufferLength = g.buffers[0].byteLength
    expect(g.accessors.length).toBeGreaterThan(0)

    const componentsOf: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 }
    const sizeOf: Record<number, number> = { [FLOAT]: 4, [UNSIGNED_INT]: 4 }

    for (const accessor of g.accessors) {
      expect(['SCALAR', 'VEC2', 'VEC3']).toContain(accessor.type)
      expect([FLOAT, UNSIGNED_INT]).toContain(accessor.componentType)
      expect(accessor.count).toBeGreaterThan(0)
      expect(accessor.byteOffset).toBe(0)

      const view = g.bufferViews[accessor.bufferView]
      expect(view, 'Accessor zeigt auf keine bufferView').toBeTruthy()
      expect(view.buffer).toBe(0)
      expect(view.byteOffset % 4, 'bufferView nicht auf 4 Byte ausgerichtet').toBe(0)
      expect(view.byteOffset).toBeGreaterThanOrEqual(0)
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(bufferLength)
      // count * Komponenten * Komponentengroesse muss in die View passen
      const needed = accessor.count * componentsOf[accessor.type] * sizeOf[accessor.componentType]
      expect(needed).toBe(view.byteLength)
    }
  })

  it('gibt Indizes als UNSIGNED_INT und SCALAR aus', () => {
    const g = json()
    for (const prim of g.meshes[0].primitives) {
      const indices = g.accessors[prim.indices]
      expect(indices.componentType).toBe(UNSIGNED_INT)
      expect(indices.type).toBe('SCALAR')
      // Wuerfel: 6 Flaechen zu je 2 Dreiecken
      expect(indices.count).toBe(36)
      const position = g.accessors[prim.attributes.POSITION]
      expect(position.type).toBe('VEC3')
      expect(position.componentType).toBe(FLOAT)
      expect(position.count).toBe(24) // je Flaeche eigene Ecken wegen Normalen
    }
  })

  it('gibt POSITION min und max mit an', () => {
    const g = json()
    const position = g.accessors[g.meshes[0].primitives[0].attributes.POSITION]
    expect(position.min).toEqual([0, 0, 0])
    expect(position.max).toEqual([SIZE, SIZE, SIZE])
  })

  it('haengt NORMAL und TEXCOORD_0 an, wenn sie vollstaendig sind', () => {
    const g = buildGltfJson(cubeWithMaterial(SIZE).doc)
    const prim = g.meshes[0].primitives[0]
    expect(prim.attributes.NORMAL).toBeDefined()
    expect(prim.attributes.TEXCOORD_0).toBeDefined()
    expect(g.accessors[prim.attributes.NORMAL!].type).toBe('VEC3')
    expect(g.accessors[prim.attributes.TEXCOORD_0!].type).toBe('VEC2')
    expect(g.accessors[prim.attributes.NORMAL!].count).toBe(
      g.accessors[prim.attributes.POSITION].count,
    )
  })

  it('bettet den Puffer als Data-URI ein und die Laenge stimmt', () => {
    const g = json()
    expect(g.buffers.length).toBe(1)
    expect(g.buffers[0].uri?.startsWith('data:application/octet-stream;base64,')).toBe(true)
    const decoded = dataUrlToBytes(g.buffers[0].uri!)
    expect(decoded?.bytes.length).toBe(g.buffers[0].byteLength)
  })

  it('schreibt Materialien als pbrMetallicRoughness', () => {
    const { doc, material } = cubeWithMaterial(SIZE)
    material.opacity = 0.5
    material.metalness = 0.25
    material.roughness = 0.75
    const g = buildGltfJson(doc)
    expect(g.materials?.length).toBe(1)
    const m = g.materials![0]
    expect(m.name).toBe('Eiche hell')
    expect(m.alphaMode).toBe('BLEND')
    expect(m.doubleSided).toBe(true)
    expect(m.pbrMetallicRoughness.metallicFactor).toBeCloseTo(0.25, 6)
    expect(m.pbrMetallicRoughness.roughnessFactor).toBeCloseTo(0.75, 6)
    expect(m.pbrMetallicRoughness.baseColorFactor[3]).toBeCloseTo(0.5, 6)
    for (const c of m.pbrMetallicRoughness.baseColorFactor.slice(0, 3)) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
  })

  it('setzt alphaMode OPAQUE bei voller Deckkraft', () => {
    expect(buildGltfJson(cubeWithMaterial(SIZE).doc).materials![0].alphaMode).toBe('OPAQUE')
  })
})

/* ------------------------------------------------------------------ */
/* Achsen                                                              */
/* ------------------------------------------------------------------ */

describe('glTF-Achsenkonvention', () => {
  it('dreht Z-oben nach Y-oben, nicht umgekehrt', () => {
    const m = zUpToYUpMatrix()
    // blaue Achse (oben im Modell) -> +Y in glTF
    const up = M.transformPoint(m, { x: 0, y: 0, z: 1 })
    expect(up.x).toBeCloseTo(0, 12)
    expect(up.y).toBeCloseTo(1, 12)
    expect(up.z).toBeCloseTo(0, 12)
    // gruene Achse (Norden im Modell) -> -Z in glTF
    const north = M.transformPoint(m, { x: 0, y: 1, z: 0 })
    expect(north.z).toBeCloseTo(-1, 12)
    // rote Achse bleibt
    const east = M.transformPoint(m, { x: 1, y: 0, z: 0 })
    expect(east.x).toBeCloseTo(1, 12)
  })

  it('ist die Umkehrung der Importdrehung', () => {
    const back = M.multiply(yUpToZUpMatrix(), zUpToYUpMatrix())
    expect(M.isIdentity(back)).toBe(true)
  })

  it('steckt die Drehung in Node 0 und sonst nirgends', () => {
    const g = json()
    expect(g.nodes[0].name).toBe('Z_nach_Y')
    expect(g.nodes[0].matrix).toEqual([...zUpToYUpMatrix()])
    expect(g.nodes[0].mesh).toBeUndefined()
    expect(g.nodes[0].children).toEqual([1])
    // kein weiterer Knoten traegt eine Drehung
    for (const node of g.nodes.slice(1)) {
      if (!node.matrix) continue
      expect(rotationPartIsIdentity(node.matrix), `${node.name} dreht mit`).toBe(true)
    }
  })

  it('laesst die Vertexdaten unveraendert Z-oben im Puffer stehen', () => {
    // Punkt mit bekannten, unterscheidbaren Koordinaten
    const doc = emptyDoc('Marke')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 3, z: 7 })
    const g = buildGltfJson(doc)
    const position = g.accessors[g.meshes[0].primitives[0].attributes.POSITION]
    // Waere jeder Vertex einzeln gedreht, stuende hier y = 7 und z = -3.
    expect(position.min).toEqual([0, 0, 0])
    expect(position.max).toEqual([1, 3, 7])

    const values = readVec3(g, position)
    expect(values.some((p) => p.y === 3 && p.z === 7)).toBe(true)
    expect(values.some((p) => p.y === 7)).toBe(false)
  })

  it('setzt den Wuerfel ueber die Wurzeldrehung an die richtige Stelle', () => {
    const doc = emptyDoc('Marke')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 3, z: 7 })
    const g = buildGltfJson(doc)
    const position = g.accessors[g.meshes[0].primitives[0].attributes.POSITION]
    const rotated = readVec3(g, position).map((p) => M.transformPoint(zUpToYUpMatrix(), p))
    const maxY = Math.max(...rotated.map((p) => p.y))
    const minZ = Math.min(...rotated.map((p) => p.z))
    expect(maxY).toBeCloseTo(7, 5) // Hoehe wird zur glTF-Hoehe
    expect(minZ).toBeCloseTo(-3, 5) // Tiefe wird zur negativen glTF-Tiefe
  })
})

/* ------------------------------------------------------------------ */
/* Hierarchie                                                          */
/* ------------------------------------------------------------------ */

describe('glTF-Hierarchie', () => {
  it('bildet Gruppen als Kindknoten mit eigener Matrix ab', () => {
    const doc = emptyDoc('Haus')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    addGroup(doc, 'Anbau', M.translation({ x: 5, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    const g = buildGltfJson(doc)
    const anbau = g.nodes.find((n) => n.name === 'Anbau')
    expect(anbau, 'Gruppenknoten fehlt').toBeTruthy()
    expect(anbau!.matrix?.[12]).toBe(5)
    expect(anbau!.mesh).toBeDefined()
    const modelNode = g.nodes[1]
    expect(modelNode.children).toContain(g.nodes.indexOf(anbau!))
  })

  it('teilt ein Mesh zwischen mehreren Instanzen derselben Definition', () => {
    const doc = emptyDoc('Reihe')
    const { definition } = addGroup(doc, 'Stuetze', M.identity(), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    // zweite Instanz derselben Definition
    const second = addGroup(doc, 'Stuetze 2', M.translation({ x: 4, y: 0, z: 0 }))
    second.entity.definitionId = definition.id
    const g = buildGltfJson(doc)
    expect(g.meshes.length).toBe(1)
    const users = g.nodes.filter((n) => n.mesh === 0)
    expect(users.length).toBe(2)
  })

  it('skaliert auch die Translation der Instanzen', () => {
    const doc = emptyDoc('Reihe')
    addGroup(doc, 'Weit', M.translation({ x: 2, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    const g = buildGltfJson(doc, { unitScale: 100 })
    const node = g.nodes.find((n) => n.name === 'Weit')!
    expect(node.matrix?.[12]).toBe(200)
    const position = g.accessors[g.meshes[0].primitives[0].attributes.POSITION]
    expect(position.max).toEqual([100, 100, 100])
  })
})

/* ------------------------------------------------------------------ */
/* GLB                                                                 */
/* ------------------------------------------------------------------ */

describe('GLB-Container', () => {
  it('schreibt Magic, Version und Gesamtlaenge', async () => {
    const bytes = await blobBytes(exportGlb(cubeDoc(SIZE)).blob)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint32(0, true)).toBe(0x46546c67)
    expect(view.getUint32(4, true)).toBe(2)
    expect(view.getUint32(8, true)).toBe(bytes.length)
    expect(bytes.length % 4).toBe(0)
    expect(looksLikeGlb(bytes)).toBe(true)
  })

  it('richtet beide Chunks auf 4 Byte aus', async () => {
    const bytes = await blobBytes(exportGlb(cubeDoc(SIZE)).blob)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const jsonLength = view.getUint32(12, true)
    expect(jsonLength % 4).toBe(0)
    expect(view.getUint32(16, true)).toBe(0x4e4f534a)
    const binLength = view.getUint32(20 + jsonLength, true)
    expect(binLength % 4).toBe(0)
    expect(view.getUint32(24 + jsonLength, true)).toBe(0x004e4942)
    expect(20 + jsonLength + 8 + binLength).toBe(bytes.length)
  })

  it('legt den Puffer in den BIN-Chunk statt in eine Data-URI', async () => {
    const bytes = await blobBytes(exportGlb(cubeDoc(SIZE)).blob)
    const { json: g, bin } = unpackGlb(bytes)
    expect(g.buffers?.[0].uri).toBeUndefined()
    expect(bin).toBeTruthy()
    expect(bin!.length).toBeGreaterThanOrEqual(g.buffers![0].byteLength!)
  })

  it('kommt ohne Binaerdaten aus', () => {
    const bytes = packGlb({ asset: { version: '2.0' } }, new Uint8Array(0))
    const { json: g, bin } = unpackGlb(bytes)
    expect(g.asset?.version).toBe('2.0')
    expect(bin).toBeNull()
  })

  it('erkennt eine .gltf-Datei nicht als GLB', async () => {
    const bytes = new TextEncoder().encode(await blobText(exportGltf(cubeDoc(SIZE)).blob))
    expect(looksLikeGlb(bytes)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Round-Trip                                                          */
/* ------------------------------------------------------------------ */

describe.each([
  ['glTF', async () => new TextEncoder().encode(await blobText(exportGltf(cubeDoc(SIZE)).blob))],
  ['GLB', async () => blobBytes(exportGlb(cubeDoc(SIZE)).blob)],
] as const)('glTF-Round-Trip (%s)', (_label, makeBytes) => {
  it('liest den Wuerfel als zwoelf Dreiecke zurueck', async () => {
    const result = importGltf(await makeBytes(), `wuerfel.${_label}`)
    const definition = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)
    expect(definition, 'kein Mesh importiert').toBeTruthy()
    expect(Object.keys(definition!.geometry.faces).length).toBe(12)
    expect(Object.keys(definition!.geometry.vertices).length).toBe(8)
  })

  it('behaelt die Abmessungen und bleibt Z-oben', async () => {
    const result = importGltf(await makeBytes(), `wuerfel.${_label}`)
    const geom = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)!.geometry
    for (const axis of ['x', 'y', 'z'] as const) {
      const values = Object.values(geom.vertices).map((v) => v.p[axis])
      expect(Math.min(...values)).toBeCloseTo(0, 5)
      expect(Math.max(...values)).toBeCloseTo(SIZE, 5)
    }
  })

  it('haengt die Achsenkorrektur als eigene Instanz unter die Wurzel', async () => {
    const result = importGltf(await makeBytes(), `wuerfel.${_label}`)
    const correction = result.entities.find(
      (e) => e.type === 'instance' && e.name === 'Achsenkorrektur',
    )
    expect(correction, 'Achsenkorrektur fehlt').toBeTruthy()
    if (correction?.type !== 'instance') throw new Error('Achsenkorrektur ist keine Instanz')
    expect(correction.transform).toEqual([...yUpToZUpMatrix()])
  })

  it('bringt den Wuerfel ueber die volle Kette wieder Z-oben heraus', async () => {
    const result = importGltf(await makeBytes(), `wuerfel.${_label}`)
    const geom = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)!.geometry
    // Puffer ist Z-oben, die Import-Wurzel dreht Y->Z, die Export-Wurzel hat
    // Z->Y gedreht: beides zusammen ist die Identitaet, der Punkt muss also
    // nach zweimaligem Drehen wieder auf sich selbst fallen.
    const point = Object.values(geom.vertices)[0].p
    const there = M.transformPoint(zUpToYUpMatrix(), point)
    const back = M.transformPoint(yUpToZUpMatrix(), there)
    expect(V.distance(back, point)).toBeLessThan(1e-9)
  })
})

describe('glTF-Import, Sonderfaelle', () => {
  it('warnt bei einer fremden Hauptversion', () => {
    const result = importGltf(
      new TextEncoder().encode(JSON.stringify({ asset: { version: '1.0' } })),
      'alt.gltf',
    )
    expect(result.warnings.some((w) => w.includes('1.0'))).toBe(true)
  })

  it('ueberspringt Primitive, die keine Dreiecke sind', () => {
    const doc = {
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ mode: 1, attributes: { POSITION: 0 } }] }],
    }
    const result = importGltf(new TextEncoder().encode(JSON.stringify(doc)), 'linien.gltf')
    expect(result.warnings.some((w) => w.includes('TRIANGLES'))).toBe(true)
  })

  it('warnt, wenn gar keine Geometrie drin ist', () => {
    const result = importGltf(
      new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } })),
      'leer.gltf',
    )
    expect(result.warnings.some((w) => w.includes('keine lesbare'))).toBe(true)
  })

  it('holt Materialfarbe und Deckkraft zurueck', async () => {
    const { doc, material } = cubeWithMaterial(SIZE)
    material.opacity = 0.4
    const bytes = new TextEncoder().encode(await blobText(exportGltf(doc).blob))
    const result = importGltf(bytes, 'material.gltf')
    expect(result.materials.length).toBe(1)
    expect(result.materials[0].name).toBe('Eiche hell')
    expect(result.materials[0].opacity).toBeCloseTo(0.4, 5)
    expect(result.materials[0].color.toLowerCase()).toBe('#c8a26a')
  })

  it('wirft bei kaputter GLB-Signatur eine verstaendliche Meldung', () => {
    const bytes = new Uint8Array(32)
    expect(() => unpackGlb(bytes)).toThrow(/Signatur/)
  })
})

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

function rotationPartIsIdentity(matrix: number[]): boolean {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const rotation = [
    matrix[0], matrix[1], matrix[2],
    matrix[4], matrix[5], matrix[6],
    matrix[8], matrix[9], matrix[10],
  ]
  return rotation.every((v, i) => Math.abs(v - identity[i]) < 1e-9)
}

/** Liest die VEC3-Werte eines Accessors aus dem eingebetteten Puffer. */
function readVec3(
  g: ReturnType<typeof buildGltfJson>,
  accessor: { bufferView: number; count: number },
): { x: number; y: number; z: number }[] {
  const bytes = dataUrlToBytes(g.buffers[0].uri!)!.bytes
  const view = g.bufferViews[accessor.bufferView]
  const floats = new Float32Array(accessor.count * 3)
  const source = new DataView(bytes.buffer, bytes.byteOffset + view.byteOffset, view.byteLength)
  for (let i = 0; i < floats.length; i++) floats[i] = source.getFloat32(i * 4, true)
  const out: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < floats.length; i += 3) {
    out.push({ x: floats[i], y: floats[i + 1], z: floats[i + 2] })
  }
  return out
}
