/**
 * Oeffentliche Fassade der Oberflaechenschicht.
 *
 * Nach aussen zaehlt nur `App` - `src/main.tsx` mountet genau diesen Export.
 * Alles Weitere ist fuer Tests und fuer den Fall gedacht, dass eine andere
 * Schicht einzelne Bausteine wiederverwenden will.
 *
 * OWNERSHIP: UI.
 */

export { App, App as default } from './App'

/* ---------------- Zustandszugriff ---------------- */

export { appState, act, edit, read, storeReady, toast, useApp, useAppSelector, shallowEqualArray } from './state/store'
export { FALLBACK_STATE, DEFAULT_STYLE, DEFAULT_SUN, DEFAULT_FOG, fallbackDocument } from './state/fallback'

/* ---------------- Befehle und Hilfsmittel ---------------- */

export * as commands from './lib/commands'
export { TOOL_META, TOOLBAR_GROUPS, ALL_TOOL_IDS, DRAW_MENU_TOOLS, TOOLS_MENU_TOOLS } from './lib/tools'
export type { ToolMeta, ToolbarEntry, ToolbarGroup } from './lib/tools'
export {
  DEFAULT_TOOL_SHORTCUTS,
  MENU_SHORTCUTS,
  allToolShortcuts,
  findToolForEvent,
  matchesCombo,
  parseCombo,
  toolShortcut,
} from './lib/shortcuts'
export type { Combo, MenuShortcutId } from './lib/shortcuts'
export { TOOL_INSTRUCTIONS, instructionFor } from './lib/instructor'
export type { ToolInstruction } from './lib/instructor'
export { CITY_PRESETS, findCity } from './lib/cities'
export type { CityPreset } from './lib/cities'
export { fmtArea, fmtBytes, fmtClock, fmtCount, fmtDate, fmtLength, fmtTimestamp, fmtVolume, normalizeHex, useUnits } from './lib/format'
export { isSlideshowRunning, onSlideshowChange, startSlideshow, stopSlideshow, toggleSlideshow } from './lib/slideshow'
export { useGlobalShortcuts } from './lib/useGlobalShortcuts'
export { DARK, LIGHT, SkinContext, skinFor, useSkin } from './lib/theme'
export type { Skin } from './lib/theme'

/* ---------------- Bausteine ---------------- */

export { MenuBar } from './toolbars/MenuBar'
export { StatusBar } from './toolbars/StatusBar'
export { MeasurementBox } from './toolbars/MeasurementBox'
export { ToolPalette } from './toolbars/ToolPalette'
export { Tray, TRAY_COLLAPSE_WIDTH } from './panels/Tray'
export { PANEL_META, PANEL_ORDER } from './panels/meta'
export type { PanelMeta } from './panels/meta'
export { PANEL_COMPONENTS } from './panels/registry'
export { ViewportArea } from './overlays/ViewportArea'
export { ViewCube, compassAngle, matchStandardView } from './overlays/ViewCube'
export { Toasts, TOAST_DURATIONS } from './overlays/Toasts'
export { BusyOverlay } from './overlays/BusyOverlay'
export { SceneTabs } from './overlays/SceneTabs'
export { Welcome } from './overlays/Welcome'
export { ViewportContextMenu, contextMenuEntries } from './overlays/ContextMenu'
export { DialogHost, LocalDialogHost, Dialog, DialogTabs } from './dialogs'
export type { LocalDialog } from './dialogs'
export { dayOfYear, isoFromDayOfYear } from './panels/ShadowsPanel'
