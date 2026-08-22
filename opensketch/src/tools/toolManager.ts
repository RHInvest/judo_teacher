/**
 * Werkzeugmanager.
 *
 * Er ist die einzige Stelle, an der Eingaben auf Werkzeuge treffen:
 *
 *  - haelt genau ein aktives Werkzeug, wechselt sauber (deactivate/activate)
 *  - setzt Cursor, Statustext und Massfeld beim Wechsel
 *  - TRANSIENTE Kamerawerkzeuge: mittlere Maustaste = Orbit,
 *    Mittel+Umschalt = Schwenken, Mausrad = Zoom, Leertaste halten = Orbit -
 *    in JEDEM Werkzeug, ohne es zu verlassen
 *  - Tastenkuerzel (`TOOL_SHORTCUTS`), Undo/Redo, Entfernen, Gruppieren
 *  - Esc bricht die laufende Operation ab, zweimal Esc leert die Auswahl
 *    bzw. verlaesst den Kontext
 *
 * Kein Werkzeugfehler darf die Anwendung abstuerzen lassen: jeder Aufruf ins
 * Werkzeug laeuft durch `guard()`, das im Fehlerfall die offene Operation
 * abbricht und das Werkzeug zuruecksetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { StoreHandle, Tool, ToolContext, ToolManagerApi, ViewportApi } from '@/shared/store-api'
import type { Cursor, KeyInfo, PointerInfo, ToolId } from '@/shared/types'
import { bus } from '@/shared/events'
import { safeOrNull, stateOf } from './helpers'
import { PlaceholderTool } from './placeholder'

import { SelectTool } from './select'
import { LassoTool } from './lasso'
import { LineTool } from './line'
import { FreehandTool } from './freehand'
import { RectangleTool } from './rectangle'
import { RotatedRectangleTool } from './rotatedRectangle'
import { CircleTool } from './circle'
import { PolygonTool } from './polygon'
import { ArcTool } from './arc'
import { Arc2Tool } from './arc2'
import { Arc3Tool } from './arc3'
import { PieTool } from './pie'
import { BezierTool } from './bezier'
import { MoveTool } from './move'
import { RotateTool } from './rotate'
import { ScaleTool } from './scale'
import { PushPullTool } from './pushpull'
import { FollowMeTool } from './followme'
import { OffsetTool } from './offset'
import { EraserTool } from './eraser'
import { PaintTool } from './paint'
import { TapeTool } from './tape'
import { ProtractorTool } from './protractor'
import { AxesTool } from './axes'
import { DimensionTool } from './dimension'
import { TextTool } from './text'
import { Text3dTool } from './text3d'
import { SectionPlaneTool } from './sectionPlane'
import {
  LookAroundTool,
  OrbitTool,
  PanTool,
  PositionCameraTool,
  WalkTool,
  ZoomTool,
  ZoomWindowTool,
} from './camera'

/* ------------------------------------------------------------------ */
/* Kuerzeltabelle                                                      */
/* ------------------------------------------------------------------ */

/**
 * Anzeigekuerzel -> Werkzeug. Die Schreibweise ist die der Oberflaeche
 * (`src/ui/lib/shortcuts.ts` liest genau diese Tabelle), damit Menue,
 * Kurzinfo und Manager nie auseinanderlaufen.
 */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  Leertaste: 'select',
  'Umschalt+Leertaste': 'lasso',
  E: 'eraser',
  B: 'paint',

  L: 'line',
  'Umschalt+F': 'freehand',
  R: 'rectangle',
  'Umschalt+R': 'rotatedRectangle',
  C: 'circle',
  'Umschalt+C': 'polygon',
  A: 'arc2',
  'Umschalt+A': 'arc3',
  'Alt+A': 'arc',
  'Alt+Umschalt+A': 'pie',
  'Umschalt+B': 'bezier',

  M: 'move',
  Q: 'rotate',
  S: 'scale',
  P: 'pushpull',
  U: 'followme',
  F: 'offset',

  T: 'tape',
  D: 'protractor',
  Y: 'axes',
  'Umschalt+D': 'dimension',
  X: 'text',
  'Umschalt+X': 'text3d',
  'Umschalt+S': 'sectionPlane',

  O: 'orbit',
  H: 'pan',
  Z: 'zoom',
  'Umschalt+Z': 'zoomWindow',
  'Umschalt+P': 'position',
  W: 'walk',
  'Umschalt+L': 'lookaround',
}

interface ParsedCombo {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  tool: ToolId
}

const KEY_ALIASES: Record<string, string> = {
  LEERTASTE: ' ',
  ENTF: 'DELETE',
  ESC: 'ESCAPE',
}

function parseShortcuts(table: Record<string, ToolId>): ParsedCombo[] {
  const out: ParsedCombo[] = []
  for (const [display, tool] of Object.entries(table)) {
    let key = ''
    let ctrl = false
    let shift = false
    let alt = false
    for (const raw of display.split('+')) {
      const part = raw.trim().toUpperCase()
      if (part === 'STRG' || part === 'CTRL') ctrl = true
      else if (part === 'UMSCHALT' || part === 'SHIFT') shift = true
      else if (part === 'ALT') alt = true
      else key = KEY_ALIASES[part] ?? part
    }
    if (key) out.push({ key, ctrl, shift, alt, tool })
  }
  return out
}

const PARSED_SHORTCUTS = parseShortcuts(TOOL_SHORTCUTS)

function normalizeKey(e: KeyInfo): string {
  if (e.key === ' ' || e.code === 'Space') return ' '
  return e.key.toUpperCase()
}

/** Kuerzelsuche; die Leertaste wird gesondert behandelt (transienter Orbit). */
export function toolForKey(e: KeyInfo): ToolId | null {
  const key = normalizeKey(e)
  if (key === ' ') return null
  for (const combo of PARSED_SHORTCUTS) {
    if (combo.key !== key) continue
    if (combo.ctrl !== (e.ctrl || e.meta)) continue
    if (combo.shift !== e.shift) continue
    if (combo.alt !== e.alt) continue
    return combo.tool
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Werkzeugverzeichnis                                                 */
/* ------------------------------------------------------------------ */

type ToolFactory = () => Tool

/**
 * Anzeigename je Werkzeug.
 *
 * Der Typ `Record<ToolId, string>` ist die eigentliche Absicherung: kommt im
 * Contract eine ToolId dazu, schlaegt hier der Typcheck fehl. Daraus leitet
 * sich auch `ALL_TOOL_IDS` ab - eine Liste, die nicht veralten kann.
 */
export const TOOL_NAMES: Record<ToolId, string> = {
  select: 'Auswahl',
  lasso: 'Lasso',
  eraser: 'Radiergummi',
  paint: 'Material',
  line: 'Linie',
  freehand: 'Freihand',
  rectangle: 'Rechteck',
  rotatedRectangle: 'Gedrehtes Rechteck',
  circle: 'Kreis',
  polygon: 'Polygon',
  arc2: '2-Punkt-Bogen',
  arc3: '3-Punkt-Bogen',
  arc: 'Bogen',
  pie: 'Tortenstück',
  bezier: 'Bezier',
  move: 'Verschieben',
  rotate: 'Drehen',
  scale: 'Skalieren',
  pushpull: 'Drücken/Ziehen',
  followme: 'Folge mir',
  offset: 'Versatz',
  tape: 'Maßband',
  protractor: 'Winkelmesser',
  axes: 'Achsen',
  dimension: 'Bemaßung',
  text: 'Text',
  text3d: '3D-Text',
  sectionPlane: 'Schnittebene',
  orbit: 'Orbit',
  pan: 'Schwenken',
  zoom: 'Zoom',
  zoomWindow: 'Zoomfenster',
  position: 'Kamera positionieren',
  walk: 'Gehen',
  lookaround: 'Umsehen',
}

/** Jede ToolId muss hier stehen - sonst entsteht ein `PlaceholderTool`. */
export const TOOL_FACTORIES: Partial<Record<ToolId, ToolFactory>> = {
  select: () => new SelectTool(),
  lasso: () => new LassoTool(),
  eraser: () => new EraserTool(),
  paint: () => new PaintTool(),

  line: () => new LineTool(),
  freehand: () => new FreehandTool(),
  rectangle: () => new RectangleTool(),
  rotatedRectangle: () => new RotatedRectangleTool(),
  circle: () => new CircleTool(),
  polygon: () => new PolygonTool(),
  arc2: () => new Arc2Tool(),
  arc3: () => new Arc3Tool(),
  arc: () => new ArcTool(),
  pie: () => new PieTool(),
  bezier: () => new BezierTool(),

  move: () => new MoveTool(),
  rotate: () => new RotateTool(),
  scale: () => new ScaleTool(),
  pushpull: () => new PushPullTool(),
  followme: () => new FollowMeTool(),
  offset: () => new OffsetTool(),

  tape: () => new TapeTool(),
  protractor: () => new ProtractorTool(),
  axes: () => new AxesTool(),
  dimension: () => new DimensionTool(),
  text: () => new TextTool(),
  text3d: () => new Text3dTool(),
  sectionPlane: () => new SectionPlaneTool(),

  orbit: () => new OrbitTool(),
  pan: () => new PanTool(),
  zoom: () => new ZoomTool(),
  zoomWindow: () => new ZoomWindowTool(),
  position: () => new PositionCameraTool(),
  walk: () => new WalkTool(),
  lookaround: () => new LookAroundTool(),
}

/** Alle Werkzeugkennungen, aus dem Contract abgeleitet. */
export const ALL_TOOL_IDS = Object.keys(TOOL_NAMES) as ToolId[]

/** Werkzeuge, die das Mausrad selbst auswerten. */
const HANDLES_WHEEL: ReadonlySet<ToolId> = new Set<ToolId>(['zoom', 'walk'])

/** Doppel-Esc innerhalb dieser Zeit leert die Auswahl / verlaesst den Kontext. */
const DOUBLE_ESCAPE_MS = 900
/** Kuerzer gedrueckte Leertaste gilt als Tippen (= Auswahlwerkzeug). */
const SPACE_TAP_MS = 200

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

export interface ToolManagerDeps {
  store: StoreHandle
  viewport: ViewportApi
  inference: import('@/shared/store-api').InferenceApi
}

export class ToolManager implements ToolManagerApi {
  private readonly tools = new Map<ToolId, Tool>()
  private readonly ctx: ToolContext

  /** Werkzeug, zu dem nach einem transienten Kamerawerkzeug zurueckgekehrt wird. */
  private baseId: ToolId = 'select'
  private currentId: ToolId = 'select'
  private current: Tool | null = null
  private transientStack: ToolId[] = []

  private middleButtonTransient = false
  private spaceDownAt = 0
  private spaceTransient = false
  private lastEscape = 0
  private disposed = false
  private unsubscribe: (() => void) | null = null

  constructor(private readonly deps: ToolManagerDeps) {
    this.ctx = {
      store: deps.store,
      viewport: deps.viewport,
      overlay: deps.viewport.overlay,
      inference: deps.inference,
      setStatus: (hint, modifiers) => this.setStatus(hint, modifiers),
      setVcb: (label, value, placeholder) => this.setVcb(label, value, placeholder),
      setCursor: (cursor) => this.setCursor(cursor),
      finish: () => this.setTool('select'),
    }

    const initial = safeOrNull(() => deps.store.getState().activeTool) ?? 'select'
    this.setTool(initial)
    this.watchStore()
  }

  /* ================================================================ */
  /* Werkzeugwechsel                                                  */
  /* ================================================================ */

  setTool(id: ToolId): void {
    if (this.disposed) return
    this.transientStack = []
    this.middleButtonTransient = false
    this.spaceTransient = false
    this.baseId = id
    this.activate(id)
    const state = stateOf(this.deps.store)
    if (state && state.activeTool !== id) {
      try {
        state.setActiveTool(id)
      } catch (err) {
        console.warn('[tools] Werkzeugwechsel im Store fehlgeschlagen', err)
      }
    }
    try {
      bus.emit('tool:changed', { id })
    } catch {
      /* Bus nicht bereit */
    }
  }

  getTool(): Tool | null {
    return this.current
  }

  getToolId(): ToolId {
    return this.currentId
  }

  /**
   * true, wenn das aktive Werkzeug gerade rohen Text erwartet.
   *
   * `ViewportHost` leitet Ziffern, Komma und Anfuehrungszeichen sonst ans
   * Massfeld um, sobald sie gedrueckt werden - mitten in einer Beschriftung
   * zerreisst das die Eingabe ("Raum 12"). Das Flag gilt nur waehrend der
   * Texteingabe, nicht fuer das ganze Werkzeug: vor dem ersten Klick soll man
   * im Textwerkzeug weiterhin Masse eintippen koennen.
   *
   * Bei einem transienten Kamerawerkzeug (mittlere Maustaste, Leertaste)
   * zaehlt das Werkzeug DARUNTER - der Orbit erwartet nie Text, die
   * angefangene Beschriftung darf aber nicht verloren gehen.
   */
  wantsTextInput(): boolean {
    if (this.disposed) return false
    if (this.current?.wantsTextInput === true) return true
    if (this.transientStack.length === 0) return false
    const beneath = this.tools.get(this.transientStack[0])
    return beneath?.wantsTextInput === true
  }

  pushTransient(id: ToolId): void {
    if (this.disposed) return
    if (this.currentId === id) return
    this.transientStack.push(this.currentId)
    this.activate(id)
  }

  popTransient(): void {
    if (this.disposed) return
    const previous = this.transientStack.pop()
    this.activate(previous ?? this.baseId)
  }

  /** Wechselt das aktive Werkzeug, ohne den Store oder den Basiszustand anzufassen. */
  private activate(id: ToolId): void {
    if (this.current && this.currentId === id) return
    if (this.current) {
      const old = this.current
      this.current = null
      try {
        old.deactivate()
      } catch (err) {
        console.warn(`[tools] ${old.id}: deactivate fehlgeschlagen`, err)
      }
    }
    const tool = this.instantiate(id)
    this.currentId = id
    this.current = tool
    try {
      tool.activate(this.ctx)
    } catch (err) {
      console.warn(`[tools] ${id}: activate fehlgeschlagen`, err)
    }
    this.setCursor(tool.cursor)
    this.setStatus(tool.hint)
  }

  private instantiate(id: ToolId): Tool {
    const existing = this.tools.get(id)
    if (existing) return existing
    const factory = TOOL_FACTORIES[id]
    let tool: Tool
    try {
      tool = factory ? factory() : new PlaceholderTool(id, TOOL_NAMES[id] ?? id)
    } catch (err) {
      console.warn(`[tools] ${id} konnte nicht erzeugt werden`, err)
      tool = new PlaceholderTool(id, TOOL_NAMES[id] ?? id)
    }
    this.tools.set(id, tool)
    return tool
  }

  /* ================================================================ */
  /* Zeigerereignisse                                                 */
  /* ================================================================ */

  handlePointerDown(e: PointerInfo): void {
    if (e.button === 1) {
      // Mittlere Maustaste: transienter Orbit, mit Umschalt Schwenken.
      this.middleButtonTransient = true
      this.pushTransient(e.shift ? 'pan' : 'orbit')
      this.guard('onPointerDown', (tool) => tool.onPointerDown(e))
      return
    }
    if (e.button === 2) return
    this.guard('onPointerDown', (tool) => tool.onPointerDown(e))
  }

  handlePointerMove(e: PointerInfo): void {
    this.guard('onPointerMove', (tool) => tool.onPointerMove(e))
  }

  handlePointerUp(e: PointerInfo): void {
    if (e.button === 1 && this.middleButtonTransient) {
      this.guard('onPointerUp', (tool) => tool.onPointerUp(e))
      this.middleButtonTransient = false
      this.popTransient()
      return
    }
    if (e.button === 2) return
    this.guard('onPointerUp', (tool) => tool.onPointerUp(e))
  }

  handleDoubleClick(e: PointerInfo): void {
    this.guard('onDoubleClick', (tool) => tool.onDoubleClick?.(e))
  }

  handleWheel(e: PointerInfo): void {
    if (HANDLES_WHEEL.has(this.currentId)) {
      this.guard('onWheel', (tool) => tool.onWheel?.(e))
      return
    }
    // Transienter Zoom: das Mausrad zoomt in jedem Werkzeug.
    const delta = e.delta ?? 0
    if (delta === 0) return
    try {
      this.deps.viewport.dolly(delta > 0 ? -0.18 : 0.18, { x: e.x, y: e.y })
      this.deps.viewport.requestRender()
    } catch (err) {
      console.warn('[tools] Zoom per Mausrad fehlgeschlagen', err)
    }
  }

  /* ================================================================ */
  /* Tastatur                                                         */
  /* ================================================================ */

  handleKeyDown(e: KeyInfo): boolean {
    if (this.disposed) return false

    if (e.key === 'Escape') {
      this.handleEscape()
      return true
    }

    const key = normalizeKey(e)

    // Leertaste: halten = transienter Orbit, tippen = Auswahlwerkzeug.
    if (key === ' ' && !e.ctrl && !e.meta && !e.alt) {
      if (e.repeat) return true
      this.spaceDownAt = Date.now()
      if (!this.spaceTransient) {
        this.spaceTransient = true
        this.pushTransient('orbit')
      }
      return true
    }

    if (e.ctrl || e.meta) {
      if (this.handleCommandKey(e, key)) return true
    }

    /*
     * Das aktive Werkzeug hat Vorrang (Pfeiltasten, eigene Modifikatoren) -
     * und zwar VOR dem Loeschen. Sonst kann ein Werkzeug, das gerade Text
     * entgegennimmt, die Ruecktaste nie sehen: sie wuerde stattdessen die
     * Auswahl loeschen, waehrend der Nutzer einen Tippfehler ausbessern will.
     * Werkzeuge, die nichts mit der Taste anfangen, geben false zurueck.
     */
    if (this.guard('onKeyDown', (tool) => tool.onKeyDown(e)) === true) return true

    if ((key === 'DELETE' || key === 'BACKSPACE') && !e.ctrl && !e.meta) {
      this.deleteSelection()
      return true
    }

    if (!e.ctrl && !e.meta) {
      if (key === 'G') {
        this.makeGroup()
        return true
      }
      const tool = toolForKey(e)
      if (tool) {
        this.setTool(tool)
        return true
      }
    }
    return false
  }

  handleKeyUp(e: KeyInfo): boolean {
    if (this.disposed) return false
    const key = normalizeKey(e)
    if (key === ' ') {
      const held = Date.now() - this.spaceDownAt
      if (this.spaceTransient) {
        this.spaceTransient = false
        this.popTransient()
      }
      if (held < SPACE_TAP_MS) this.setTool('select')
      return true
    }
    return this.guard('onKeyUp', (tool) => tool.onKeyUp(e)) === true
  }

  handleValueEntry(text: string): boolean {
    const handled = this.guard('onValueEntry', (tool) => tool.onValueEntry(text))
    if (handled !== true) return false
    try {
      this.deps.viewport.requestRender()
    } catch {
      /* Renderer nicht bereit */
    }
    return true
  }

  /* ================================================================ */
  /* Zeichnen und Aufraeumen                                          */
  /* ================================================================ */

  draw(): void {
    const tool = this.current
    if (!tool) return
    try {
      tool.draw(this.deps.viewport.overlay)
    } catch (err) {
      console.warn(`[tools] ${tool.id}: Overlay fehlgeschlagen`, err)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.unsubscribe) {
      try {
        this.unsubscribe()
      } catch {
        /* Abo war nie aktiv */
      }
      this.unsubscribe = null
    }
    const tool = this.current
    this.current = null
    if (tool) {
      try {
        tool.deactivate()
      } catch {
        /* egal, wir raeumen ohnehin ab */
      }
    }
    this.tools.clear()
  }

  /* ================================================================ */
  /* Intern                                                           */
  /* ================================================================ */

  /**
   * Ruft eine Werkzeugmethode auf. Wirft sie, wird die Operation abgebrochen
   * und das Werkzeug zurueckgesetzt - die Anwendung laeuft weiter.
   */
  private guard<T>(what: string, fn: (tool: Tool) => T): T | undefined {
    const tool = this.current
    if (!tool) return undefined
    try {
      return fn(tool)
    } catch (err) {
      console.error(`[tools] ${tool.id}: ${what} fehlgeschlagen`, err)
      const state = stateOf(this.deps.store)
      try {
        state?.abortOperation()
      } catch {
        /* keine Operation offen */
      }
      try {
        tool.cancel()
      } catch {
        /* auch das Zuruecksetzen darf nicht abstuerzen */
      }
      try {
        state?.toast(`${tool.name}: Aktion abgebrochen`, 'error')
      } catch {
        /* UI nicht bereit */
      }
      return undefined
    }
  }

  private handleEscape(): void {
    const now = Date.now()
    const second = now - this.lastEscape < DOUBLE_ESCAPE_MS
    this.lastEscape = now

    this.guard('cancel', (tool) => tool.cancel())
    try {
      this.deps.inference.clearLock()
    } catch {
      /* Inferenz nicht bereit */
    }
    if (!second) return

    const state = stateOf(this.deps.store)
    if (!state) return
    const sel = state.selection
    const hasSelection =
      !!sel && (sel.edgeIds.length + sel.faceIds.length + sel.vertexIds.length + sel.entityIds.length) > 0
    try {
      if (hasSelection) state.clearSelection()
      else state.exitContext()
    } catch (err) {
      console.warn('[tools] Esc konnte nicht ausgeführt werden', err)
    }
  }

  private handleCommandKey(e: KeyInfo, key: string): boolean {
    const state = stateOf(this.deps.store)
    if (!state) return false
    try {
      if (key === 'Z' && !e.shift) {
        state.undo()
        return true
      }
      if (key === 'Y' || (key === 'Z' && e.shift)) {
        state.redo()
        return true
      }
      if (key === 'G' && !e.shift) {
        this.makeGroup()
        return true
      }
    } catch (err) {
      console.warn('[tools] Befehl fehlgeschlagen', err)
    }
    return false
  }

  private deleteSelection(): void {
    const state = stateOf(this.deps.store)
    if (!state) return
    const sel = state.selection
    if (!sel) return
    const count = sel.edgeIds.length + sel.faceIds.length + sel.vertexIds.length + sel.entityIds.length
    if (count === 0) return
    try {
      state.operation('Löschen', () => {
        state.deletePrimitives({
          edgeIds: [...sel.edgeIds],
          faceIds: [...sel.faceIds],
          vertexIds: [...sel.vertexIds],
          entityIds: [...sel.entityIds],
        })
        state.clearSelection()
      })
    } catch (err) {
      console.warn('[tools] Löschen fehlgeschlagen', err)
      try {
        state.abortOperation()
      } catch {
        /* keine Operation offen */
      }
    }
  }

  private makeGroup(): void {
    const state = stateOf(this.deps.store)
    if (!state) return
    const sel = state.selection
    const count = sel ? sel.edgeIds.length + sel.faceIds.length + sel.vertexIds.length + sel.entityIds.length : 0
    if (count === 0) {
      try {
        state.toast('Nichts ausgewählt - keine Gruppe erstellt', 'warn')
      } catch {
        /* UI nicht bereit */
      }
      return
    }
    try {
      const id = state.operation('Gruppe erstellen', () => state.makeGroup())
      if (id) state.toast('Gruppe erstellt', 'success')
    } catch (err) {
      console.warn('[tools] Gruppieren fehlgeschlagen', err)
      try {
        state.abortOperation()
      } catch {
        /* keine Operation offen */
      }
    }
  }

  /** Aussen (Menue, Werkzeugkasten) gesetzte Werkzeuge uebernehmen. */
  private watchStore(): void {
    this.unsubscribe = safeOrNull(() =>
      this.deps.store.subscribe((state, prev) => {
        if (this.disposed) return
        if (state.activeTool === prev.activeTool) return
        if (state.activeTool === this.baseId) return
        this.setTool(state.activeTool)
      }),
    )
  }

  private setStatus(hint: string, modifiers?: string): void {
    const state = stateOf(this.deps.store)
    try {
      state?.setStatus(hint, modifiers ?? '')
    } catch {
      /* UI nicht bereit */
    }
  }

  private setVcb(label: string, value: string, placeholder?: string): void {
    const state = stateOf(this.deps.store)
    try {
      state?.setVcb({ vcbLabel: label, vcbValue: value, vcbPlaceholder: placeholder ?? '' })
    } catch {
      /* UI nicht bereit */
    }
  }

  private setCursor(cursor: Cursor): void {
    try {
      this.deps.viewport.setCursor(cursor)
    } catch {
      /* Renderer nicht bereit */
    }
  }
}
