/**
 * OpenSketch Studio - shared data contracts.
 *
 * Everything in this file is PLAIN DATA (no classes, no methods) so it can be
 * serialized, structurally cloned, diffed and sent through the undo system.
 * Behaviour lives in `@/core` (geometry kernel), `@/model` (document),
 * `@/render` (viewport) and `@/tools` (interaction).
 *
 * OWNERSHIP: this file is owned by the lead developer. Modules must not edit
 * it; if a type is missing, request the change instead of patching locally.
 */

import type { Id } from './ids'

export type { Id }

/* ------------------------------------------------------------------ */
/* Geometry value types                                                */
/* ------------------------------------------------------------------ */

export interface Vec2Like {
  x: number
  y: number
}

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Column major 4x4 matrix, identical memory layout to THREE.Matrix4.elements */
export type Mat4Like = readonly number[] & { length: 16 }

export interface PlaneLike {
  /** unit normal */
  n: Vec3Like
  /** signed distance from origin along n:  dot(n, p) - d = 0 */
  d: number
}

export interface RayLike {
  origin: Vec3Like
  /** unit direction */
  dir: Vec3Like
}

export interface BBox3Like {
  min: Vec3Like
  max: Vec3Like
}

/* ------------------------------------------------------------------ */
/* Raw geometry (one editing context = one geometry soup)              */
/* ------------------------------------------------------------------ */

export interface Vertex {
  id: Id
  p: Vec3Like
  /** edges referencing this vertex */
  edges: Id[]
}

export interface Edge {
  id: Id
  /** start vertex */
  a: Id
  /** end vertex */
  b: Id
  /** faces bounded by this edge (0..n) */
  faces: Id[]
  /** soft edges are not drawn and smooth the shading between adjacent faces */
  soft: boolean
  /** smooth edges average the vertex normals of adjacent faces */
  smooth: boolean
  /** manually hidden */
  hidden: boolean
  /** true for construction/guide edges - never create faces */
  guide?: boolean
  tagId: Id | null
  materialId: Id | null
}

/** An ordered, closed ring of edges. `edges[i]` connects `vertices[i]` to `vertices[i+1]`. */
export interface Loop {
  edges: Id[]
  vertices: Id[]
}

export interface Face {
  id: Id
  /** outer boundary, counter clockwise seen from the front (along +normal) */
  outer: Loop
  /** holes, wound clockwise seen from the front */
  inner: Loop[]
  /** unit face normal (front side) */
  normal: Vec3Like
  /** plane of the face, normal == `normal` */
  plane: PlaneLike
  frontMaterialId: Id | null
  backMaterialId: Id | null
  hidden: boolean
  tagId: Id | null
  /** optional explicit uv mapping, 4 point mapping like SketchUp's texture positioning */
  uvFront?: UvMapping
  uvBack?: UvMapping
}

export interface UvMapping {
  /** world -> uv affine transform, row major 3x3 acting on the face's plane basis */
  m: readonly number[]
  /** origin in world space used to build the plane basis */
  origin: Vec3Like
  xAxis: Vec3Like
  yAxis: Vec3Like
  scaleU: number
  scaleV: number
  rotation: number
  offsetU: number
  offsetV: number
  flipU?: boolean
  flipV?: boolean
}

/** The geometry contained by one definition (model root, group or component). */
export interface Geometry {
  vertices: Record<Id, Vertex>
  edges: Record<Id, Edge>
  faces: Record<Id, Face>
}

export function emptyGeometry(): Geometry {
  return { vertices: {}, edges: {}, faces: {} }
}

/* ------------------------------------------------------------------ */
/* Definitions and entities                                            */
/* ------------------------------------------------------------------ */

export type DefinitionKind = 'model' | 'group' | 'component'

export interface Definition {
  id: Id
  name: string
  kind: DefinitionKind
  /** free form description shown in the component browser */
  description?: string
  geometry: Geometry
  /** nested instances and annotation entities living inside this definition */
  children: Id[]
  /** glue / alignment behaviour of component instances */
  behavior?: ComponentBehavior
  /** number of instances currently placed, maintained by the document */
  instanceCount?: number
  /** library components are read only templates */
  isLibrary?: boolean
  /** base64 png thumbnail for the component browser */
  thumbnail?: string
}

export interface ComponentBehavior {
  /** snap/glue plane: none = free, any = every face */
  glueTo: 'none' | 'any' | 'horizontal' | 'vertical' | 'sloped'
  /** cuts an opening into the face it is glued to (windows, doors) */
  cutsOpening: boolean
  /** always faces the camera */
  alwaysFaceCamera: boolean
  /** shadows are cast from the bounding box instead of the geometry */
  shadowsFaceSun: boolean
  /** scaling restrictions, e.g. "1d" only uniform */
  scaleRestriction?: 'none' | 'uniform' | 'noScale'
}

export type EntityType =
  | 'instance'
  | 'dimension'
  | 'text'
  | 'sectionPlane'
  | 'guidePoint'
  | 'guideLine'
  | 'image'

interface EntityBase {
  id: Id
  type: EntityType
  name: string
  tagId: Id | null
  hidden: boolean
  locked: boolean
}

/** A group or component placement. Groups own a definition used exactly once. */
export interface InstanceEntity extends EntityBase {
  type: 'instance'
  definitionId: Id
  transform: Mat4Like
  isGroup: boolean
  /** per instance material override (inherited by faces with material == null) */
  materialId: Id | null
}

export type DimensionKind = 'linear' | 'diameter' | 'radius' | 'angular'

export interface DimensionEntity extends EntityBase {
  type: 'dimension'
  kind: DimensionKind
  /** measured points in the owning definition's space */
  start: Vec3Like
  end: Vec3Like
  /** offset of the dimension line from the measured segment */
  offset: Vec3Like
  /** optional third point for angular dimensions */
  center?: Vec3Like
  text: string | null
  fontSize: number
  color: string
  /** true = 2d screen space text, false = text lives on a 3d plane */
  screenSpace: boolean
  arrowStyle: 'slash' | 'dot' | 'closedArrow' | 'openArrow' | 'none'
}

export interface TextEntity extends EntityBase {
  type: 'text'
  /** anchor point on geometry (leader target) */
  anchor: Vec3Like
  /** text position */
  position: Vec3Like
  text: string
  fontSize: number
  color: string
  /** 3d text is extruded geometry, screen text always faces the camera */
  screenSpace: boolean
  leader: 'none' | 'viewBased' | 'pushPin'
}

export interface SectionPlaneEntity extends EntityBase {
  type: 'sectionPlane'
  plane: PlaneLike
  active: boolean
  symbolSize: number
  color: string
}

export interface GuidePointEntity extends EntityBase {
  type: 'guidePoint'
  position: Vec3Like
  /** origin of the measuring operation that created it */
  from?: Vec3Like
}

export interface GuideLineEntity extends EntityBase {
  type: 'guideLine'
  origin: Vec3Like
  direction: Vec3Like
  /** null = infinite construction line */
  length: number | null
}

export interface ImageEntity extends EntityBase {
  type: 'image'
  textureId: Id
  transform: Mat4Like
  width: number
  height: number
  /** matched photo / watermark images are not part of the model geometry */
  usage: 'model' | 'watermark'
}

export type Entity =
  | InstanceEntity
  | DimensionEntity
  | TextEntity
  | SectionPlaneEntity
  | GuidePointEntity
  | GuideLineEntity
  | ImageEntity

/* ------------------------------------------------------------------ */
/* Materials, textures, tags                                           */
/* ------------------------------------------------------------------ */

export interface Material {
  id: Id
  name: string
  /** '#rrggbb' */
  color: string
  /** 0..1, 1 = fully opaque */
  opacity: number
  textureId: Id | null
  /** real world size of one texture tile, in model units (metres) */
  textureWidth: number
  textureHeight: number
  /** simple PBR-ish hints used by the renderer */
  roughness: number
  metalness: number
  /** category used to group swatches in the material browser */
  category: string
  /** colorize a texture with `color` */
  colorize: boolean
}

export interface Texture {
  id: Id
  name: string
  /** data url (png/jpeg) so documents stay self contained */
  dataUrl: string
  width: number
  height: number
}

export interface Tag {
  id: Id
  name: string
  visible: boolean
  /** color used when style.colorBy === 'tag' */
  color: string
  /** dashed line style for edges on this tag */
  dashes: 'solid' | 'dash' | 'dot' | 'dashdot'
  folderId: Id | null
  locked: boolean
}

export interface TagFolder {
  id: Id
  name: string
  visible: boolean
}

/* ------------------------------------------------------------------ */
/* Camera, styles, environment                                         */
/* ------------------------------------------------------------------ */

export type ProjectionMode = 'perspective' | 'parallel'

export interface CameraState {
  eye: Vec3Like
  target: Vec3Like
  up: Vec3Like
  /** vertical field of view in degrees (perspective only) */
  fov: number
  projection: ProjectionMode
  /** half height of the view volume in model units (parallel only) */
  orthoHeight: number
  /** two point perspective keeps verticals vertical */
  twoPointPerspective?: boolean
}

export type StandardView =
  | 'iso'
  | 'top'
  | 'bottom'
  | 'front'
  | 'back'
  | 'left'
  | 'right'

export type FaceStyle =
  | 'shadedWithTextures'
  | 'shaded'
  | 'hiddenLine'
  | 'wireframe'
  | 'monochrome'
  | 'xray'

export interface StyleSettings {
  id: Id
  name: string
  faceStyle: FaceStyle
  /** faces are transparent in xray mode */
  xrayOpacity: number
  displayEdges: boolean
  displayProfiles: boolean
  profileWidth: number
  displayDepthCue: boolean
  depthCueWidth: number
  displayExtensions: boolean
  extensionLength: number
  displayEndpoints: boolean
  endpointSize: number
  jitterEdges: boolean
  edgeColor: string
  /** 'byMaterial' | 'byTag' | 'all' (single edge color) */
  edgeColorMode: 'all' | 'byMaterial' | 'byTag'
  frontColor: string
  backColor: string
  backgroundColor: string
  skyColor: string
  groundColor: string
  displaySky: boolean
  displayGround: boolean
  groundTransparency: number
  showAxes: boolean
  showGrid: boolean
  gridSpacing: number
  showHiddenGeometry: boolean
  showSectionPlanes: boolean
  showSectionCuts: boolean
  sectionCutFill: string
  sectionLineWidth: number
}

export interface SunSettings {
  enabled: boolean
  /** ISO date 'YYYY-MM-DD' */
  date: string
  /** minutes since midnight, local solar time */
  time: number
  latitude: number
  longitude: number
  /** hours offset from UTC */
  timezone: number
  /** 0..1 brightness of lit areas */
  light: number
  /** 0..1 brightness of shadowed areas */
  dark: number
  onFaces: boolean
  onGround: boolean
  fromEdges: boolean
  /** rotation of the model's north direction, degrees clockwise from +Y */
  northAngle: number
  /** name of the chosen city preset, informational only */
  locationName: string
}

export interface FogSettings {
  enabled: boolean
  near: number
  far: number
  color: string
  useBackgroundColor: boolean
}

export interface Scene {
  id: Id
  name: string
  description: string
  camera: CameraState
  /** which aspects the scene restores */
  saves: {
    camera: boolean
    tagVisibility: boolean
    style: boolean
    shadows: boolean
    hiddenGeometry: boolean
    sectionPlanes: boolean
  }
  tagVisibility: Record<Id, boolean>
  styleId: Id
  sun: SunSettings
  fog: FogSettings
  hiddenEntityIds: Id[]
  activeSectionPlaneId: Id | null
  /** transition seconds when animating to this scene */
  transitionTime: number
  delayTime: number
  included: boolean
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

/**
 * The internal working unit of the whole application is ONE METRE.
 * All Vec3 coordinates, lengths and areas are metres / m2 / m3.
 * Display formatting happens exclusively through `@/shared/units`.
 */
export type LengthUnit = 'm' | 'cm' | 'mm' | 'in' | 'ft' | 'ftin' | 'yd'
export type AngleUnit = 'deg' | 'rad'
export type AreaUnit = 'm2' | 'cm2' | 'mm2' | 'ft2' | 'in2'
export type VolumeUnit = 'm3' | 'cm3' | 'l' | 'ft3'

export interface UnitSettings {
  format: 'decimal' | 'architectural' | 'engineering' | 'fractional'
  lengthUnit: LengthUnit
  angleUnit: AngleUnit
  areaUnit: AreaUnit
  volumeUnit: VolumeUnit
  precision: number
  /** smallest fraction denominator for architectural/fractional display */
  fractionDenominator: 2 | 4 | 8 | 16 | 32 | 64
  displayUnitSuffix: boolean
  /** snapping increment in metres, 0 = off */
  lengthSnap: number
  angleSnap: number
  enableLengthSnap: boolean
  enableAngleSnap: boolean
}

/* ------------------------------------------------------------------ */
/* Selection and editing context                                       */
/* ------------------------------------------------------------------ */

/**
 * The active context is the definition currently being edited. Entering a group
 * pushes its instance onto the path; the geometry of that definition becomes
 * directly editable while everything else renders dimmed.
 */
export interface EditContext {
  /** definition being edited, last element of `definitionPath` */
  definitionId: Id
  /** instance ids from the model root down to the current context */
  instancePath: Id[]
  /** definition ids from the model root down to the current context */
  definitionPath: Id[]
  /** accumulated world transform of the current context */
  worldTransform: Mat4Like
}

export interface Selection {
  /** ids of vertices/edges/faces inside the active context */
  edgeIds: Id[]
  faceIds: Id[]
  vertexIds: Id[]
  /** ids of child entities (instances, dimensions, ...) of the active context */
  entityIds: Id[]
}

export function emptySelection(): Selection {
  return { edgeIds: [], faceIds: [], vertexIds: [], entityIds: [] }
}

export function selectionCount(s: Selection): number {
  return s.edgeIds.length + s.faceIds.length + s.vertexIds.length + s.entityIds.length
}

export function selectionIsEmpty(s: Selection): boolean {
  return selectionCount(s) === 0
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

export interface DocumentMeta {
  name: string
  author: string
  description: string
  createdAt: string
  modifiedAt: string
  /** schema version for migrations */
  version: number
}

export interface SketchDocument {
  meta: DocumentMeta
  /** id of the model root definition */
  rootId: Id
  definitions: Record<Id, Definition>
  entities: Record<Id, Entity>
  materials: Record<Id, Material>
  textures: Record<Id, Texture>
  tags: Record<Id, Tag>
  tagFolders: Record<Id, TagFolder>
  styles: Record<Id, Style>
  scenes: Scene[]
  units: UnitSettings
  sun: SunSettings
  fog: FogSettings
  activeStyleId: Id
  /** tag assigned to newly created geometry */
  activeTagId: Id
  /** material assigned to newly created geometry, null = default */
  activeMaterialId: Id | null
}

export type Style = StyleSettings

/* ------------------------------------------------------------------ */
/* Picking / hit testing                                               */
/* ------------------------------------------------------------------ */

export type PickKind =
  | 'none'
  | 'vertex'
  | 'edge'
  | 'face'
  | 'instance'
  | 'entity'
  | 'ground'
  | 'guide'

export interface PickHit {
  kind: PickKind
  /** world space intersection point */
  point: Vec3Like
  /** distance from the ray origin */
  distance: number
  /** world space normal where meaningful */
  normal: Vec3Like | null
  /** id of the hit primitive inside `definitionId` */
  id: Id | null
  /** definition owning the hit primitive */
  definitionId: Id | null
  /** instance path from the model root to the owning definition */
  instancePath: Id[]
  /** transform mapping the owning definition's space to world space */
  worldTransform: Mat4Like
  /** true when the primitive is directly editable in the active context */
  inContext: boolean
  /** topmost instance of the hit, used for selecting whole groups */
  topInstanceId: Id | null
}

export interface PickOptions {
  /** pixel radius in which vertices/edges win over faces */
  tolerance?: number
  /** ignore these entity/primitive ids (e.g. the object being dragged) */
  ignore?: Id[]
  /** only pick these kinds */
  kinds?: PickKind[]
  /** allow picking through the active context into nested geometry */
  deep?: boolean
  /** when true, hidden and back-facing primitives can be hit */
  includeHidden?: boolean
}

/* ------------------------------------------------------------------ */
/* Inference engine                                                    */
/* ------------------------------------------------------------------ */

export type InferenceType =
  | 'none'
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'onEdge'
  | 'onFace'
  | 'onPlane'
  | 'onAxisX'
  | 'onAxisY'
  | 'onAxisZ'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'fromPoint'
  | 'onGuide'
  | 'halfCircle'
  | 'square'
  | 'golden'
  | 'equal'
  | 'extension'

export interface InferenceResult {
  point: Vec3Like
  type: InferenceType
  /** localized tooltip text, e.g. "Endpunkt" / "Auf Flaeche" */
  label: string
  /** color used for the marker and the rubber band */
  color: string
  /** marker glyph the renderer should draw */
  marker: 'square' | 'circle' | 'diamond' | 'cross' | 'triangle' | 'x' | 'none'
  /** true if the user locked this inference with an arrow key or shift */
  locked: boolean
  /** direction constraint when the inference is directional */
  direction: Vec3Like | null
  /** plane constraint when the inference lies on a plane */
  plane: PlaneLike | null
  /** referenced primitives, used to draw the dotted helper line */
  refEdgeId?: Id | null
  refFaceId?: Id | null
  refPoint?: Vec3Like | null
  /** true when the point is a real 3d hit instead of a projection */
  onGeometry: boolean
  /** the raw pick this inference was derived from */
  hit?: PickHit | null
}

export type InferenceLock =
  | { kind: 'none' }
  | { kind: 'axis'; axis: 'x' | 'y' | 'z'; direction: Vec3Like }
  | { kind: 'direction'; direction: Vec3Like; label: string }
  | { kind: 'plane'; plane: PlaneLike; label: string }
  | { kind: 'point'; point: Vec3Like; label: string }

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export type ToolId =
  // selection & edit
  | 'select'
  | 'lasso'
  | 'eraser'
  | 'paint'
  // drawing
  | 'line'
  | 'freehand'
  | 'rectangle'
  | 'rotatedRectangle'
  | 'circle'
  | 'polygon'
  | 'arc2'
  | 'arc3'
  | 'arc'
  | 'pie'
  | 'bezier'
  // modification
  | 'move'
  | 'rotate'
  | 'scale'
  | 'pushpull'
  | 'followme'
  | 'offset'
  // construction & annotation
  | 'tape'
  | 'protractor'
  | 'axes'
  | 'dimension'
  | 'text'
  | 'text3d'
  | 'sectionPlane'
  // camera
  | 'orbit'
  | 'pan'
  | 'zoom'
  | 'zoomWindow'
  | 'position'
  | 'walk'
  | 'lookaround'

export interface PointerInfo {
  /** css pixels relative to the canvas */
  x: number
  y: number
  button: number
  buttons: number
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
  /** wheel delta, only set for wheel events */
  delta?: number
  /** number of consecutive clicks (1,2,3) */
  clickCount?: number
}

export interface KeyInfo {
  key: string
  code: string
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
  repeat: boolean
}

/* ------------------------------------------------------------------ */
/* Overlay drawing (transient tool feedback)                           */
/* ------------------------------------------------------------------ */

export interface OverlayStyle {
  color?: string
  width?: number
  dashed?: boolean
  dashSize?: number
  /** draw on top of everything, ignoring depth */
  onTop?: boolean
  opacity?: number
}

/**
 * Immediate mode overlay API. A tool calls these inside `draw()`; the renderer
 * clears the overlay before every `draw()` call.
 */
export interface OverlayApi {
  line(a: Vec3Like, b: Vec3Like, style?: OverlayStyle): void
  polyline(points: Vec3Like[], closed: boolean, style?: OverlayStyle): void
  /** dotted "inference guide" that extends past both points */
  guide(a: Vec3Like, b: Vec3Like, style?: OverlayStyle): void
  point(p: Vec3Like, marker: InferenceResult['marker'], style?: OverlayStyle & { size?: number }): void
  circle(center: Vec3Like, normal: Vec3Like, radius: number, style?: OverlayStyle): void
  arc(center: Vec3Like, normal: Vec3Like, radius: number, start: number, end: number, style?: OverlayStyle): void
  polygonFill(points: Vec3Like[], style?: OverlayStyle): void
  box(bbox: BBox3Like, transform?: Mat4Like, style?: OverlayStyle): void
  /** screen space text anchored to a world point */
  text(p: Vec3Like, text: string, style?: OverlayStyle & { offsetX?: number; offsetY?: number; size?: number; background?: string }): void
  /** screen space rectangle, used for rubber band selection */
  screenRect(x0: number, y0: number, x1: number, y1: number, style?: OverlayStyle & { fill?: string }): void
  screenPolyline(points: Vec2Like[], closed: boolean, style?: OverlayStyle): void
  /** ghost preview mesh built from triangles in world space */
  ghost(positions: Float32Array, indices: Uint32Array, style?: OverlayStyle): void
  clear(): void
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export interface StatusMessage {
  /** main hint shown on the left of the status bar */
  hint: string
  /** optional secondary hint (modifier keys) */
  modifiers?: string
}

export interface MeasurementField {
  /** label in front of the input, e.g. "Laenge", "Radius", "Winkel" */
  label: string
  /** current value formatted for display */
  value: string
  /** true while the user is typing */
  editing: boolean
  /** placeholder shown when idle */
  placeholder?: string
}

export type Cursor =
  | 'default'
  | 'crosshair'
  | 'pointer'
  | 'move'
  | 'grab'
  | 'grabbing'
  | 'ns-resize'
  | 'ew-resize'
  | 'nwse-resize'
  | 'zoom-in'
  | 'zoom-out'
  | 'none'
  | 'not-allowed'

export interface EntityInfoSummary {
  kind: string
  count: number
  /** metric rows shown in the entity info panel */
  rows: { label: string; value: string }[]
  /** shared editable attributes */
  tagId?: Id | null
  materialId?: Id | null
  hidden?: boolean
  locked?: boolean
  softEdges?: boolean
  smoothEdges?: boolean
  name?: string
}
