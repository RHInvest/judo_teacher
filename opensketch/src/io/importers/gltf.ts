/**
 * glTF-2.0- und GLB-Import.
 *
 * Umfang: Nodes (Matrix oder TRS), Meshes, Primitive mit `mode` 4
 * (TRIANGLES), Materialien inklusive Basisfarbentextur aus Data-URI,
 * Binaerpuffer (GLB-Chunk) oder mitgelieferter Beidatei.
 *
 * glTF ist Y-oben, das Modell Z-oben. Die Drehung sitzt in EINER Instanz
 * unter der Import-Wurzel - die Vertexdaten bleiben unangetastet.
 */

import type { Definition, Id, Mat4Like, Material, Vec3Like } from '@/shared/types'
import type { ImportOptions, ImportResult } from '../api-types'
import { GeomBuilder } from '../common/geom'
import { baseName, bytesToDataUrl, dataUrlToBytes, rgbToHex, utf8Text } from '../common/util'
import { ImportScene, makeMaterial } from './common'
import { M } from '@/core/math'
import { newId } from '@/shared/ids'

/* ------------------------------------------------------------------ */
/* Struktur der Datei (nur die gelesenen Felder)                       */
/* ------------------------------------------------------------------ */

interface GltfJson {
  asset?: { version?: string }
  scene?: number
  scenes?: { nodes?: number[]; name?: string }[]
  nodes?: {
    name?: string
    mesh?: number
    children?: number[]
    matrix?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
  }[]
  meshes?: { name?: string; primitives?: GltfPrimitiveJson[] }[]
  accessors?: {
    bufferView?: number
    byteOffset?: number
    componentType?: number
    count?: number
    type?: string
    normalized?: boolean
  }[]
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number }[]
  buffers?: { uri?: string; byteLength?: number }[]
  materials?: {
    name?: string
    pbrMetallicRoughness?: {
      baseColorFactor?: number[]
      metallicFactor?: number
      roughnessFactor?: number
      baseColorTexture?: { index?: number }
    }
    alphaMode?: string
  }[]
  textures?: { source?: number }[]
  images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[]
}

interface GltfPrimitiveJson {
  attributes?: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

/* ------------------------------------------------------------------ */
/* Einstieg                                                            */
/* ------------------------------------------------------------------ */

export function importGltf(bytes: Uint8Array, filename: string, opts: ImportOptions = {}): ImportResult {
  const unpacked = looksLikeGlb(bytes) ? unpackGlb(bytes) : { json: parseJson(bytes), bin: null }
  return buildFromGltf(unpacked.json, unpacked.bin, filename, opts)
}

export function looksLikeGlb(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(0, true) === GLB_MAGIC
}

export function unpackGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('GLB: falsche Signatur.')
  const total = Math.min(view.getUint32(8, true), bytes.length)
  let offset = 12
  let json: GltfJson | null = null
  let bin: Uint8Array | null = null
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = Math.min(start + length, bytes.length)
    if (type === CHUNK_JSON) json = JSON.parse(utf8Text(bytes.subarray(start, end))) as GltfJson
    else if (type === CHUNK_BIN) bin = bytes.subarray(start, end)
    offset = start + length + ((4 - (length % 4)) % 4)
  }
  if (!json) throw new Error('GLB: kein JSON-Chunk gefunden.')
  return { json, bin }
}

function parseJson(bytes: Uint8Array): GltfJson {
  return JSON.parse(utf8Text(bytes)) as GltfJson
}

/* ------------------------------------------------------------------ */
/* Aufbau                                                              */
/* ------------------------------------------------------------------ */

function buildFromGltf(
  json: GltfJson,
  binChunk: Uint8Array | null,
  filename: string,
  opts: ImportOptions,
): ImportResult {
  const scale = opts.unitScale ?? 1
  const scene = new ImportScene(opts.name ?? baseName(filename) ?? 'glTF-Import')

  if (json.asset?.version && !json.asset.version.startsWith('2')) {
    scene.warn(`glTF-Version ${json.asset.version} - dieser Importer liest 2.x.`)
  }

  /* ---- Puffer aufloesen ---- */
  const buffers: (Uint8Array | null)[] = (json.buffers ?? []).map((buffer, index) => {
    if (!buffer.uri) return index === 0 ? binChunk : null
    if (buffer.uri.startsWith('data:')) return dataUrlToBytes(buffer.uri)?.bytes ?? null
    const companion = findCompanion(opts, buffer.uri)
    if (!companion) scene.warn(`Binärpuffer "${buffer.uri}" wurde nicht mitgeladen.`)
    return companion
  })
  if (buffers.length === 0 && binChunk) buffers.push(binChunk)

  /* ---- Texturen und Materialien ---- */
  const textureIds = (json.textures ?? []).map((texture) => {
    const image = texture.source !== undefined ? json.images?.[texture.source] : undefined
    if (!image) return null
    let dataUrl: string | null = null
    if (image.uri && image.uri.startsWith('data:')) dataUrl = image.uri
    else if (image.uri) {
      const companion = findCompanion(opts, image.uri)
      if (companion) dataUrl = bytesToDataUrl(image.mimeType || guessMime(image.uri), companion)
      else scene.warn(`Textur "${image.uri}" wurde nicht mitgeladen.`)
    } else if (image.bufferView !== undefined) {
      const slice = readBufferView(json, buffers, image.bufferView)
      if (slice) dataUrl = bytesToDataUrl(image.mimeType || 'image/png', slice)
    }
    if (!dataUrl) return null
    const id = newId('x')
    scene.addTexture({ id, name: image.name || 'Textur', dataUrl, width: 0, height: 0 })
    return id
  })

  const materials: Material[] = (json.materials ?? []).map((raw, index) => {
    const pbr = raw.pbrMetallicRoughness ?? {}
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1]
    const material = makeMaterial(raw.name || `Material ${index + 1}`, linearToHex(factor), 'Import')
    material.opacity = clamp01(factor[3] ?? 1)
    material.metalness = clamp01(pbr.metallicFactor ?? 1)
    material.roughness = clamp01(pbr.roughnessFactor ?? 1)
    const textureIndex = pbr.baseColorTexture?.index
    if (textureIndex !== undefined) material.textureId = textureIds[textureIndex] ?? null
    scene.addMaterial(material)
    return material
  })

  /* ---- Meshes ---- */
  const meshDefinitions = new Map<number, Definition>()
  let skippedPrimitives = 0
  ;(json.meshes ?? []).forEach((mesh, meshIndex) => {
    const definition = scene.addDefinition(mesh.name || `Mesh ${meshIndex + 1}`, 'component')
    const g = new GeomBuilder(definition.geometry)
    let any = false
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4
      if (mode !== 4) {
        skippedPrimitives++
        continue
      }
      const positionAccessor = primitive.attributes?.POSITION
      if (positionAccessor === undefined) {
        skippedPrimitives++
        continue
      }
      const positions = readAccessorVec3(json, buffers, positionAccessor, scale)
      if (positions.length < 3) {
        skippedPrimitives++
        continue
      }
      const indices =
        primitive.indices !== undefined
          ? readAccessorScalar(json, buffers, primitive.indices)
          : positions.map((_, i) => i)
      const materialId: Id | null =
        primitive.material !== undefined ? materials[primitive.material]?.id ?? null : null
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const a = positions[indices[i]]
        const b = positions[indices[i + 1]]
        const c = positions[indices[i + 2]]
        if (a && b && c && g.face([a, b, c], [], { materialId })) any = true
      }
    }
    if (any) meshDefinitions.set(meshIndex, definition)
  })
  if (skippedPrimitives > 0) {
    scene.warn(`${skippedPrimitives} Primitive wurden übersprungen (nur TRIANGLES werden gelesen).`)
  }

  /* ---- Knotenbaum, mit Achsendrehung an der Wurzel ---- */
  const axisRoot = scene.addDefinition('glTF-Szene (Y-oben)', 'group')
  scene.addInstance(scene.root, axisRoot, yUpToZUpMatrix(), 'Achsenkorrektur')

  const nodes = json.nodes ?? []
  const sceneIndex = json.scene ?? 0
  const rootNodes = json.scenes?.[sceneIndex]?.nodes ?? nodes.map((_, i) => i)
  const visited = new Set<number>()

  const walk = (nodeIndex: number, parent: Definition, depth: number): void => {
    if (depth > 32 || visited.has(nodeIndex)) return
    const node = nodes[nodeIndex]
    if (!node) return
    visited.add(nodeIndex)

    const hasChildren = (node.children?.length ?? 0) > 0
    const mesh = node.mesh !== undefined ? meshDefinitions.get(node.mesh) : undefined
    const transform = nodeMatrix(node, scale)

    if (mesh && !hasChildren) {
      scene.addInstance(parent, mesh, transform, node.name || mesh.name, false)
      return
    }
    // Knoten mit Kindern bekommt eine eigene Gruppendefinition
    const group = scene.addDefinition(node.name || `Knoten ${nodeIndex}`, 'group')
    scene.addInstance(parent, group, transform, node.name || group.name)
    if (mesh) scene.addInstance(group, mesh, M.identity(), mesh.name, false)
    for (const child of node.children ?? []) walk(child, group, depth + 1)
  }

  for (const index of rootNodes) walk(index, axisRoot, 0)
  // Meshes ohne Knoten trotzdem einhaengen
  if (rootNodes.length === 0) {
    for (const definition of meshDefinitions.values()) {
      scene.addInstance(axisRoot, definition, M.identity(), definition.name, false)
    }
  }

  if (meshDefinitions.size === 0) scene.warn('Die Datei enthält keine lesbare Dreiecksgeometrie.')
  return scene.toResult()
}

/** Y-oben -> Z-oben: Drehung um +90 Grad um die X-Achse. */
export function yUpToZUpMatrix(): Mat4Like {
  return M.rotation({ x: 1, y: 0, z: 0 }, Math.PI / 2)
}

function nodeMatrix(
  node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] },
  scale: number,
): Mat4Like {
  if (node.matrix && node.matrix.length === 16) {
    const m = [...node.matrix]
    m[12] *= scale
    m[13] *= scale
    m[14] *= scale
    return m
  }
  const t = node.translation ?? [0, 0, 0]
  const r = node.rotation ?? [0, 0, 0, 1]
  const s = node.scale ?? [1, 1, 1]
  return M.multiply(
    M.translation({ x: t[0] * scale, y: t[1] * scale, z: t[2] * scale }),
    M.multiply(quaternionMatrix(r[0], r[1], r[2], r[3]), M.scaling({ x: s[0], y: s[1], z: s[2] })),
  )
}

/** Quaternion (x, y, z, w) als spaltenweise 4x4-Matrix. */
export function quaternionMatrix(x: number, y: number, z: number, w: number): Mat4Like {
  const len = Math.hypot(x, y, z, w) || 1
  const qx = x / len
  const qy = y / len
  const qz = z / len
  const qw = w / len
  const x2 = qx + qx
  const y2 = qy + qy
  const z2 = qz + qz
  const xx = qx * x2
  const xy = qx * y2
  const xz = qx * z2
  const yy = qy * y2
  const yz = qy * z2
  const zz = qz * z2
  const wx = qw * x2
  const wy = qw * y2
  const wz = qw * z2
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ]
}

/* ------------------------------------------------------------------ */
/* Accessoren                                                          */
/* ------------------------------------------------------------------ */

function readBufferView(json: GltfJson, buffers: (Uint8Array | null)[], index: number): Uint8Array | null {
  const view = json.bufferViews?.[index]
  if (!view) return null
  const buffer = buffers[view.buffer ?? 0]
  if (!buffer) return null
  const start = view.byteOffset ?? 0
  const length = view.byteLength ?? buffer.length - start
  if (start + length > buffer.length) return null
  return buffer.subarray(start, start + length)
}

interface RawAccessor {
  read(element: number, component: number): number
  count: number
  components: number
}

function openAccessor(json: GltfJson, buffers: (Uint8Array | null)[], index: number): RawAccessor | null {
  const accessor = json.accessors?.[index]
  if (!accessor || accessor.bufferView === undefined) return null
  const view = json.bufferViews?.[accessor.bufferView]
  const buffer = buffers[view?.buffer ?? 0]
  if (!view || !buffer) return null

  const componentType = accessor.componentType ?? 5126
  const componentSize = COMPONENT_SIZE[componentType]
  const components = TYPE_COMPONENTS[accessor.type ?? 'SCALAR']
  if (!componentSize || !components) return null

  const elementSize = componentSize * components
  const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : elementSize
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const count = accessor.count ?? 0
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const read = (element: number, component: number): number => {
    const offset = base + element * stride + component * componentSize
    if (offset + componentSize > buffer.byteLength) return 0
    switch (componentType) {
      case 5120:
        return data.getInt8(offset)
      case 5121:
        return data.getUint8(offset)
      case 5122:
        return data.getInt16(offset, true)
      case 5123:
        return data.getUint16(offset, true)
      case 5125:
        return data.getUint32(offset, true)
      default:
        return data.getFloat32(offset, true)
    }
  }
  return { read, count, components }
}

function readAccessorVec3(
  json: GltfJson,
  buffers: (Uint8Array | null)[],
  index: number,
  scale: number,
): Vec3Like[] {
  const accessor = openAccessor(json, buffers, index)
  if (!accessor || accessor.components < 3) return []
  const out: Vec3Like[] = []
  for (let i = 0; i < accessor.count; i++) {
    out.push({
      x: accessor.read(i, 0) * scale,
      y: accessor.read(i, 1) * scale,
      z: accessor.read(i, 2) * scale,
    })
  }
  return out
}

function readAccessorScalar(json: GltfJson, buffers: (Uint8Array | null)[], index: number): number[] {
  const accessor = openAccessor(json, buffers, index)
  if (!accessor) return []
  const out: number[] = []
  for (let i = 0; i < accessor.count; i++) out.push(accessor.read(i, 0))
  return out
}

/* ------------------------------------------------------------------ */
/* Kleinkram                                                           */
/* ------------------------------------------------------------------ */

function findCompanion(opts: ImportOptions, uri: string): Uint8Array | null {
  const companions = opts.companions
  if (!companions) return null
  const decoded = safeDecode(uri)
  const key = Object.keys(companions).find(
    (name) => name === uri || name === decoded || baseName(name) === baseName(decoded),
  )
  return key ? companions[key] : null
}

function safeDecode(uri: string): string {
  try {
    return decodeURIComponent(uri)
  } catch {
    return uri
  }
}

function guessMime(uri: string): string {
  const lower = uri.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

/** lineares RGB (glTF) -> sRGB-Hex */
function linearToHex(factor: number[]): string {
  const toSrgb = (c: number): number => {
    const v = clamp01(c)
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  }
  return rgbToHex(toSrgb(factor[0] ?? 1) * 255, toSrgb(factor[1] ?? 1) * 255, toSrgb(factor[2] ?? 1) * 255)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
