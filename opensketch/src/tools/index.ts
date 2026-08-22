/**
 * Oeffentliche Fassade der Werkzeugschicht.
 *
 * Nach aussen sichtbar sind nur die beiden Fabriken und die Kuerzeltabelle -
 * `src/app/ViewportHost.tsx` verdrahtet damit Renderer, Store und Werkzeuge,
 * `src/ui` liest die Kuerzel.
 *
 * OWNERSHIP: Tools.
 */

import type { InferenceApi, StoreHandle, ToolManagerApi, ViewportApi } from '@/shared/store-api'
import { InferenceEngine } from './inference'
import { ToolManager } from './toolManager'

export interface ToolDeps {
  store: StoreHandle
  viewport: ViewportApi
}

export function createInferenceEngine(deps: ToolDeps): InferenceApi {
  return new InferenceEngine(deps.store, deps.viewport)
}

export function createToolManager(deps: ToolDeps & { inference: InferenceApi }): ToolManagerApi {
  return new ToolManager(deps)
}

/* ------------------------------------------------------------------ */
/* Wiederverwendbare Teile (UI, Tests, andere Werkzeuge)               */
/* ------------------------------------------------------------------ */

export { ALL_TOOL_IDS, TOOL_FACTORIES, TOOL_NAMES, TOOL_SHORTCUTS, ToolManager, toolForKey } from './toolManager'
export { AXIS_COLORS, COLORS, axisColor } from './colors'
export { BaseTool } from './toolBase'
export { PlaceholderTool } from './placeholder'
export { getModelAxes, setModelAxes, resetModelAxes, axisDirections } from './modelAxes'
export type { ModelAxes } from './modelAxes'

export {
  InferenceEngine,
  isStrongPoint,
  labelFor,
  colorFor,
  markerFor,
  pickBestPoint,
  pickBestDirection,
  pointPriority,
  snapRadiusFor,
  screenLineDistance,
  INFERENCE_LABELS,
} from './inference'
export type { InferOptions, PointCandidate, DirectionCandidate } from './inference'

export {
  parseArrayInput,
  parseAngleInput,
  parseCoordinateInput,
  parseLengthInput,
  parseLengthPair,
  parseScaleInput,
  parseScaleList,
  parseSegmentsInput,
} from './vcbInput'
export type { ArrayInput, CoordinateInput } from './vcbInput'

export {
  arc3Points,
  arcBulgePoints,
  arcPoints,
  bezierPoints,
  bulgeFromRadius,
  circlePoints,
  circumcenter,
  planeBasis,
  polygonPoints,
  radiusFromBulge,
  rectanglePoints,
  simplifyPolyline,
  usablePoints,
} from './geom'
