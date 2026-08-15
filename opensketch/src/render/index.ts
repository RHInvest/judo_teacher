/**
 * Oeffentliche Fassade des Render-Moduls.
 *
 * Nach aussen zaehlt genau eine Funktion: `createViewport(canvas, { store })`
 * liefert eine `ViewportApi` (Contract aus `@/shared/store-api`). Alles Weitere
 * ist Implementierungsdetail und wird nur exportiert, weil Tests und
 * Werkzeugbau davon profitieren.
 *
 * OWNERSHIP: Render-Entwickler.
 */

export { createViewport, Viewport, type ViewportDeps } from './viewport'

/* Kamera, Picking und Overlay - fuer Tests und Sonderfaelle */
export { CameraController } from './camera'
export { Picker, DEFAULT_PICK_TOLERANCE, emptyHit, intersectGround } from './picking'
export { OverlayRenderer, type OverlayHost } from './overlay'

/* Szenensync und Darstellung */
export { SceneSync, type DefinitionBuild, type InstanceRecord, type SceneStats, type FaceGroup } from './sceneSync'
export { SelectionView } from './selection'
export { SectionManager, toThreePlane, type ActiveSection } from './sections'
export { Environment } from './styles'
export { LightRig, type LightState } from './lights'
export { MaterialCache, type FaceSide, type FaceMaterialOptions } from './materials'
export {
  EdgeMaterials,
  classifyEdge,
  extractEdges,
  edgeColors,
  EDGE_CLASSES,
  type EdgeClass,
  type EdgeBucket,
  type EdgeExtraction,
} from './edges'
export { SketchLineMaterial, setLineResolution, type SketchLineOptions } from './lineMaterial'

/* Sonnenstand (NOAA) */
export { solarPosition, sunVector, sunLightDirection, northVector, julianDay, type SolarPosition } from './sun'

/* Schnappschuss und Voreinstellungen */
export { readSnapshot, mergeStyle, zeroRevisions, revisionsEqual, type RenderSnapshot, type Revisions } from './snapshot'
export {
  DEFAULT_STYLE,
  DEFAULT_SUN,
  DEFAULT_FOG,
  DEFAULT_CAMERA,
  LIMITS,
  FRONT_COLOR,
  BACK_COLOR,
  SELECT_COLOR,
  HOVER_COLOR,
  AXIS_X_COLOR,
  AXIS_Y_COLOR,
  AXIS_Z_COLOR,
} from './defaults'
