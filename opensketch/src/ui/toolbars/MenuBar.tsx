/** Menueleiste mit vollstaendigen Untermenues, Kuerzeln und Zustandshaken. */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Boxes } from 'lucide-react'
import type { FaceStyle, StandardView, ToolId } from '@/shared/types'
import type { PanelId } from '@/shared/store-api'
import { useSkin } from '@/ui/lib/theme'
import { MenuList, menuSep } from '@/ui/components/menu'
import type { MenuEntry } from '@/ui/components/menu'
import { DRAW_MENU_TOOLS, TOOLS_MENU_TOOLS, TOOL_META } from '@/ui/lib/tools'
import { MENU_SHORTCUTS, toolShortcut } from '@/ui/lib/shortcuts'
import { PANEL_META, PANEL_ORDER } from '@/ui/panels/meta'
import { act, useApp } from '@/ui/state/store'
import * as cmd from '@/ui/lib/commands'

const FACE_STYLES: { value: FaceStyle; label: string }[] = [
  { value: 'shadedWithTextures', label: 'Schattiert mit Texturen' },
  { value: 'shaded', label: 'Schattiert' },
  { value: 'hiddenLine', label: 'Verdeckte Linien' },
  { value: 'wireframe', label: 'Drahtgitter' },
  { value: 'monochrome', label: 'Monochrom' },
  { value: 'xray', label: 'Roentgen' },
]

const STANDARD_VIEWS: { value: StandardView; label: string }[] = [
  { value: 'iso', label: 'Isometrisch' },
  { value: 'top', label: 'Oben' },
  { value: 'bottom', label: 'Unten' },
  { value: 'front', label: 'Vorne' },
  { value: 'back', label: 'Hinten' },
  { value: 'left', label: 'Links' },
  { value: 'right', label: 'Rechts' },
]

export interface MenuBarProps {
  onShowShortcuts: () => void
  onShowQuickstart: () => void
  onSaveAs: () => void
  onPlaySlideshow: () => void
  openPanel: (panel: PanelId) => void
}

export function MenuBar(props: MenuBarProps) {
  const skin = useSkin()
  const state = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (barRef.current && event.target instanceof Node && !barRef.current.contains(event.target)) setOpen(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const style = state.doc?.styles?.[state.doc?.activeStyleId] ?? state.doc?.styles?.[Object.keys(state.doc?.styles ?? {})[0] ?? '']
  const sun = state.doc?.sun
  const fog = state.doc?.fog
  const selectionEntities = state.selection?.entityIds ?? []
  const anySelection = cmd.hasSelection()
  const recent = cmd.readRecent()
  const undoLabel = cmd.undoName()
  const redoLabel = cmd.redoName()
  const projection = cmd.currentProjection()

  const patchStyle = (patch: Parameters<typeof state.updateStyle>[0]) => act((s) => s.updateStyle(patch))

  const toolItem = (id: ToolId): MenuEntry => ({
    label: TOOL_META[id].name,
    shortcut: toolShortcut(id),
    icon: TOOL_META[id].icon,
    checked: state.activeTool === id,
    radio: true,
    run: () => cmd.setTool(id),
  })

  const menus: { id: string; label: string; entries: MenuEntry[] }[] = [
    {
      id: 'datei',
      label: 'Datei',
      entries: [
        { label: 'Neu', shortcut: MENU_SHORTCUTS.newDocument, run: () => cmd.cmdNew('metric') },
        { label: 'Oeffnen ...', shortcut: MENU_SHORTCUTS.open, run: () => act((s) => s.openDialog({ kind: 'openFile' })) },
        {
          label: 'Zuletzt geoeffnet',
          disabled: recent.length === 0,
          items:
            recent.length === 0
              ? [{ label: 'Keine Eintraege', disabled: true }]
              : recent.map((entry) => ({
                  label: entry.name || 'Unbenannt',
                  run: () => {
                    void cmd.cmdOpenSaved(entry.id)
                  },
                })),
        },
        { label: 'Aus Datei oeffnen ...', run: () => void cmd.cmdOpenFromDisk() },
        menuSep(),
        { label: 'Speichern', shortcut: MENU_SHORTCUTS.save, run: () => void cmd.cmdSave() },
        { label: 'Speichern unter ...', shortcut: MENU_SHORTCUTS.saveAs, run: props.onSaveAs },
        menuSep(),
        {
          label: 'Importieren',
          shortcut: MENU_SHORTCUTS.importFile,
          items: [
            { label: 'Datei waehlen ...', run: () => void cmd.cmdImport() },
            menuSep(),
            { label: 'OBJ (.obj)', run: () => void cmd.cmdImport() },
            { label: 'STL (.stl)', run: () => void cmd.cmdImport() },
            { label: 'glTF / GLB', run: () => void cmd.cmdImport() },
            { label: 'SVG (.svg)', run: () => void cmd.cmdImport() },
            { label: 'Bild (.png, .jpg)', run: () => void cmd.cmdImport() },
          ],
        },
        {
          label: 'Exportieren',
          items: [
            { label: 'Modell ...', shortcut: MENU_SHORTCUTS.exportModel, run: () => act((s) => s.openDialog({ kind: 'exportModel' })) },
            { label: '2D-Grafik ...', run: () => act((s) => s.openDialog({ kind: 'exportModel' })) },
            { label: 'Bild ...', run: () => act((s) => s.openDialog({ kind: 'exportImage' })) },
          ],
        },
        menuSep(),
        { label: 'Modellinfo ...', run: () => act((s) => s.openDialog({ kind: 'modelInfo', tab: 'units' })) },
      ],
    },
    {
      id: 'bearbeiten',
      label: 'Bearbeiten',
      entries: [
        {
          label: undoLabel ? `Rueckgaengig: ${undoLabel}` : 'Rueckgaengig',
          shortcut: MENU_SHORTCUTS.undo,
          disabled: !cmd.canUndo(),
          run: cmd.cmdUndo,
        },
        {
          label: redoLabel ? `Wiederholen: ${redoLabel}` : 'Wiederholen',
          shortcut: MENU_SHORTCUTS.redo,
          disabled: !cmd.canRedo(),
          run: cmd.cmdRedo,
        },
        menuSep(),
        { label: 'Ausschneiden', shortcut: MENU_SHORTCUTS.cut, disabled: !anySelection, run: cmd.cmdCut },
        { label: 'Kopieren', shortcut: MENU_SHORTCUTS.copy, disabled: !anySelection, run: cmd.cmdCopy },
        { label: 'Einfuegen', shortcut: MENU_SHORTCUTS.paste, disabled: !cmd.clipboardFilled(), run: () => cmd.cmdPaste(false) },
        {
          label: 'An Ort einfuegen',
          shortcut: MENU_SHORTCUTS.pasteInPlace,
          disabled: !cmd.clipboardFilled(),
          run: () => cmd.cmdPaste(true),
        },
        menuSep(),
        { label: 'Loeschen', shortcut: MENU_SHORTCUTS.delete, disabled: !anySelection, run: cmd.cmdDelete },
        menuSep(),
        { label: 'Alles auswaehlen', shortcut: MENU_SHORTCUTS.selectAll, run: cmd.cmdSelectAll },
        { label: 'Abwaehlen', shortcut: MENU_SHORTCUTS.deselect, disabled: !anySelection, run: cmd.cmdDeselect },
        { label: 'Auswahl umkehren', disabled: !anySelection, run: cmd.cmdInvertSelection },
        menuSep(),
        { label: 'Gruppe erstellen', shortcut: MENU_SHORTCUTS.group, disabled: !anySelection, run: cmd.cmdGroup },
        {
          label: 'Komponente erstellen ...',
          shortcut: MENU_SHORTCUTS.makeComponent,
          disabled: !anySelection,
          run: () => act((s) => s.openDialog({ kind: 'makeComponent', defaults: { name: 'Komponente' } })),
        },
        { label: 'Aufloesen', shortcut: MENU_SHORTCUTS.explode, disabled: selectionEntities.length === 0, run: cmd.cmdExplode },
        menuSep(),
        { label: 'Verstecken', shortcut: MENU_SHORTCUTS.hide, disabled: !anySelection, run: cmd.cmdHide },
        { label: 'Alles einblenden', shortcut: MENU_SHORTCUTS.unhide, run: cmd.cmdUnhide },
        menuSep(),
        { label: 'Sperren', shortcut: MENU_SHORTCUTS.lock, disabled: selectionEntities.length === 0, run: () => cmd.cmdLock(true) },
        { label: 'Entsperren', shortcut: MENU_SHORTCUTS.unlock, disabled: selectionEntities.length === 0, run: () => cmd.cmdLock(false) },
      ],
    },
    {
      id: 'ansicht',
      label: 'Ansicht',
      entries: [
        {
          label: 'Flaechenstil',
          items: FACE_STYLES.map((entry) => ({
            label: entry.label,
            checked: style?.faceStyle === entry.value,
            radio: true,
            run: () => patchStyle({ faceStyle: entry.value }),
          })),
        },
        {
          label: 'Kantenoptionen',
          items: [
            { label: 'Kanten', checked: Boolean(style?.displayEdges), run: () => patchStyle({ displayEdges: !style?.displayEdges }) },
            { label: 'Profile', checked: Boolean(style?.displayProfiles), run: () => patchStyle({ displayProfiles: !style?.displayProfiles }) },
            {
              label: 'Verlaengerungen',
              checked: Boolean(style?.displayExtensions),
              run: () => patchStyle({ displayExtensions: !style?.displayExtensions }),
            },
            {
              label: 'Endpunkte',
              checked: Boolean(style?.displayEndpoints),
              run: () => patchStyle({ displayEndpoints: !style?.displayEndpoints }),
            },
            { label: 'Jitter', checked: Boolean(style?.jitterEdges), run: () => patchStyle({ jitterEdges: !style?.jitterEdges }) },
            {
              label: 'Tiefenhinweis',
              checked: Boolean(style?.displayDepthCue),
              run: () => patchStyle({ displayDepthCue: !style?.displayDepthCue }),
            },
          ],
        },
        menuSep(),
        { label: 'Achsen', checked: Boolean(style?.showAxes), run: () => patchStyle({ showAxes: !style?.showAxes }) },
        { label: 'Raster', checked: Boolean(style?.showGrid), run: () => patchStyle({ showGrid: !style?.showGrid }) },
        {
          /*
           * Bewusst getrennt von "Verdeckte Geometrie": Hilfslinien aus dem
           * Massband und dem Winkelmesser will man ausblenden, ohne dabei
           * versteckte Geometrie einzublenden.
           */
          label: 'Hilfslinien',
          checked: Boolean(style?.showGuides),
          run: () => patchStyle({ showGuides: !style?.showGuides }),
        },
        {
          label: 'Verdeckte Geometrie',
          checked: Boolean(style?.showHiddenGeometry),
          run: () => patchStyle({ showHiddenGeometry: !style?.showHiddenGeometry }),
        },
        menuSep(),
        {
          label: 'Schnittebenen anzeigen',
          checked: Boolean(style?.showSectionPlanes),
          run: () => patchStyle({ showSectionPlanes: !style?.showSectionPlanes }),
        },
        {
          label: 'Schnitte aktiv',
          checked: Boolean(style?.showSectionCuts),
          run: () => patchStyle({ showSectionCuts: !style?.showSectionCuts }),
        },
        menuSep(),
        { label: 'Schatten', checked: Boolean(sun?.enabled), run: () => act((s) => s.updateSun({ enabled: !sun?.enabled })) },
        { label: 'Nebel', checked: Boolean(fog?.enabled), run: () => act((s) => s.updateFog({ enabled: !fog?.enabled })) },
        menuSep(),
        {
          label: 'Animation',
          items: [
            { label: 'Szenen-Panel', run: () => props.openPanel('scenes') },
            { label: 'Diashow abspielen', disabled: (state.doc?.scenes?.length ?? 0) < 2, run: props.onPlaySlideshow },
          ],
        },
      ],
    },
    {
      id: 'kamera',
      label: 'Kamera',
      entries: [
        {
          label: 'Standardansichten',
          items: STANDARD_VIEWS.map((view) => ({
            label: view.label,
            run: () => cmd.cmdStandardView(view.value),
          })),
        },
        menuSep(),
        { label: 'Perspektive', checked: projection === 'perspective', radio: true, run: () => cmd.cmdSetProjection('perspective') },
        { label: 'Parallelprojektion', checked: projection === 'parallel', radio: true, run: () => cmd.cmdSetProjection('parallel') },
        { label: 'Zwei-Punkt-Perspektive', run: () => cmd.cmdTwoPointPerspective(true) },
        menuSep(),
        toolItem('orbit'),
        toolItem('pan'),
        toolItem('zoom'),
        toolItem('zoomWindow'),
        { label: 'Alles einpassen', shortcut: MENU_SHORTCUTS.zoomExtents, run: cmd.cmdZoomExtents },
        { label: 'Auswahl einpassen', shortcut: MENU_SHORTCUTS.zoomSelection, disabled: !anySelection, run: cmd.cmdZoomSelection },
        menuSep(),
        toolItem('position'),
        toolItem('walk'),
        toolItem('lookaround'),
      ],
    },
    {
      id: 'zeichnen',
      label: 'Zeichnen',
      entries: [
        ...DRAW_MENU_TOOLS.slice(0, 2).map(toolItem),
        menuSep(),
        ...DRAW_MENU_TOOLS.slice(2, 6).map(toolItem),
        menuSep(),
        ...DRAW_MENU_TOOLS.slice(6).map(toolItem),
      ],
    },
    {
      id: 'werkzeuge',
      label: 'Werkzeuge',
      entries: [
        ...TOOLS_MENU_TOOLS.slice(0, 4).map(toolItem),
        menuSep(),
        ...TOOLS_MENU_TOOLS.slice(4, 10).map(toolItem),
        menuSep(),
        ...TOOLS_MENU_TOOLS.slice(10).map(toolItem),
        menuSep(),
        { label: 'Schnittflaechen erzeugen', disabled: !anySelection, run: () => cmd.cmdIntersect('selection') },
        { label: 'Mit Modell verschneiden', run: () => cmd.cmdIntersect('model') },
      ],
    },
    {
      id: 'fenster',
      label: 'Fenster',
      entries: [
        { kind: 'title', label: 'Panels' },
        ...PANEL_ORDER.map((panelId) => ({
          label: PANEL_META[panelId].title,
          icon: PANEL_META[panelId].icon,
          checked: (state.ui?.openPanels ?? []).includes(panelId),
          run: () => act((s) => s.togglePanel(panelId)),
        })),
        menuSep(),
        {
          label: 'Tray anzeigen',
          shortcut: MENU_SHORTCUTS.toggleTray,
          checked: state.ui?.trayVisible !== false,
          run: () => act((s) => s.setTrayVisible(!(s.ui?.trayVisible !== false))),
        },
        menuSep(),
        {
          label: 'Darstellung',
          items: [
            { label: 'Dunkel', checked: state.ui?.theme !== 'light', radio: true, run: () => act((s) => s.setTheme('dark')) },
            { label: 'Hell', checked: state.ui?.theme === 'light', radio: true, run: () => act((s) => s.setTheme('light')) },
          ],
        },
        { label: 'Einstellungen ...', run: () => act((s) => s.openDialog({ kind: 'preferences', tab: 'general' })) },
      ],
    },
    {
      id: 'hilfe',
      label: 'Hilfe',
      entries: [
        { label: 'Tastaturkuerzel ...', shortcut: MENU_SHORTCUTS.shortcutHelp, run: props.onShowShortcuts },
        { label: 'Kurzanleitung ...', run: props.onShowQuickstart },
        { label: 'Instructor anzeigen', run: () => props.openPanel('instructor') },
        menuSep(),
        { label: 'Ueber OpenSketch Studio ...', run: () => act((s) => s.openDialog({ kind: 'about' })) },
      ],
    },
  ]

  return (
    <div
      ref={barRef}
      className={clsx('relative z-40 flex h-8 shrink-0 items-center gap-0.5 border-b px-1.5', skin.chrome, skin.border)}
      role="menubar"
      aria-label="Hauptmenue"
    >
      <span className={clsx('mr-2 flex select-none items-center gap-1.5 pl-1 text-[12px] font-semibold', skin.text)}>
        <Boxes size={15} strokeWidth={1.8} className="text-accent-400" />
        OpenSketch
      </span>

      {menus.map((menu) => (
        <div key={menu.id} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === menu.id}
            onClick={() => setOpen(open === menu.id ? null : menu.id)}
            onMouseEnter={() => open !== null && setOpen(menu.id)}
            className={clsx(
              'h-6 rounded px-2 text-[12px] transition-colors',
              open === menu.id ? clsx(skin.surface, skin.text) : clsx(skin.muted, skin.hover),
              skin.ring,
            )}
          >
            {menu.label}
          </button>
          {open === menu.id ? (
            <div className="absolute left-0 top-full z-50 pt-0.5">
              <MenuList entries={menu.entries} onClose={() => setOpen(null)} />
            </div>
          ) : null}
        </div>
      ))}

      <div className="flex-1" />

      <span className={clsx('select-none truncate pr-1 text-[11px]', skin.dim)}>
        {state.doc?.meta?.name || 'Unbenannt'}
        {state.dirty ? ' *' : ''}
      </span>
    </div>
  )
}
