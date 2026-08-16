/**
 * The application store contract.
 *
 * `@/model/store.ts` implements this interface with zustand:
 *
 *   export const useStore = create<AppState>()((set, get) => ({ ... }))
 *   export const store = { getState: useStore.getState, setState: useStore.setState, subscribe: useStore.subscribe }
 *
 * Tools (`@/tools`) and UI (`@/ui`) program ONLY against this interface, never
 * against the internal implementation. The renderer reads state and subscribes
 * to `revision` counters to know what to rebuild.
 *
 * OWNERSHIP: lead developer. Implementation: model developer.
 */

import type {
  BBox3Like,
  CameraState,
  Definition,
  Edge,
  EditContext,
  Entity,
  EntityInfoSummary,
  Face,
  FogSettings,
  Geometry,
  Id,
  InstanceEntity,
  Loop,
  Mat4Like,
  Material,
  PlaneLike,
  Scene,
  Selection,
  SketchDocument,
  StandardView,
  StyleSettings,
  SunSettings,
  Tag,
  TagFolder,
  Texture,
  ToolId,
  UnitSettings,
  Vec3Like,
  Vertex,
} from './types'

/* ------------------------------------------------------------------ */
/* Results returned by geometry mutations                              */
/* ------------------------------------------------------------------ */

export interface GeometryChange {
  addedVertices: Id[]
  addedEdges: Id[]
  addedFaces: Id[]
  removedVertices: Id[]
  removedEdges: Id[]
  removedFaces: Id[]
  modifiedFaces: Id[]
  modifiedEdges: Id[]
}

export function emptyChange(): GeometryChange {
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

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export interface HistoryEntry {
  id: Id
  name: string
  timestamp: number
}

export interface HistoryState {
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  /** name of the operation currently being recorded, null when idle */
  pending: string | null
}

/* ------------------------------------------------------------------ */
/* UI state owned by the store                                         */
/* ------------------------------------------------------------------ */

export type PanelId =
  | 'entityInfo'
  | 'materials'
  | 'components'
  | 'tags'
  | 'outliner'
  | 'styles'
  | 'scenes'
  | 'shadows'
  | 'fog'
  | 'softenEdges'
  | 'instructor'
  | 'modelInfo'

export interface UiState {
  /** which trays are open, in tray order */
  openPanels: PanelId[]
  /** panel currently expanded in the right tray */
  activePanel: PanelId | null
  trayVisible: boolean
  theme: 'dark' | 'light'
  /** status bar */
  statusHint: string
  statusModifiers: string
  /** the measurement box ("VCB") */
  vcbLabel: string
  vcbValue: string
  vcbEditing: boolean
  vcbPlaceholder: string
  /** transient toast messages */
  toasts: { id: Id; text: string; kind: 'info' | 'warn' | 'error' | 'success' }[]
  /** open modal dialog */
  dialog: DialogState | null
  /** true while the renderer is busy with a long operation */
  busy: string | null
  /**
   * Kennwerte fuer die Statuszeile.
   *
   * `faces`/`edges`/`instances` sind MODELLwerte und werden inhaltsgetrieben
   * aktualisiert, also einmal pro Bearbeitungsschritt. `triangles` und `fps`
   * sind RENDERwerte aus dem letzten Frame und laufen gedrosselt mit
   * nachlaufendem Push - eine Drosselung ohne Nachlauf friert die Anzeige
   * dauerhaft ein, weil nur bei Bedarf gerendert wird.
   */
  stats: { faces: number; edges: number; instances: number; triangles: number; fps: number }
}

export type DialogState =
  | { kind: 'modelInfo'; tab: string }
  | { kind: 'preferences'; tab: string }
  | { kind: 'makeComponent'; defaults: { name: string } }
  | { kind: 'exportModel' }
  | { kind: 'importModel' }
  | { kind: 'exportImage' }
  | { kind: 'text3d' }
  | { kind: 'softenEdges' }
  | { kind: 'about' }
  | { kind: 'openFile' }
  | { kind: 'confirm'; title: string; message: string; onConfirm: () => void }

/* ------------------------------------------------------------------ */
/* The full state                                                      */
/* ------------------------------------------------------------------ */

export interface AppState {
  /* ---------------- document ---------------- */
  doc: SketchDocument

  /**
   * Monotonically increasing counters. The renderer subscribes to these
   * instead of deep-diffing the document.
   *  - geometryRevision: any vertex/edge/face changed anywhere
   *  - sceneRevision: entities added/removed/transformed
   *  - materialRevision: materials/textures changed
   *  - styleRevision: style/sun/fog/tag visibility changed
   *  - selectionRevision: selection changed
   */
  geometryRevision: number
  sceneRevision: number
  materialRevision: number
  styleRevision: number
  selectionRevision: number

  /* ---------------- editing state ---------------- */
  context: EditContext
  selection: Selection
  hover: { kind: string; id: Id | null; definitionId: Id | null } | null
  activeTool: ToolId
  previousTool: ToolId
  history: HistoryState
  ui: UiState
  /** false until the first document has been loaded */
  ready: boolean
  /** true when the document has unsaved changes */
  dirty: boolean

  /* ================================================================ */
  /* Document lifecycle                                               */
  /* ================================================================ */
  newDocument(template?: 'metric' | 'imperial' | 'empty'): void
  loadDocument(doc: SketchDocument): void
  /** returns a deep, serializable clone */
  exportDocument(): SketchDocument
  setDocumentName(name: string): void
  setUnits(units: Partial<UnitSettings>): void

  /* ================================================================ */
  /* Read helpers - never mutate                                      */
  /* ================================================================ */
  getDefinition(id: Id): Definition | undefined
  /** geometry of the active editing context */
  getActiveGeometry(): Geometry
  getGeometry(definitionId: Id): Geometry | undefined
  getVertex(id: Id, definitionId?: Id): Vertex | undefined
  getEdge(id: Id, definitionId?: Id): Edge | undefined
  getFace(id: Id, definitionId?: Id): Face | undefined
  getEntity(id: Id): Entity | undefined
  getMaterial(id: Id | null): Material | undefined
  getTexture(id: Id | null): Texture | undefined
  getTag(id: Id | null): Tag | undefined
  getStyle(): StyleSettings
  /** world transform of an instance path */
  getWorldTransform(instancePath: Id[]): Mat4Like
  /** bounding box of a definition's geometry + children, in definition space */
  getDefinitionBounds(definitionId: Id): BBox3Like
  /** bounding box of the current selection, in world space */
  getSelectionBounds(): BBox3Like | null
  getModelBounds(): BBox3Like
  /** aggregated info for the entity info panel */
  getEntityInfo(): EntityInfoSummary | null
  /** true when the tag (and all parent folders) is visible */
  isTagVisible(tagId: Id | null): boolean

  /* ================================================================ */
  /* History / transactions                                           */
  /* ================================================================ */
  /**
   * Every mutating action must be wrapped:
   *   beginOperation('Linie zeichnen'); ...mutations...; commitOperation()
   * Nested calls are reference counted. `abortOperation()` restores the
   * snapshot taken at the outermost `beginOperation`.
   */
  beginOperation(name: string): void
  commitOperation(): void
  abortOperation(): void
  /** convenience wrapper */
  operation<T>(name: string, fn: () => T): T
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  clearHistory(): void

  /* ================================================================ */
  /* Geometry mutation (delegates to the kernel)                      */
  /* ================================================================ */
  /**
   * Adds an edge between two points in the ACTIVE context. Splits existing
   * edges at intersections, merges duplicate vertices within tolerance and
   * automatically creates faces for every new closed planar loop.
   */
  addEdge(a: Vec3Like, b: Vec3Like, opts?: { guide?: boolean }): GeometryChange
  /** adds a connected polyline; `closed` closes the loop back to the first point */
  addPolyline(points: Vec3Like[], closed: boolean, opts?: { guide?: boolean }): GeometryChange
  /** adds a face directly from a closed loop of points (already planar) */
  addFace(points: Vec3Like[], holes?: Vec3Like[][]): GeometryChange
  /** deletes primitives and cleans up orphaned vertices/faces */
  deletePrimitives(ids: { edgeIds?: Id[]; faceIds?: Id[]; vertexIds?: Id[]; entityIds?: Id[] }): GeometryChange
  /** moves vertices; connected faces are re-planarized or triangulated */
  moveVertices(vertexIds: Id[], delta: Vec3Like): GeometryChange
  /** transforms the given primitives with a 4x4 matrix */
  transformPrimitives(sel: Selection, matrix: Mat4Like, copy: boolean): GeometryChange
  /** push/pull a face by `distance` along its normal (or `direction`) */
  pushPull(faceId: Id, distance: number, opts?: { direction?: Vec3Like; createNewStartingFace?: boolean }): GeometryChange
  /** sweeps `profileFaceId` along the ordered edge path */
  followMe(profileFaceId: Id, pathEdgeIds: Id[]): GeometryChange
  /** offsets a face's outer loop by `distance` (positive = outwards) */
  offsetFace(faceId: Id, distance: number): GeometryChange
  /** offsets a chain of connected edges */
  offsetEdges(edgeIds: Id[], distance: number): GeometryChange
  /** intersects the selection with the rest of the model, creating edges */
  intersectFaces(scope: 'selection' | 'model' | 'context'): GeometryChange
  /** flips the front/back orientation of faces */
  reverseFaces(faceIds: Id[]): void
  /** aligns all connected faces to the orientation of the first */
  orientFaces(faceId: Id): void
  /** soften/smooth edges whose adjacent faces are within `angle` degrees */
  softenEdges(edgeIds: Id[], angle: number, opts: { softenCoplanar: boolean }): void
  setEdgeFlags(edgeIds: Id[], flags: Partial<Pick<Edge, 'soft' | 'smooth' | 'hidden'>>): void
  /** solid boolean operations between two solid groups/components */
  booleanOp(op: 'union' | 'subtract' | 'intersect' | 'trim' | 'split', targetId: Id, toolId: Id): void

  /* ================================================================ */
  /* Entities, groups and components                                  */
  /* ================================================================ */
  /** wraps the current selection into a group, returns the new instance id */
  makeGroup(name?: string): Id | null
  /** wraps the current selection into a component definition */
  makeComponent(opts: { name: string; description?: string; behavior?: Definition['behavior'] }): Id | null
  /** dissolves group/component instances back into the parent context */
  explode(entityIds: Id[]): void
  /** places a definition into the active context */
  placeInstance(definitionId: Id, transform: Mat4Like, opts?: { name?: string }): Id
  /** makes the selected instances use their own private copy of the definition */
  makeUnique(entityIds: Id[]): void
  addEntity(entity: Entity): Id
  updateEntity(id: Id, patch: Partial<Entity>): void
  removeEntities(ids: Id[]): void
  transformEntities(ids: Id[], matrix: Mat4Like, copy: boolean): Id[]
  setEntityName(id: Id, name: string): void
  setEntityTag(ids: Id[], tagId: Id | null): void
  setEntityHidden(ids: Id[], hidden: boolean): void
  setEntityLocked(ids: Id[], locked: boolean): void
  /** unhide everything in the active context */
  unhideAll(): void
  /** creates or updates a definition (used by the component library) */
  upsertDefinition(def: Definition): void
  removeDefinition(id: Id): void
  /** purge unused definitions, materials, tags and styles */
  purgeUnused(): { definitions: number; materials: number; tags: number; textures: number }

  /* ================================================================ */
  /* Editing context navigation                                       */
  /* ================================================================ */
  /** double click into a group/component instance */
  enterContext(instanceId: Id): void
  /** step one level out; returns false when already at the root */
  exitContext(): boolean
  /** jump straight back to the model root */
  exitAllContexts(): void

  /* ================================================================ */
  /* Selection                                                        */
  /* ================================================================ */
  setSelection(sel: Selection): void
  clearSelection(): void
  selectAll(): void
  invertSelection(): void
  addToSelection(sel: Partial<Selection>): void
  removeFromSelection(sel: Partial<Selection>): void
  toggleSelection(sel: Partial<Selection>): void
  /** expands the selection like SketchUp's double/triple click */
  growSelection(mode: 'boundingEdges' | 'connected' | 'coplanar' | 'sameMaterial' | 'sameTag'): void
  isSelected(kind: 'edge' | 'face' | 'vertex' | 'entity', id: Id): boolean
  setHover(hover: AppState['hover']): void

  /* ================================================================ */
  /* Materials                                                        */
  /* ================================================================ */
  addMaterial(material: Omit<Material, 'id'> & { id?: Id }): Id
  updateMaterial(id: Id, patch: Partial<Material>): void
  removeMaterial(id: Id): void
  addTexture(texture: Omit<Texture, 'id'> & { id?: Id }): Id
  setActiveMaterial(id: Id | null): void
  /** paints faces/edges/instances; `side` decides front/back for faces */
  applyMaterial(target: Partial<Selection>, materialId: Id | null, side?: 'front' | 'back' | 'both'): void
  /** samples the material under the given primitive */
  sampleMaterial(kind: 'face' | 'edge' | 'entity', id: Id, side?: 'front' | 'back'): Id | null
  setFaceUv(faceId: Id, side: 'front' | 'back', uv: Face['uvFront'] | undefined): void

  /* ================================================================ */
  /* Tags (layers)                                                    */
  /* ================================================================ */
  addTag(name: string): Id
  updateTag(id: Id, patch: Partial<Tag>): void
  removeTag(id: Id, reassignTo?: Id): void
  setActiveTag(id: Id): void
  addTagFolder(name: string): Id
  updateTagFolder(id: Id, patch: Partial<TagFolder>): void
  removeTagFolder(id: Id): void

  /* ================================================================ */
  /* Styles, sun, fog                                                 */
  /* ================================================================ */
  updateStyle(patch: Partial<StyleSettings>): void
  addStyle(style: StyleSettings): Id
  setActiveStyle(id: Id): void
  updateSun(patch: Partial<SunSettings>): void
  updateFog(patch: Partial<FogSettings>): void

  /* ================================================================ */
  /* Scenes                                                           */
  /* ================================================================ */
  addScene(name?: string): Id
  updateScene(id: Id, patch: Partial<Scene>): void
  removeScene(id: Id): void
  reorderScene(id: Id, index: number): void
  /** the viewport listens for this and animates the camera */
  activateScene(id: Id): void
  updateSceneFromView(id: Id): void

  /* ================================================================ */
  /* Tools & UI                                                       */
  /* ================================================================ */
  setActiveTool(tool: ToolId): void
  /** restores the tool that was active before a transient camera tool */
  restorePreviousTool(): void
  setStatus(hint: string, modifiers?: string): void
  setVcb(patch: Partial<Pick<UiState, 'vcbLabel' | 'vcbValue' | 'vcbEditing' | 'vcbPlaceholder'>>): void
  togglePanel(panel: PanelId): void
  setActivePanel(panel: PanelId | null): void
  setTrayVisible(visible: boolean): void
  setTheme(theme: 'dark' | 'light'): void
  openDialog(dialog: DialogState): void
  closeDialog(): void
  toast(text: string, kind?: 'info' | 'warn' | 'error' | 'success'): void
  dismissToast(id: Id): void
  setBusy(label: string | null): void
  setStats(stats: Partial<UiState['stats']>): void
  setDirty(dirty: boolean): void
}

/* ------------------------------------------------------------------ */
/* Store handle used outside of React                                  */
/* ------------------------------------------------------------------ */

export interface StoreHandle {
  getState(): AppState
  setState(partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void
  subscribe(listener: (state: AppState, prev: AppState) => void): () => void
}

/* ------------------------------------------------------------------ */
/* Viewport contract (implemented by @/render)                         */
/* ------------------------------------------------------------------ */

export interface ViewportApi {
  /* camera */
  getCamera(): CameraState
  setCamera(camera: Partial<CameraState>, animate?: boolean): void
  setStandardView(view: StandardView, animate?: boolean): void
  setProjection(mode: 'perspective' | 'parallel'): void
  zoomExtents(animate?: boolean): void
  zoomSelection(animate?: boolean): void
  zoomWindow(x0: number, y0: number, x1: number, y1: number): void
  /** relative orbit in screen pixels */
  orbit(dx: number, dy: number): void
  pan(dx: number, dy: number): void
  /** positive = zoom in; `screen` keeps the point under the cursor fixed */
  dolly(amount: number, screen?: { x: number; y: number }): void
  /** field of view / focal length for the zoom tool */
  setFov(fov: number): void
  /** eye height walkthrough positioning */
  positionCamera(eye: Vec3Like, target: Vec3Like, eyeHeight?: number): void

  /* projection helpers */
  screenToRay(x: number, y: number): { origin: Vec3Like; dir: Vec3Like }
  worldToScreen(p: Vec3Like): { x: number; y: number; depth: number; visible: boolean }
  /** how many screen pixels correspond to one model unit at `p` */
  pixelsPerUnit(p: Vec3Like): number
  /** canvas size in css pixels */
  getSize(): { width: number; height: number }

  /* picking */
  pick(x: number, y: number, options?: import('./types').PickOptions): import('./types').PickHit
  /** everything intersecting a screen rectangle; `crossing` = touch instead of contain */
  pickRect(x0: number, y0: number, x1: number, y1: number, crossing: boolean): Selection
  /** everything inside a screen space lasso polygon */
  pickLasso(points: { x: number; y: number }[], crossing: boolean): Selection

  /* rendering */
  overlay: import('./types').OverlayApi
  requestRender(): void
  /** renders the current view to a PNG data url */
  captureImage(opts?: { width?: number; height?: number; transparent?: boolean }): Promise<string>
  /** world space ground plane hit, used when nothing else is under the cursor */
  groundHit(x: number, y: number): Vec3Like | null
  /** animate the camera to a scene */
  animateToScene(scene: Scene): void
  setCursor(cursor: import('./types').Cursor): void
  dispose(): void
}

/* ------------------------------------------------------------------ */
/* Inference contract (implemented by @/tools/inference)               */
/* ------------------------------------------------------------------ */

export interface InferenceApi {
  /**
   * Computes the best inference for the pointer position.
   * `from` is the previous point of a multi step tool (enables axis, parallel,
   * perpendicular and "from point" inferences).
   */
  infer(
    x: number,
    y: number,
    opts?: {
      from?: Vec3Like | null
      /** constrain the result to this plane (e.g. while drawing on a face) */
      plane?: PlaneLike | null
      /** additional reference points that create extension inferences */
      references?: Vec3Like[]
      /** direction of the previous segment, used for parallel/perpendicular */
      lastDirection?: Vec3Like | null
      /** disables all snapping (shift-less free movement) */
      disabled?: boolean
      /** ids that may not be snapped to */
      ignore?: Id[]
    },
  ): import('./types').InferenceResult

  /** currently active lock */
  getLock(): import('./types').InferenceLock
  setLock(lock: import('./types').InferenceLock): void
  clearLock(): void
  /** handles arrow keys / shift for locking; returns true when consumed */
  handleKey(key: import('./types').KeyInfo, down: boolean, from: Vec3Like | null): boolean
  /** draws inference markers and guide lines */
  draw(overlay: import('./types').OverlayApi, result: import('./types').InferenceResult | null): void
  /** remembers a point so it produces extension inferences later */
  addReferencePoint(p: Vec3Like): void
  clearReferencePoints(): void
}

/* ------------------------------------------------------------------ */
/* Tool contract (implemented by @/tools)                              */
/* ------------------------------------------------------------------ */

export interface ToolContext {
  store: StoreHandle
  viewport: ViewportApi
  overlay: import('./types').OverlayApi
  inference: InferenceApi
  /** sets the status bar hint */
  setStatus(hint: string, modifiers?: string): void
  /** configures the measurement box */
  setVcb(label: string, value: string, placeholder?: string): void
  setCursor(cursor: import('./types').Cursor): void
  /** switches back to the select tool */
  finish(): void
}

export interface Tool {
  readonly id: ToolId
  readonly name: string
  readonly cursor: import('./types').Cursor
  /** status bar text shown when the tool starts */
  readonly hint: string
  activate(ctx: ToolContext): void
  deactivate(): void
  onPointerDown(e: import('./types').PointerInfo): void
  onPointerMove(e: import('./types').PointerInfo): void
  onPointerUp(e: import('./types').PointerInfo): void
  onDoubleClick?(e: import('./types').PointerInfo): void
  onWheel?(e: import('./types').PointerInfo): void
  onKeyDown(e: import('./types').KeyInfo): boolean
  onKeyUp(e: import('./types').KeyInfo): boolean
  /** user pressed Enter in the measurement box; return true when handled */
  onValueEntry(text: string): boolean
  /** immediate mode preview drawing, called every frame */
  draw(overlay: import('./types').OverlayApi): void
  /** Esc pressed - abort the current operation but stay active */
  cancel(): void
}

export interface ToolManagerApi {
  setTool(id: ToolId): void
  getTool(): Tool | null
  getToolId(): ToolId
  /** temporarily activates a tool (space bar, middle mouse) */
  pushTransient(id: ToolId): void
  popTransient(): void
  handlePointerDown(e: import('./types').PointerInfo): void
  handlePointerMove(e: import('./types').PointerInfo): void
  handlePointerUp(e: import('./types').PointerInfo): void
  handleDoubleClick(e: import('./types').PointerInfo): void
  handleWheel(e: import('./types').PointerInfo): void
  handleKeyDown(e: import('./types').KeyInfo): boolean
  handleKeyUp(e: import('./types').KeyInfo): boolean
  handleValueEntry(text: string): boolean
  draw(): void
  dispose(): void
}
