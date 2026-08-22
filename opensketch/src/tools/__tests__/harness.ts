/**
 * Testdoppel fuer Store und Viewport.
 *
 * Die Werkzeugschicht spricht ausschliesslich gegen `AppState` und
 * `ViewportApi`. Hier liegen minimale, aber ehrliche Nachbauten: der Store
 * fuehrt Auswahl, Kontext und Operationen wirklich mit, der Viewport
 * projiziert mit einer festen Orthogonalkamera, sodass Bildschirmabstaende
 * deterministisch pruefbar sind.
 *
 * OWNERSHIP: Tools.
 */

import type { AppState, StoreHandle, ViewportApi } from '@/shared/store-api'
import { emptyChange } from '@/shared/store-api'
import type {
  BBox3Like,
  Definition,
  Edge,
  Entity,
  Face,
  Geometry,
  Id,
  OverlayApi,
  PickHit,
  Selection,
  Vec3Like,
  Vertex,
} from '@/shared/types'
import { emptyGeometry, emptySelection } from '@/shared/types'
import { DEFAULT_UNITS } from '@/shared/units'
import { M } from '@/core/math'

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

export interface RecordedDraw {
  kind: string
  args: unknown[]
}

export function createRecordingOverlay(): OverlayApi & { calls: RecordedDraw[] } {
  const calls: RecordedDraw[] = []
  const record =
    (kind: string) =>
    (...args: unknown[]): void => {
      calls.push({ kind, args })
    }
  return {
    calls,
    line: record('line'),
    polyline: record('polyline'),
    guide: record('guide'),
    point: record('point'),
    circle: record('circle'),
    arc: record('arc'),
    polygonFill: record('polygonFill'),
    box: record('box'),
    text: record('text'),
    screenRect: record('screenRect'),
    screenPolyline: record('screenPolyline'),
    ghost: record('ghost'),
    clear: record('clear'),
  } as OverlayApi & { calls: RecordedDraw[] }
}

/* ------------------------------------------------------------------ */
/* Geometrie-Baukasten                                                 */
/* ------------------------------------------------------------------ */

export interface GeometryBuilder {
  geometry: Geometry
  addVertex(p: Vec3Like, id?: Id): Vertex
  addEdge(a: Vertex, b: Vertex, id?: Id): Edge
  addQuad(points: [Vec3Like, Vec3Like, Vec3Like, Vec3Like], id?: Id): Face
}

export function createGeometry(): GeometryBuilder {
  const geometry = emptyGeometry()
  let counter = 0
  const next = (prefix: string): Id => `${prefix}${++counter}`

  const addVertex = (p: Vec3Like, id?: Id): Vertex => {
    const vertex: Vertex = { id: id ?? next('v'), p: { ...p }, edges: [] }
    geometry.vertices[vertex.id] = vertex
    return vertex
  }

  const addEdge = (a: Vertex, b: Vertex, id?: Id): Edge => {
    const edge: Edge = {
      id: id ?? next('e'),
      a: a.id,
      b: b.id,
      faces: [],
      soft: false,
      smooth: false,
      hidden: false,
      tagId: null,
      materialId: null,
    }
    geometry.edges[edge.id] = edge
    a.edges.push(edge.id)
    b.edges.push(edge.id)
    return edge
  }

  const addQuad = (points: [Vec3Like, Vec3Like, Vec3Like, Vec3Like], id?: Id): Face => {
    const vertices = points.map((p) => addVertex(p))
    const edges = vertices.map((v, i) => addEdge(v, vertices[(i + 1) % vertices.length]))
    const face: Face = {
      id: id ?? next('f'),
      outer: { edges: edges.map((e) => e.id), vertices: vertices.map((v) => v.id) },
      inner: [],
      normal: { x: 0, y: 0, z: 1 },
      plane: { n: { x: 0, y: 0, z: 1 }, d: points[0].z },
      frontMaterialId: null,
      backMaterialId: null,
      hidden: false,
      tagId: null,
    }
    geometry.faces[face.id] = face
    for (const e of edges) e.faces.push(face.id)
    return face
  }

  return { geometry, addVertex, addEdge, addQuad }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export interface FakeStore {
  handle: StoreHandle
  state: AppState
  /** Namen aller ausgefuehrten Operationen, in Reihenfolge */
  operations: string[]
  /** Aufrufe der Geometrieaenderungen */
  calls: { name: string; args: unknown[] }[]
  geometry: Geometry
  /** Text der zuletzt gesetzten Statuszeile ('' wenn nie gesetzt) */
  lastStatus(): string
  /** Texte aller Kurzmeldungen mit der Dringlichkeit `warn` */
  warnings(): string[]
  /** Hat das Werkzeug Geometrie erzeugt oder veraendert? */
  changedGeometry(): boolean
}

export interface FakeStoreOptions {
  /** Rueckgabe von `getSelectionBounds` - Skalieren braucht eine echte Box */
  selectionBounds?: BBox3Like | null
}

/** Aufrufe, die das Modell veraendern - fuer "es darf nichts entstanden sein". */
const GEOMETRY_CALLS: ReadonlySet<string> = new Set([
  'addEdge',
  'addPolyline',
  'addFace',
  'deletePrimitives',
  'moveVertices',
  'transformPrimitives',
  'transformEntities',
  'pushPull',
  'followMe',
  'offsetFace',
  'offsetEdges',
  // Annotationswerkzeuge veraendern das Modell ueber Entities und Definitionen.
  'addEntity',
  'upsertDefinition',
  'placeInstance',
])

/**
 * Baut einen Store, der nur das kann, was Werkzeuge wirklich benutzen.
 * Alles Uebrige ist ein protokollierender No-Op. Die Zusicherung nach
 * `AppState` ist bewusst - ein vollstaendiger Nachbau waere hunderte Zeilen
 * toter Code und wuerde nichts zusaetzlich absichern.
 */
export function createFakeStore(
  geometry: Geometry = emptyGeometry(),
  options: FakeStoreOptions = {},
): FakeStore {
  const operations: string[] = []
  const calls: { name: string; args: unknown[] }[] = []
  let selection: Selection = emptySelection()
  let activeTool = 'select'
  let contextDepth = 0

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args })
      return emptyChange()
    }

  const entities: Record<Id, Entity> = {}
  const definitions: Record<Id, Definition> = {
    root: { id: 'root', name: 'Modell', kind: 'model', geometry, children: [] },
  }
  let entityCounter = 0

  const partial = {
    doc: {
      units: { ...DEFAULT_UNITS },
      rootId: 'root',
      activeTagId: 'tag0',
      activeMaterialId: null,
      entities,
      definitions,
    },
    geometryRevision: 0,
    selectionRevision: 0,
    context: {
      definitionId: 'root',
      instancePath: [],
      definitionPath: ['root'],
      worldTransform: M.identity(),
    },
    get selection() {
      return selection
    },
    get activeTool() {
      return activeTool
    },
    hover: null,
    ready: true,

    getActiveGeometry: () => geometry,
    getGeometry: () => geometry,
    getVertex: (id: Id) => geometry.vertices[id],
    getEdge: (id: Id) => geometry.edges[id],
    getFace: (id: Id) => geometry.faces[id],
    getEntity: () => undefined,
    getMaterial: () => undefined,
    getSelectionBounds: () => options.selectionBounds ?? null,
    getDefinitionBounds: () => ({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }),

    operation: <T,>(name: string, fn: () => T): T => {
      operations.push(name)
      return fn()
    },
    beginOperation: (name: string) => {
      operations.push(name)
    },
    commitOperation: () => {},
    abortOperation: () => {},
    undo: track('undo'),
    redo: track('redo'),

    addEdge: track('addEdge'),
    addPolyline: track('addPolyline'),
    addFace: track('addFace'),
    deletePrimitives: track('deletePrimitives'),
    moveVertices: track('moveVertices'),
    transformPrimitives: track('transformPrimitives'),
    transformEntities: track('transformEntities'),
    pushPull: track('pushPull'),
    followMe: track('followMe'),
    offsetFace: track('offsetFace'),
    offsetEdges: track('offsetEdges'),
    applyMaterial: track('applyMaterial'),
    sampleMaterial: () => null,
    setEdgeFlags: track('setEdgeFlags'),
    softenEdges: track('softenEdges'),
    /*
     * Entities werden wirklich abgelegt: die Annotationswerkzeuge lesen sie
     * hinterher wieder (die Schnittebene legt zum Beispiel die zuvor aktive
     * still). Ein reiner Protokollaufruf wuerde das nicht abbilden.
     */
    addEntity: (entity: Entity) => {
      calls.push({ name: 'addEntity', args: [entity] })
      const id = entity.id && entity.id !== '' ? entity.id : `n${++entityCounter}`
      const copy = { ...entity, id } as Entity
      entities[id] = copy
      definitions.root.children.push(id)
      return id
    },
    updateEntity: (id: Id, patch: Record<string, unknown>) => {
      calls.push({ name: 'updateEntity', args: [id, patch] })
      const entity = entities[id]
      if (entity) entities[id] = { ...entity, ...patch } as Entity
    },
    removeEntities: (ids: Id[]) => {
      calls.push({ name: 'removeEntities', args: [ids] })
      for (const id of ids) delete entities[id]
    },
    upsertDefinition: (def: Definition) => {
      calls.push({ name: 'upsertDefinition', args: [def] })
      definitions[def.id] = def
    },
    placeInstance: (definitionId: Id, transform: unknown, opts?: { name?: string }) => {
      calls.push({ name: 'placeInstance', args: [definitionId, transform, opts] })
      const id = `i${++entityCounter}`
      definitions.root.children.push(id)
      return id
    },
    getModelBounds: () => ({ min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 3, z: 2 } }),
    makeGroup: () => {
      calls.push({ name: 'makeGroup', args: [] })
      return 'group1'
    },

    setSelection: (sel: Selection) => {
      calls.push({ name: 'setSelection', args: [sel] })
      selection = sel
    },
    clearSelection: () => {
      calls.push({ name: 'clearSelection', args: [] })
      selection = emptySelection()
    },
    addToSelection: track('addToSelection'),
    removeFromSelection: track('removeFromSelection'),
    toggleSelection: track('toggleSelection'),
    growSelection: track('growSelection'),
    setHover: () => {},
    enterContext: (id: Id) => {
      calls.push({ name: 'enterContext', args: [id] })
      contextDepth += 1
    },
    exitContext: () => {
      calls.push({ name: 'exitContext', args: [] })
      if (contextDepth === 0) return false
      contextDepth -= 1
      return true
    },

    setActiveTool: (id: string) => {
      calls.push({ name: 'setActiveTool', args: [id] })
      activeTool = id
    },
    setStatus: (hint: string, modifiers?: string) => {
      calls.push({ name: 'setStatus', args: [hint, modifiers] })
    },
    setVcb: () => {},
    toast: (text: string, kind?: string) => {
      calls.push({ name: 'toast', args: [text, kind] })
    },
    openDialog: track('openDialog'),
    closeDialog: () => {},
  }

  // siehe Kommentar oben: bewusste Zusicherung auf den vollen Contract
  const state = partial as unknown as AppState

  const handle: StoreHandle = {
    getState: () => state,
    setState: () => {},
    subscribe: () => () => {},
  }

  return {
    handle,
    state,
    operations,
    calls,
    geometry,
    lastStatus: () => {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].name === 'setStatus') return String(calls[i].args[0] ?? '')
      }
      return ''
    },
    warnings: () =>
      calls.filter((c) => c.name === 'toast' && c.args[1] === 'warn').map((c) => String(c.args[0] ?? '')),
    changedGeometry: () => calls.some((c) => GEOMETRY_CALLS.has(c.name)),
  }
}

/* ------------------------------------------------------------------ */
/* Viewport                                                            */
/* ------------------------------------------------------------------ */

export interface FakeViewportOptions {
  /** Treffer, den `pick` zurueckgibt */
  hit?: PickHit | null
  width?: number
  height?: number
  /** Bildschirmpixel pro Modelleinheit */
  scale?: number
}

export function emptyHit(): PickHit {
  return {
    kind: 'none',
    point: { x: 0, y: 0, z: 0 },
    distance: 0,
    normal: null,
    id: null,
    definitionId: null,
    instancePath: [],
    worldTransform: M.identity(),
    inContext: true,
    topInstanceId: null,
  }
}

export interface FakeViewport {
  api: ViewportApi
  overlay: OverlayApi & { calls: RecordedDraw[] }
  setHit(hit: PickHit | null): void
  camera: { orbit: number; pan: number; dolly: number }
  /** Weltpunkt -> Bildschirm, identisch zur Projektion von `api` */
  project(p: Vec3Like): { x: number; y: number }
}

/**
 * Viewport mit einer Draufsicht-Parallelprojektion:
 *   screen.x = width/2  + p.x * scale
 *   screen.y = height/2 - p.y * scale
 * Die Z-Achse zeigt zur Kamera. Damit sind Bildschirmabstaende in den Tests
 * exakt vorhersagbar.
 */
export function createFakeViewport(opts: FakeViewportOptions = {}): FakeViewport {
  const width = opts.width ?? 800
  const height = opts.height ?? 600
  const scale = opts.scale ?? 100
  let hit: PickHit | null = opts.hit ?? null
  const overlay = createRecordingOverlay()
  const camera = { orbit: 0, pan: 0, dolly: 0 }

  const project = (p: Vec3Like) => ({ x: width / 2 + p.x * scale, y: height / 2 - p.y * scale })

  const api: ViewportApi = {
    getCamera: () => ({
      eye: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 35,
      projection: 'parallel',
      orthoHeight: height / (2 * scale),
    }),
    setCamera: () => {},
    setStandardView: () => {},
    setProjection: () => {},
    zoomExtents: () => {},
    zoomSelection: () => {},
    zoomWindow: () => {},
    orbit: (dx) => {
      camera.orbit += dx
    },
    pan: (dx) => {
      camera.pan += dx
    },
    dolly: (amount) => {
      camera.dolly += amount
    },
    setFov: () => {},
    positionCamera: () => {},

    screenToRay: (x: number, y: number) => ({
      origin: { x: (x - width / 2) / scale, y: (height / 2 - y) / scale, z: 100 },
      dir: { x: 0, y: 0, z: -1 },
    }),
    worldToScreen: (p: Vec3Like) => ({ ...project(p), depth: -p.z, visible: true }),
    pixelsPerUnit: () => scale,
    getSize: () => ({ width, height }),

    pick: () => hit ?? emptyHit(),
    pickRect: () => emptySelection(),
    pickLasso: () => emptySelection(),

    overlay,
    requestRender: () => {},
    captureImage: async () => '',
    groundHit: (x: number, y: number) => ({ x: (x - width / 2) / scale, y: (height / 2 - y) / scale, z: 0 }),
    animateToScene: () => {},
    setCursor: () => {},
    dispose: () => {},
  }

  return {
    api,
    overlay,
    camera,
    project,
    setHit: (next: PickHit | null) => {
      hit = next
    },
  }
}

/** Zeigerereignis mit sinnvollen Vorgaben. */
export function pointer(x: number, y: number, extra: Partial<import('@/shared/types').PointerInfo> = {}) {
  return {
    x,
    y,
    button: 0,
    buttons: 1,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    ...extra,
  }
}

/** Tastaturereignis mit sinnvollen Vorgaben. */
export function key(name: string, extra: Partial<import('@/shared/types').KeyInfo> = {}) {
  return {
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    repeat: false,
    ...extra,
  }
}
