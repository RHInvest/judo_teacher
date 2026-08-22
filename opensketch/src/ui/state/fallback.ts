/**
 * Fallback-Zustand.
 *
 * Store, Renderer, Werkzeuge und IO werden parallel entwickelt und werfen
 * anfangs `not implemented`. Damit die Oberflaeche trotzdem vollstaendig
 * rendert, liefert dieses Modul einen vollstaendigen, inerten `AppState`.
 * Alle Aktionen sind No-Ops, alle Leser liefern leere, aber gueltige Daten.
 */

import { IDENTITY_MATRIX, emptyGeometry, emptySelection } from '@/shared/types'
import { DEFAULT_UNITS } from '@/shared/units'
import type { AppState, UiState } from '@/shared/store-api'
import type {
  BBox3Like,
  Definition,
  FogSettings,
  Geometry,
  Mat4Like,
  SketchDocument,
  StyleSettings,
  SunSettings,
} from '@/shared/types'

export const IDENTITY: Mat4Like = IDENTITY_MATRIX

export const DEFAULT_STYLE: StyleSettings = {
  id: 'c000style',
  name: 'Standard',
  faceStyle: 'shadedWithTextures',
  xrayOpacity: 0.35,
  displayEdges: true,
  displayProfiles: true,
  profileWidth: 2,
  displayDepthCue: false,
  depthCueWidth: 4,
  displayExtensions: false,
  extensionLength: 4,
  displayEndpoints: false,
  endpointSize: 6,
  jitterEdges: false,
  edgeColor: '#20242c',
  edgeColorMode: 'all',
  frontColor: '#f4f5f7',
  backColor: '#93a2b5',
  backgroundColor: '#e7ecf2',
  skyColor: '#8ab6e8',
  groundColor: '#b6a892',
  displaySky: true,
  displayGround: true,
  groundTransparency: 0.3,
  showAxes: true,
  showGrid: false,
  gridSpacing: 1,
  showHiddenGeometry: false,
  showGuides: true,
  showSectionPlanes: true,
  showSectionCuts: true,
  sectionCutFill: '#c9ced6',
  sectionLineWidth: 3,
}

export const DEFAULT_SUN: SunSettings = {
  enabled: false,
  date: '2026-06-21',
  time: 12 * 60,
  latitude: 52.52,
  longitude: 13.405,
  timezone: 1,
  light: 0.8,
  dark: 0.35,
  onFaces: true,
  onGround: true,
  fromEdges: false,
  northAngle: 0,
  locationName: 'Berlin',
}

export const DEFAULT_FOG: FogSettings = {
  enabled: false,
  near: 10,
  far: 120,
  color: '#e7ecf2',
  useBackgroundColor: true,
}

const ROOT_ID = 'd000root'

function fallbackRoot(): Definition {
  return {
    id: ROOT_ID,
    name: 'Modell',
    kind: 'model',
    geometry: emptyGeometry(),
    children: [],
  }
}

export function fallbackDocument(): SketchDocument {
  return {
    meta: {
      name: 'Unbenannt',
      author: '',
      description: '',
      createdAt: new Date(0).toISOString(),
      modifiedAt: new Date(0).toISOString(),
      version: 1,
    },
    rootId: ROOT_ID,
    definitions: { [ROOT_ID]: fallbackRoot() },
    entities: {},
    materials: {},
    textures: {},
    tags: {},
    tagFolders: {},
    styles: { [DEFAULT_STYLE.id]: DEFAULT_STYLE },
    scenes: [],
    units: { ...DEFAULT_UNITS },
    sun: { ...DEFAULT_SUN },
    fog: { ...DEFAULT_FOG },
    activeStyleId: DEFAULT_STYLE.id,
    activeTagId: '',
    activeMaterialId: null,
  }
}

export const FALLBACK_UI: UiState = {
  openPanels: ['entityInfo', 'materials', 'tags'],
  activePanel: 'entityInfo',
  trayVisible: true,
  theme: 'dark',
  statusHint: 'Oberfläche bereit - Modellkern wird gerade verdrahtet.',
  statusModifiers: '',
  vcbLabel: 'Länge',
  vcbValue: '',
  vcbEditing: false,
  vcbPlaceholder: '',
  toasts: [],
  dialog: null,
  busy: null,
  stats: { faces: 0, edges: 0, instances: 0, triangles: 0, fps: 0 },
}

const EMPTY_GEOMETRY: Geometry = emptyGeometry()
const EMPTY_BOUNDS: BBox3Like = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }

const noop = (): void => undefined
const noopId = (): string => ''
const noopBool = (): boolean => false
const noopUndef = (): undefined => undefined

const FALLBACK_DOC = fallbackDocument()

/**
 * Vollstaendiger, inerter AppState. Wird verwendet, solange `@/model/store`
 * noch nicht implementiert ist oder wirft.
 */
export const FALLBACK_STATE: AppState = {
  doc: FALLBACK_DOC,
  geometryRevision: 0,
  sceneRevision: 0,
  materialRevision: 0,
  styleRevision: 0,
  selectionRevision: 0,

  context: {
    definitionId: FALLBACK_DOC.rootId,
    instancePath: [],
    definitionPath: [FALLBACK_DOC.rootId],
    worldTransform: IDENTITY,
  },
  selection: emptySelection(),
  hover: null,
  activeTool: 'select',
  previousTool: 'select',
  history: { undoStack: [], redoStack: [], pending: null },
  ui: FALLBACK_UI,
  ready: false,
  dirty: false,

  newDocument: noop,
  loadDocument: noop,
  exportDocument: () => FALLBACK_DOC,
  setDocumentName: noop,
  setUnits: noop,

  getDefinition: noopUndef,
  getActiveGeometry: () => EMPTY_GEOMETRY,
  getGeometry: () => EMPTY_GEOMETRY,
  getVertex: noopUndef,
  getEdge: noopUndef,
  getFace: noopUndef,
  getEntity: noopUndef,
  getMaterial: noopUndef,
  getTexture: noopUndef,
  getTag: noopUndef,
  getStyle: () => DEFAULT_STYLE,
  getWorldTransform: () => IDENTITY,
  getDefinitionBounds: () => EMPTY_BOUNDS,
  getSelectionBounds: () => null,
  getModelBounds: () => EMPTY_BOUNDS,
  getEntityInfo: () => null,
  isTagVisible: () => true,

  beginOperation: noop,
  commitOperation: noop,
  abortOperation: noop,
  operation: <T,>(_name: string, fn: () => T): T => fn(),
  undo: noop,
  redo: noop,
  canUndo: noopBool,
  canRedo: noopBool,
  clearHistory: noop,

  addEdge: () => emptyChangeLike(),
  addPolyline: () => emptyChangeLike(),
  addFace: () => emptyChangeLike(),
  deletePrimitives: () => emptyChangeLike(),
  moveVertices: () => emptyChangeLike(),
  transformPrimitives: () => emptyChangeLike(),
  pushPull: () => emptyChangeLike(),
  followMe: () => emptyChangeLike(),
  offsetFace: () => emptyChangeLike(),
  offsetEdges: () => emptyChangeLike(),
  intersectFaces: () => emptyChangeLike(),
  reverseFaces: noop,
  orientFaces: noop,
  softenEdges: noop,
  setEdgeFlags: noop,
  booleanOp: noop,

  makeGroup: () => null,
  makeComponent: () => null,
  explode: noop,
  placeInstance: noopId,
  makeUnique: noop,
  addEntity: noopId,
  updateEntity: noop,
  removeEntities: noop,
  transformEntities: () => [],
  setEntityName: noop,
  setEntityTag: noop,
  setEntityHidden: noop,
  setEntityLocked: noop,
  unhideAll: noop,
  upsertDefinition: noop,
  removeDefinition: noop,
  purgeUnused: () => ({ definitions: 0, materials: 0, tags: 0, textures: 0 }),

  enterContext: noop,
  exitContext: noopBool,
  exitAllContexts: noop,

  setSelection: noop,
  clearSelection: noop,
  selectAll: noop,
  invertSelection: noop,
  addToSelection: noop,
  removeFromSelection: noop,
  toggleSelection: noop,
  growSelection: noop,
  isSelected: noopBool,
  setHover: noop,

  addMaterial: noopId,
  updateMaterial: noop,
  removeMaterial: noop,
  addTexture: noopId,
  setActiveMaterial: noop,
  applyMaterial: noop,
  sampleMaterial: () => null,
  setFaceUv: noop,

  addTag: noopId,
  updateTag: noop,
  removeTag: noop,
  setActiveTag: noop,
  addTagFolder: noopId,
  updateTagFolder: noop,
  removeTagFolder: noop,

  updateStyle: noop,
  addStyle: noopId,
  setActiveStyle: noop,
  updateSun: noop,
  updateFog: noop,

  addScene: noopId,
  updateScene: noop,
  removeScene: noop,
  reorderScene: noop,
  activateScene: noop,
  updateSceneFromView: noop,

  setActiveTool: noop,
  restorePreviousTool: noop,
  setStatus: noop,
  setVcb: noop,
  togglePanel: noop,
  setActivePanel: noop,
  setTrayVisible: noop,
  setTheme: noop,
  openDialog: noop,
  closeDialog: noop,
  toast: noop,
  dismissToast: noop,
  setBusy: noop,
  setStats: noop,
  setDirty: noop,
}

function emptyChangeLike() {
  return {
    addedVertices: [],
    addedEdges: [],
    addedFaces: [],
    removedVertices: [],
    removedEdges: [],
    removedFaces: [],
    modifiedFaces: [],
    modifiedEdges: [],
  }
}
