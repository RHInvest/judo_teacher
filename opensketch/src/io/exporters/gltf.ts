/**
 * glTF-2.0-Export, als .gltf (JSON mit Data-URI-Puffer) und als .glb.
 *
 * Wichtige Entscheidungen:
 *  - **Y-oben**: glTF ist Y-oben, das Modell Z-oben. Die Drehung steckt in
 *    EINER Wurzel-Node, nicht in jedem Vertex - so bleiben die Zahlen im
 *    Puffer identisch mit dem Modell und Rundungsfehler entstehen nicht.
 *  - **Ein Mesh je Definition**, aufgeteilt in ein Primitive je Material.
 *    Komponenteninstanzen werden zu Nodes, die dasselbe Mesh referenzieren -
 *    genau die Ersparnis, fuer die Komponenten gedacht sind.
 *  - Materialien als `pbrMetallicRoughness` inklusive `alphaMode`.
 */

import type { Id, Material, Mat4Like, SketchDocument } from '@/shared/types'
import type { ExportOptions, ExportResult } from '../api-types'
import { buildDefinitionMesh, buildSceneTree, definitionList, type MeshPrimitive, type SceneNode } from '../common/scene'
import { binaryBlob, bytesToDataUrl, dataUrlToBytes, encodeBase64, hexToLinearRgb, sanitizeFilename, textBlob, utf8Bytes } from '../common/util'
import {
  WarningList,
  backMaterialWarning,
  degenerateFacesWarning,
  emptyExportWarning,
  facelessEdgesWarning,
  skippedInstancesWarning,
  textureUnreadableWarning,
  texturesDisabledWarning,
  treeLoss,
  usedTextures,
} from '../common/warnings'
import { M, V } from '@/core/math'

/* ------------------------------------------------------------------ */
/* glTF-Datenmodell (nur die benutzten Felder)                         */
/* ------------------------------------------------------------------ */

interface GltfAccessor {
  bufferView: number
  byteOffset: number
  componentType: number
  count: number
  type: 'SCALAR' | 'VEC2' | 'VEC3'
  min?: number[]
  max?: number[]
}

interface GltfBufferView {
  buffer: number
  byteOffset: number
  byteLength: number
  target?: number
}

interface GltfPrimitive {
  attributes: { POSITION: number; NORMAL?: number; TEXCOORD_0?: number }
  indices: number
  material?: number
  mode: number
}

interface GltfNode {
  name?: string
  mesh?: number
  children?: number[]
  matrix?: number[]
}

interface GltfMaterial {
  name: string
  pbrMetallicRoughness: {
    baseColorFactor: [number, number, number, number]
    metallicFactor: number
    roughnessFactor: number
    baseColorTexture?: { index: number }
  }
  alphaMode: 'OPAQUE' | 'BLEND'
  doubleSided: boolean
}

interface GltfImage {
  name?: string
  uri?: string
  bufferView?: number
  mimeType?: string
}

interface GltfDocument {
  asset: { version: string; generator: string }
  scene: number
  scenes: { name: string; nodes: number[] }[]
  nodes: GltfNode[]
  meshes: { name: string; primitives: GltfPrimitive[] }[]
  accessors: GltfAccessor[]
  bufferViews: GltfBufferView[]
  buffers: { byteLength: number; uri?: string }[]
  materials?: GltfMaterial[]
  images?: GltfImage[]
  samplers?: { wrapS: number; wrapT: number }[]
  textures?: { source: number; sampler?: number }[]
}

const FLOAT = 5126
const UNSIGNED_INT = 5125
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const TRIANGLES = 4
const REPEAT = 10497

/* ------------------------------------------------------------------ */
/* Binaerpuffer                                                        */
/* ------------------------------------------------------------------ */

class BinWriter {
  private readonly parts: Uint8Array[] = []
  private length = 0

  get byteLength(): number {
    return this.length
  }

  /** Richtet auf 4 Byte aus - glTF verlangt das fuer jede BufferView. */
  align(): void {
    const rest = this.length % 4
    if (rest === 0) return
    this.push(new Uint8Array(4 - rest))
  }

  private push(bytes: Uint8Array): void {
    this.parts.push(bytes)
    this.length += bytes.length
  }

  writeFloats(values: readonly number[]): { offset: number; byteLength: number } {
    this.align()
    const offset = this.length
    const array = new Float32Array(values.length)
    for (let i = 0; i < values.length; i++) array[i] = values[i]
    this.push(new Uint8Array(array.buffer))
    return { offset, byteLength: array.byteLength }
  }

  writeUints(values: readonly number[]): { offset: number; byteLength: number } {
    this.align()
    const offset = this.length
    const array = new Uint32Array(values.length)
    for (let i = 0; i < values.length; i++) array[i] = values[i]
    this.push(new Uint8Array(array.buffer))
    return { offset, byteLength: array.byteLength }
  }

  writeBytes(bytes: Uint8Array): { offset: number; byteLength: number } {
    this.align()
    const offset = this.length
    this.push(bytes)
    return { offset, byteLength: bytes.length }
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const part of this.parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }
}

/* ------------------------------------------------------------------ */
/* Aufbau                                                              */
/* ------------------------------------------------------------------ */

interface BuildResult {
  json: GltfDocument
  bin: Uint8Array
  warnings: string[]
}

/** Z-oben -> Y-oben: Drehung um -90 Grad um die X-Achse. */
export function zUpToYUpMatrix(): Mat4Like {
  return M.rotation(V.AXIS_X, -Math.PI / 2)
}

function buildGltf(doc: SketchDocument, opts: ExportOptions, embedBufferInBin: boolean): BuildResult {
  const scale = opts.unitScale ?? 1
  const bin = new BinWriter()
  const json: GltfDocument = {
    asset: { version: '2.0', generator: 'OpenSketch Studio' },
    scene: 0,
    scenes: [{ name: doc.meta.name || 'Modell', nodes: [0] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  }

  const warnings = new WarningList()
  let skipped = 0
  const root = buildSceneTree(doc, {
    onlyEntityIds: opts.selectionOnly ? opts.selectedEntityIds : undefined,
    onSkip: () => skipped++,
  })
  const definitions = definitionList(doc, root)

  /* ---- Materialien und Texturen ---- */
  const materialIndex = new Map<Id, number>()
  const textureIndex = new Map<Id, number>()
  const usedMaterialIds = collectMaterialIds(doc, definitions.map((d) => d.id))
  const materials: Material[] = []

  for (const id of usedMaterialIds) {
    const material = doc.materials[id]
    if (!material) continue
    materials.push(material)
    materialIndex.set(id, addMaterial(json, doc, material, textureIndex, bin, embedBufferInBin, opts, warnings))
  }

  /* ---- Meshes je Definition ---- */
  const meshIndex = new Map<Id, number>()
  let degenerateFaces = 0
  for (const definition of definitions) {
    const primitives = buildDefinitionMesh(doc, definition.id, {
      unitScale: scale,
      onDegenerateFace: () => degenerateFaces++,
    })
    if (primitives.length === 0) continue
    const gltfPrimitives: GltfPrimitive[] = []
    for (const prim of primitives) {
      const encoded = addPrimitive(json, bin, prim, materialIndex)
      if (encoded) gltfPrimitives.push(encoded)
    }
    if (gltfPrimitives.length === 0) continue
    meshIndex.set(definition.id, json.meshes.length)
    json.meshes.push({ name: definition.name || 'Geometrie', primitives: gltfPrimitives })
  }

  /* ---- Knotenbaum ---- */
  // Node 0 traegt allein die Achsendrehung, darunter haengt das Modell.
  json.nodes.push({ name: 'Z_nach_Y', matrix: [...zUpToYUpMatrix()], children: [] })
  const modelNode = addNode(json, root, meshIndex, scale, true)
  const rootNode = json.nodes[0]
  rootNode.children = [modelNode]

  /* ---- Puffer ---- */
  const binBytes = bin.toUint8Array()
  json.buffers.push(
    embedBufferInBin
      ? { byteLength: binBytes.length }
      : { byteLength: binBytes.length, uri: `data:application/octet-stream;base64,${encodeBase64(binBytes)}` },
  )
  if (binBytes.length === 0 && !embedBufferInBin) json.buffers = []

  /* ---- Warnungen ---- */
  const loss = treeLoss(doc, root)
  if (json.meshes.length === 0) {
    warnings.add(
      emptyExportWarning(
        'glTF',
        opts.selectionOnly === true,
        'glTF speichert hier nur Dreiecke — schliesse den Grundriss zu einer Fläche, bevor du als glTF exportierst.',
      ),
    )
  } else {
    warnings.add(facelessEdgesWarning(loss.facelessEdges, 'glTF'))
  }
  warnings.add(degenerateFacesWarning(degenerateFaces))
  if (opts.embedTextures === false) {
    warnings.add(texturesDisabledWarning(usedTextures(doc, materials).length))
  }
  warnings.add(backMaterialWarning(loss.backMaterialFaces, 'glTF'))
  warnings.add(skippedInstancesWarning(skipped))

  return { json, bin: binBytes, warnings: warnings.list() }
}

function collectMaterialIds(doc: SketchDocument, definitionIds: Id[]): Id[] {
  const ids = new Set<Id>()
  for (const definitionId of definitionIds) {
    const definition = doc.definitions[definitionId]
    if (!definition) continue
    for (const face of Object.values(definition.geometry.faces)) {
      if (face.frontMaterialId) ids.add(face.frontMaterialId)
    }
  }
  return [...ids]
}

function addMaterial(
  json: GltfDocument,
  doc: SketchDocument,
  material: Material,
  textureIndex: Map<Id, number>,
  bin: BinWriter,
  embedInBin: boolean,
  opts: ExportOptions,
  warnings: WarningList,
): number {
  const [r, g, b] = hexToLinearRgb(material.color)
  const gltfMaterial: GltfMaterial = {
    name: material.name || 'Material',
    pbrMetallicRoughness: {
      baseColorFactor: [r, g, b, material.opacity],
      metallicFactor: clamp01(material.metalness),
      roughnessFactor: clamp01(material.roughness),
    },
    alphaMode: material.opacity < 1 ? 'BLEND' : 'OPAQUE',
    doubleSided: true,
  }

  const texture = material.textureId ? doc.textures[material.textureId] : undefined
  if (texture && opts.embedTextures !== false) {
    let index = textureIndex.get(texture.id)
    if (index === undefined) {
      index = addTexture(json, texture.id, texture.name, texture.dataUrl, bin, embedInBin)
      textureIndex.set(texture.id, index)
    }
    if (index >= 0) gltfMaterial.pbrMetallicRoughness.baseColorTexture = { index }
    // `addTexture` liefert -1, wenn die Data-URL unlesbar ist. Bisher fiel
    // der Export dann stillschweigend auf die reine Farbe zurueck.
    else warnings.add(textureUnreadableWarning(texture.name))
  }

  const at = json.materials?.length ?? 0
  if (!json.materials) json.materials = []
  json.materials.push(gltfMaterial)
  return at
}

function addTexture(
  json: GltfDocument,
  _id: Id,
  name: string,
  dataUrl: string,
  bin: BinWriter,
  embedInBin: boolean,
): number {
  const decoded = dataUrlToBytes(dataUrl)
  if (!decoded) return -1
  if (!json.images) json.images = []
  if (!json.textures) json.textures = []
  if (!json.samplers) json.samplers = [{ wrapS: REPEAT, wrapT: REPEAT }]

  const image: GltfImage = { name: name || 'Textur', mimeType: decoded.mime || 'image/png' }
  if (embedInBin) {
    // GLB: das Bild wandert roh in den Binaerchunk
    const { offset, byteLength } = bin.writeBytes(decoded.bytes)
    image.bufferView = json.bufferViews.length
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength })
  } else {
    image.uri = bytesToDataUrl(decoded.mime || 'image/png', decoded.bytes)
  }
  const imageIndex = json.images.length
  json.images.push(image)
  const textureIdx = json.textures.length
  json.textures.push({ source: imageIndex, sampler: 0 })
  return textureIdx
}

function addPrimitive(
  json: GltfDocument,
  bin: BinWriter,
  prim: MeshPrimitive,
  materialIndex: Map<Id, number>,
): GltfPrimitive | null {
  const count = prim.positions.length / 3
  if (count === 0 || prim.indices.length === 0) return null

  const position = addAccessor(json, bin, prim.positions, 'VEC3', true)
  const normal = prim.normals.length === prim.positions.length ? addAccessor(json, bin, prim.normals, 'VEC3', false) : undefined
  const uv = prim.uvs.length === count * 2 ? addAccessor(json, bin, prim.uvs, 'VEC2', false) : undefined
  const indices = addIndexAccessor(json, bin, prim.indices)

  const out: GltfPrimitive = {
    attributes: { POSITION: position },
    indices,
    mode: TRIANGLES,
  }
  if (normal !== undefined) out.attributes.NORMAL = normal
  if (uv !== undefined) out.attributes.TEXCOORD_0 = uv
  const material = prim.materialId !== null ? materialIndex.get(prim.materialId) : undefined
  if (material !== undefined) out.material = material
  return out
}

function addAccessor(
  json: GltfDocument,
  bin: BinWriter,
  values: number[],
  type: 'VEC2' | 'VEC3',
  withBounds: boolean,
): number {
  const components = type === 'VEC3' ? 3 : 2
  const { offset, byteLength } = bin.writeFloats(values)
  const bufferView = json.bufferViews.length
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength, target: ARRAY_BUFFER })

  const accessor: GltfAccessor = {
    bufferView,
    byteOffset: 0,
    componentType: FLOAT,
    count: values.length / components,
    type,
  }
  if (withBounds) {
    const min = new Array<number>(components).fill(Infinity)
    const max = new Array<number>(components).fill(-Infinity)
    for (let i = 0; i < values.length; i += components) {
      for (let c = 0; c < components; c++) {
        const v = values[i + c]
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
      }
    }
    accessor.min = min.map((v) => (Number.isFinite(v) ? v : 0))
    accessor.max = max.map((v) => (Number.isFinite(v) ? v : 0))
  }
  const index = json.accessors.length
  json.accessors.push(accessor)
  return index
}

function addIndexAccessor(json: GltfDocument, bin: BinWriter, indices: number[]): number {
  const { offset, byteLength } = bin.writeUints(indices)
  const bufferView = json.bufferViews.length
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength, target: ELEMENT_ARRAY_BUFFER })
  const index = json.accessors.length
  json.accessors.push({
    bufferView,
    byteOffset: 0,
    componentType: UNSIGNED_INT,
    count: indices.length,
    type: 'SCALAR',
  })
  return index
}

/** Fuegt einen Knoten samt Kindern ein und liefert seinen Index. */
function addNode(
  json: GltfDocument,
  node: SceneNode,
  meshIndex: Map<Id, number>,
  scale: number,
  isRoot: boolean,
): number {
  const index = json.nodes.length
  const entry: GltfNode = { name: node.name || 'Knoten' }
  json.nodes.push(entry)

  if (!isRoot && !M.isIdentity(node.transform)) {
    entry.matrix = scaleTranslation([...node.transform], scale)
  }
  const mesh = meshIndex.get(node.definitionId)
  if (mesh !== undefined) entry.mesh = mesh

  const children: number[] = []
  for (const child of node.children) children.push(addNode(json, child, meshIndex, scale, false))
  if (children.length > 0) entry.children = children
  return index
}

/**
 * Der Vertexpuffer ist bereits skaliert, die Translation der Instanzen aber
 * noch nicht - sie steckt in Spalte 4 der Matrix.
 */
function scaleTranslation(matrix: number[], scale: number): number[] {
  if (scale === 1) return matrix
  const out = [...matrix]
  out[12] *= scale
  out[13] *= scale
  out[14] *= scale
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/* ------------------------------------------------------------------ */
/* Ausgabe                                                             */
/* ------------------------------------------------------------------ */

export function exportGltf(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const { json, warnings } = buildGltf(doc, opts, false)
  return {
    blob: textBlob(JSON.stringify(json, null, 2), 'model/gltf+json'),
    filename: `${sanitizeFilename(opts.filename ?? doc.meta.name)}.gltf`,
    warnings,
  }
}

export function exportGlb(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const { json, bin, warnings } = buildGltf(doc, opts, true)
  return {
    blob: binaryBlob(packGlb(json, bin), 'model/gltf-binary'),
    filename: `${sanitizeFilename(opts.filename ?? doc.meta.name)}.glb`,
    warnings,
  }
}

/** Nur fuer Tests: das rohe glTF-JSON. */
export function buildGltfJson(doc: SketchDocument, opts: ExportOptions = {}): GltfDocument {
  return buildGltf(doc, opts, false).json
}

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

export function packGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const jsonBytes = padTo4(utf8Bytes(JSON.stringify(json)), 0x20)
  const binBytes = bin.length > 0 ? padTo4(bin, 0x00) : new Uint8Array(0)
  const total = 12 + 8 + jsonBytes.length + (binBytes.length > 0 ? 8 + binBytes.length : 0)

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.length, true)
  view.setUint32(16, CHUNK_JSON, true)
  out.set(jsonBytes, 20)
  if (binBytes.length > 0) {
    const offset = 20 + jsonBytes.length
    view.setUint32(offset, binBytes.length, true)
    view.setUint32(offset + 4, CHUNK_BIN, true)
    out.set(binBytes, offset + 8)
  }
  return out
}

function padTo4(bytes: Uint8Array, filler: number): Uint8Array {
  const rest = bytes.length % 4
  if (rest === 0) return bytes
  const out = new Uint8Array(bytes.length + (4 - rest))
  out.set(bytes)
  out.fill(filler, bytes.length)
  return out
}
