/**
 * Werkzeug-Metadaten fuer Werkzeugleiste, Menues und Instructor.
 * Reine UI-Daten - die eigentliche Logik liegt in `@/tools`.
 */

import {
  Aperture,
  ArrowLeftRight,
  ArrowUpFromDot,
  Axis3d,
  Camera,
  ChartPie,
  Circle,
  Compass,
  Cuboid,
  Diamond,
  Eraser,
  Eye,
  Footprints,
  Hand,
  Hexagon,
  Lasso,
  MousePointer2,
  Move,
  Orbit,
  PaintBucket,
  PenLine,
  Pencil,
  RotateCw,
  Route,
  Ruler,
  Scaling,
  ScanSearch,
  Scissors,
  Spline,
  Square,
  SquareDashed,
  Type,
  Waves,
  ZoomIn,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ToolId } from '@/shared/types'

export interface ToolMeta {
  id: ToolId
  name: string
  icon: LucideIcon
  /** Kurzhinweis fuer Tooltip und Statusleiste */
  hint: string
}

export const TOOL_META: Record<ToolId, ToolMeta> = {
  select: { id: 'select', name: 'Auswaehlen', icon: MousePointer2, hint: 'Objekte anklicken, aufziehen oder mit Umschalt ergaenzen.' },
  lasso: { id: 'lasso', name: 'Lasso-Auswahl', icon: Lasso, hint: 'Freie Flaeche aufziehen, um alles darin auszuwaehlen.' },
  eraser: { id: 'eraser', name: 'Radiergummi', icon: Eraser, hint: 'Kanten ueberstreichen zum Loeschen, Strg weichzeichnen, Umschalt verstecken.' },
  paint: { id: 'paint', name: 'Farbeimer', icon: PaintBucket, hint: 'Material auf Flaechen, Kanten oder ganze Gruppen auftragen.' },

  line: { id: 'line', name: 'Linie', icon: PenLine, hint: 'Startpunkt klicken, Endpunkt klicken. Laenge im Massfeld tippen.' },
  freehand: { id: 'freehand', name: 'Freihand', icon: Pencil, hint: 'Mit gedrueckter Maustaste einen freien Streckenzug zeichnen.' },
  rectangle: { id: 'rectangle', name: 'Rechteck', icon: Square, hint: 'Zwei gegenueberliegende Ecken klicken. Masse als "3;2" eingeben.' },
  rotatedRectangle: { id: 'rotatedRectangle', name: 'Gedrehtes Rechteck', icon: Diamond, hint: 'Grundkante festlegen, dann Breite aufziehen.' },
  circle: { id: 'circle', name: 'Kreis', icon: Circle, hint: 'Mittelpunkt klicken, Radius aufziehen. Segmentzahl vorab tippen.' },
  polygon: { id: 'polygon', name: 'Polygon', icon: Hexagon, hint: 'Mittelpunkt klicken, Umkreisradius aufziehen. Seitenzahl vorab tippen.' },
  arc2: { id: 'arc2', name: 'Zweipunktbogen', icon: Spline, hint: 'Sehne zeichnen, dann Bogenhoehe aufziehen.' },
  arc3: { id: 'arc3', name: 'Dreipunktbogen', icon: Waves, hint: 'Drei Punkte auf dem Bogen klicken.' },
  arc: { id: 'arc', name: 'Kreissegment', icon: Aperture, hint: 'Mittelpunkt, Startpunkt und Oeffnungswinkel angeben.' },
  pie: { id: 'pie', name: 'Torte', icon: ChartPie, hint: 'Mittelpunkt, Radius und Winkel - erzeugt ein geschlossenes Segment.' },
  bezier: { id: 'bezier', name: 'Bezierkurve', icon: Route, hint: 'Start und Ende klicken, danach die beiden Griffe setzen.' },

  move: { id: 'move', name: 'Verschieben', icon: Move, hint: 'Griffpunkt aufnehmen und absetzen. Strg erzeugt eine Kopie.' },
  rotate: { id: 'rotate', name: 'Drehen', icon: RotateCw, hint: 'Drehachse, Startwinkel und Zielwinkel angeben. Strg kopiert.' },
  scale: { id: 'scale', name: 'Skalieren', icon: Scaling, hint: 'Griff ziehen. Umschalt haelt die Proportionen, Strg skaliert zentriert.' },
  pushpull: { id: 'pushpull', name: 'Druecken/Ziehen', icon: ArrowUpFromDot, hint: 'Flaeche anfassen und extrudieren. Strg erzeugt eine neue Startflaeche.' },
  followme: { id: 'followme', name: 'Folge mir', icon: Compass, hint: 'Pfad vorher auswaehlen, dann das Profil anklicken.' },
  offset: { id: 'offset', name: 'Versatz', icon: SquareDashed, hint: 'Flaeche oder Kantenzug parallel nach innen oder aussen versetzen.' },

  tape: { id: 'tape', name: 'Massband', icon: Ruler, hint: 'Strecke messen. Ohne Strg entstehen Hilfslinien.' },
  protractor: { id: 'protractor', name: 'Winkelmesser', icon: Aperture, hint: 'Scheitel, Basis und Winkel angeben - erzeugt eine Hilfslinie.' },
  axes: { id: 'axes', name: 'Achsen', icon: Axis3d, hint: 'Zeichenachsen neu setzen: Ursprung, rote Richtung, gruene Richtung.' },
  dimension: { id: 'dimension', name: 'Bemassung', icon: ArrowLeftRight, hint: 'Zwei Punkte oder eine Kante waehlen, dann die Masslinie absetzen.' },
  text: { id: 'text', name: 'Text', icon: Type, hint: 'Punkt anklicken und Beschriftung eingeben.' },
  text3d: { id: 'text3d', name: '3D-Text', icon: Cuboid, hint: 'Text als extrudierte Geometrie einfuegen.' },
  sectionPlane: { id: 'sectionPlane', name: 'Schnittebene', icon: Scissors, hint: 'Flaeche anklicken, um dort eine Schnittebene abzulegen.' },

  orbit: { id: 'orbit', name: 'Orbit', icon: Orbit, hint: 'Ansicht um das Modell drehen. Mittlere Maustaste geht immer.' },
  pan: { id: 'pan', name: 'Schwenken', icon: Hand, hint: 'Ansicht verschieben.' },
  zoom: { id: 'zoom', name: 'Zoom', icon: ZoomIn, hint: 'Ziehen zum Zoomen, Umschalt aendert den Bildwinkel.' },
  zoomWindow: { id: 'zoomWindow', name: 'Zoomfenster', icon: ScanSearch, hint: 'Rechteck aufziehen, um genau diesen Ausschnitt zu fuellen.' },
  position: { id: 'position', name: 'Kamera positionieren', icon: Camera, hint: 'Standpunkt klicken, danach die Blickrichtung ziehen.' },
  walk: { id: 'walk', name: 'Gehen', icon: Footprints, hint: 'Mit gedrueckter Maustaste durch das Modell laufen.' },
  lookaround: { id: 'lookaround', name: 'Umsehen', icon: Eye, hint: 'Kopf drehen, ohne den Standpunkt zu veraendern.' },
}

export const ALL_TOOL_IDS: ToolId[] = Object.keys(TOOL_META) as ToolId[]

/* ------------------------------------------------------------------ */
/* Werkzeugleiste                                                      */
/* ------------------------------------------------------------------ */

export type ToolbarEntry =
  | { kind: 'tool'; id: ToolId }
  | { kind: 'flyout'; id: string; label: string; tools: ToolId[] }

export interface ToolbarGroup {
  id: string
  label: string
  entries: ToolbarEntry[]
}

export const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    id: 'principal',
    label: 'Auswahl',
    entries: [
      { kind: 'flyout', id: 'select', label: 'Auswaehlen', tools: ['select', 'lasso'] },
      { kind: 'tool', id: 'eraser' },
      { kind: 'tool', id: 'paint' },
    ],
  },
  {
    id: 'draw',
    label: 'Zeichnen',
    entries: [
      { kind: 'tool', id: 'line' },
      { kind: 'tool', id: 'freehand' },
      { kind: 'flyout', id: 'rect', label: 'Rechteck', tools: ['rectangle', 'rotatedRectangle'] },
      { kind: 'flyout', id: 'round', label: 'Kreis / Polygon', tools: ['circle', 'polygon'] },
      { kind: 'flyout', id: 'arc', label: 'Bogen', tools: ['arc2', 'arc3', 'arc', 'pie', 'bezier'] },
    ],
  },
  {
    id: 'modify',
    label: 'Aendern',
    entries: [
      { kind: 'tool', id: 'move' },
      { kind: 'tool', id: 'rotate' },
      { kind: 'tool', id: 'scale' },
      { kind: 'tool', id: 'pushpull' },
      { kind: 'tool', id: 'followme' },
      { kind: 'tool', id: 'offset' },
    ],
  },
  {
    id: 'construction',
    label: 'Konstruktion',
    entries: [
      { kind: 'tool', id: 'tape' },
      { kind: 'tool', id: 'protractor' },
      { kind: 'tool', id: 'axes' },
      { kind: 'tool', id: 'dimension' },
      { kind: 'tool', id: 'text' },
      { kind: 'tool', id: 'text3d' },
      { kind: 'tool', id: 'sectionPlane' },
    ],
  },
  {
    id: 'camera',
    label: 'Kamera',
    entries: [
      { kind: 'tool', id: 'orbit' },
      { kind: 'tool', id: 'pan' },
      { kind: 'tool', id: 'zoom' },
      { kind: 'tool', id: 'zoomWindow' },
      { kind: 'tool', id: 'position' },
      { kind: 'tool', id: 'walk' },
      { kind: 'tool', id: 'lookaround' },
    ],
  },
]

/** Werkzeuge des Menues "Zeichnen". */
export const DRAW_MENU_TOOLS: ToolId[] = [
  'line',
  'freehand',
  'rectangle',
  'rotatedRectangle',
  'circle',
  'polygon',
  'arc2',
  'arc3',
  'arc',
  'pie',
  'bezier',
]

/** Werkzeuge des Menues "Werkzeuge". */
export const TOOLS_MENU_TOOLS: ToolId[] = [
  'select',
  'lasso',
  'eraser',
  'paint',
  'move',
  'rotate',
  'scale',
  'pushpull',
  'followme',
  'offset',
  'tape',
  'protractor',
  'axes',
  'dimension',
  'text',
  'text3d',
  'sectionPlane',
]
