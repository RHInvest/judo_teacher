/**
 * Fallback-Einstellungen. Der Renderer muss laufen, bevor Store und Kernel
 * fertig sind - deshalb hat er einen vollstaendigen eigenen Satz Voreinstellungen.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import type { FogSettings, StyleSettings, SunSettings } from '@/shared/types'

/** SketchUp-artige Standardfarben. */
export const FRONT_COLOR = '#f2efe6'
export const BACK_COLOR = '#8098b0'

/** Auswahl / Hover (SketchUp-Blau). */
export const SELECT_COLOR = '#1e88e5'
export const HOVER_COLOR = '#64b5f6'
export const CONTEXT_FRAME_COLOR = '#9aa4b2'
export const GUIDE_COLOR = '#4b5563'

export const AXIS_X_COLOR = '#d33b3b'
export const AXIS_Y_COLOR = '#2f9e44'
export const AXIS_Z_COLOR = '#2f6fd0'

export const DEFAULT_STYLE: StyleSettings = Object.freeze({
  id: 'style-default',
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
  endpointSize: 4,
  jitterEdges: false,
  edgeColor: '#2b2b2b',
  edgeColorMode: 'all',
  frontColor: FRONT_COLOR,
  backColor: BACK_COLOR,
  backgroundColor: '#ffffff',
  skyColor: '#9fc4e8',
  groundColor: '#c9bfae',
  displaySky: true,
  displayGround: true,
  groundTransparency: 0.4,
  showAxes: true,
  showGrid: false,
  gridSpacing: 1,
  showHiddenGeometry: false,
  showSectionPlanes: true,
  showSectionCuts: true,
  sectionCutFill: '#d9d2c2',
  sectionLineWidth: 3,
})

export const DEFAULT_SUN: SunSettings = Object.freeze({
  enabled: false,
  date: '2024-06-21',
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
})

export const DEFAULT_FOG: FogSettings = Object.freeze({
  enabled: false,
  near: 10,
  far: 200,
  color: '#ffffff',
  useBackgroundColor: true,
})

/** Standardkamera: SketchUp-Isometrie ueber dem Ursprung. */
export const DEFAULT_CAMERA = Object.freeze({
  eye: Object.freeze({ x: 12, y: -14, z: 9 }),
  target: Object.freeze({ x: 0, y: 0, z: 1.2 }),
  up: Object.freeze({ x: 0, y: 0, z: 1 }),
  fov: 35,
  projection: 'perspective' as const,
  orthoHeight: 8,
  twoPointPerspective: false,
})

/** Obergrenzen, damit ein pathologisches Modell den Browser nicht sprengt. */
export const LIMITS = Object.freeze({
  /** maximale Verschachtelungstiefe beim Aufbau des Instanzbaums */
  maxDepth: 24,
  /** maximale Anzahl Instanzknoten im flachen Baum */
  maxInstances: 20000,
  /** ab so vielen Instanzen derselben Definition wird InstancedMesh genutzt */
  instancingThreshold: 8,
  /** maximale Anzahl gebackener Kantensegmente fuer instanzierte Definitionen */
  maxBakedEdgeSegments: 400000,
  /** oberhalb dieser Kantenzahl werden Endpunkte nicht mehr gezeichnet */
  maxEndpointEdges: 60000,
  /** maximale Pixelverhaeltnis */
  maxPixelRatio: 2,
})
