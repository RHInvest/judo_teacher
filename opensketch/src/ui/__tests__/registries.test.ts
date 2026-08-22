/**
 * Vollstaendigkeit der Oberflaechen-Registries.
 *
 * Jede Aufzaehlung aus den Contracts (`ToolId`, `PanelId`, `DialogState`) muss
 * in der Oberflaeche ein Gegenstueck haben: einen Knopf, ein Panel, einen
 * Dialog. Genau hier entstehen beim Bauen die Luecken - ein Werkzeug kommt in
 * den Contract, aber nie in die Werkzeugleiste, und niemand merkt es, weil
 * nichts abstuerzt.
 *
 * Die drei `EXPECTED_*`-Listen sind bewusst ausgeschrieben statt aus der
 * Oberflaeche abgeleitet: sie sind eine zweite, unabhaengige Fassung
 * derselben Aufzaehlung. Der `Record<X, true>`-Typ laesst den Compiler beide
 * gegeneinander pruefen - fehlt ein Eintrag, ist es ein Typfehler; steht einer
 * zu viel darin, auch. Ein Vergleich der Oberflaeche mit sich selbst wuerde
 * dagegen immer gruen sein.
 */

import { describe, expect, it } from 'vitest'
import type { DialogState, PanelId } from '@/shared/store-api'
import type { ToolId } from '@/shared/types'
import { TOOL_SHORTCUTS } from '@/tools'
import { DIALOG_KINDS, DIALOG_RENDERERS, LOCAL_DIALOG_KINDS, LOCAL_DIALOG_RENDERERS } from '@/ui/dialogs'
import { PANEL_COMPONENTS } from '@/ui/panels/registry'
import { PANEL_META, PANEL_ORDER } from '@/ui/panels/meta'
import { ALL_TOOL_IDS, DRAW_MENU_TOOLS, TOOLBAR_GROUPS, TOOLS_MENU_TOOLS, TOOL_META } from '@/ui/lib/tools'
import { TOOL_INSTRUCTIONS, instructionFor } from '@/ui/lib/instructor'
import { findSubstituteSpellings, spellingHint } from './spelling'

/* ------------------------------------------------------------------ */
/* Unabhaengige Fassung der Contract-Aufzaehlungen                      */
/* ------------------------------------------------------------------ */

const EXPECTED_TOOLS: Record<ToolId, true> = {
  select: true,
  lasso: true,
  eraser: true,
  paint: true,
  line: true,
  freehand: true,
  rectangle: true,
  rotatedRectangle: true,
  circle: true,
  polygon: true,
  arc2: true,
  arc3: true,
  arc: true,
  pie: true,
  bezier: true,
  move: true,
  rotate: true,
  scale: true,
  pushpull: true,
  followme: true,
  offset: true,
  tape: true,
  protractor: true,
  axes: true,
  dimension: true,
  text: true,
  text3d: true,
  sectionPlane: true,
  orbit: true,
  pan: true,
  zoom: true,
  zoomWindow: true,
  position: true,
  walk: true,
  lookaround: true,
}

const EXPECTED_PANELS: Record<PanelId, true> = {
  entityInfo: true,
  materials: true,
  components: true,
  tags: true,
  outliner: true,
  styles: true,
  scenes: true,
  shadows: true,
  fog: true,
  softenEdges: true,
  instructor: true,
  modelInfo: true,
}

const EXPECTED_DIALOGS: Record<DialogState['kind'], true> = {
  modelInfo: true,
  preferences: true,
  makeComponent: true,
  exportModel: true,
  importModel: true,
  exportImage: true,
  text3d: true,
  softenEdges: true,
  about: true,
  openFile: true,
  confirm: true,
}

const ALL_TOOLS = Object.keys(EXPECTED_TOOLS) as ToolId[]
const ALL_PANELS = Object.keys(EXPECTED_PANELS) as PanelId[]
const ALL_DIALOGS = Object.keys(EXPECTED_DIALOGS) as DialogState['kind'][]

/** Alle Werkzeuge, die irgendwo in der Werkzeugleiste erreichbar sind. */
function toolbarTools(): ToolId[] {
  const out: ToolId[] = []
  for (const group of TOOLBAR_GROUPS) {
    for (const entry of group.entries) {
      if (entry.kind === 'tool') out.push(entry.id)
      else out.push(...entry.tools)
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Werkzeuge                                                           */
/* ------------------------------------------------------------------ */

describe('Werkzeug-Registry', () => {
  it('kennt zu jeder ToolId Metadaten', () => {
    for (const id of ALL_TOOLS) {
      expect(TOOL_META[id], `TOOL_META fehlt für "${id}"`).toBeDefined()
    }
    expect(Object.keys(TOOL_META).sort()).toEqual([...ALL_TOOLS].sort())
  })

  it('hält id und Schluessel in TOOL_META deckungsgleich', () => {
    for (const [key, meta] of Object.entries(TOOL_META)) {
      expect(meta.id, `TOOL_META["${key}"].id`).toBe(key)
    }
  })

  it('gibt jedem Werkzeug Name, Symbol und Hinweis auf Deutsch', () => {
    for (const id of ALL_TOOLS) {
      const meta = TOOL_META[id]
      expect(meta.name.trim().length, `Name für "${id}"`).toBeGreaterThan(0)
      expect(meta.hint.trim().length, `Hinweis für "${id}"`).toBeGreaterThan(0)
      expect(meta.icon, `Symbol für "${id}"`).toBeTruthy()
    }
  })

  it('schreibt Werkzeugnamen und Hinweise mit echten Umlauten', () => {
    // Sichtbare Texte tragen Umlaute und Eszett. Ersatzschreibungen wie
    // "Auswaehlen" oder "Flaechen" standen frueher neben den korrekt
    // geschriebenen Bibliothekstexten aus @/io im selben Fenster.
    for (const id of ALL_TOOLS) {
      const meta = TOOL_META[id]
      expect(findSubstituteSpellings(meta.name), `Name für "${id}": ${spellingHint(meta.name)}`).toEqual([])
      expect(findSubstituteSpellings(meta.hint), `Hinweis für "${id}": ${spellingHint(meta.hint)}`).toEqual([])
    }
  })

  it('macht jedes Werkzeug in der Werkzeugleiste erreichbar', () => {
    const inToolbar = toolbarTools()
    for (const id of ALL_TOOLS) {
      expect(inToolbar, `Kein Knopf in der Werkzeugleiste für "${id}"`).toContain(id)
    }
  })

  it('zeigt kein Werkzeug doppelt in der Werkzeugleiste', () => {
    const inToolbar = toolbarTools()
    expect(new Set(inToolbar).size).toBe(inToolbar.length)
  })

  it('kennt in der Werkzeugleiste nur echte Werkzeuge', () => {
    for (const id of toolbarTools()) {
      expect(ALL_TOOLS, `"${id}" ist keine ToolId`).toContain(id)
    }
  })

  it('hält ALL_TOOL_IDS deckungsgleich mit TOOL_META', () => {
    expect([...ALL_TOOL_IDS].sort()).toEqual([...ALL_TOOLS].sort())
  })

  it('fuellt beide Werkzeugmenues nur mit echten Werkzeugen', () => {
    for (const id of [...DRAW_MENU_TOOLS, ...TOOLS_MENU_TOOLS]) {
      expect(ALL_TOOLS, `Menueeintrag "${id}" ist keine ToolId`).toContain(id)
    }
    expect(new Set(DRAW_MENU_TOOLS).size).toBe(DRAW_MENU_TOOLS.length)
    expect(new Set(TOOLS_MENU_TOOLS).size).toBe(TOOLS_MENU_TOOLS.length)
  })

  it('bietet jedes Werkzeug ausser den Kamerawerkzeugen in einem Menue an', () => {
    const cameraOnly: ToolId[] = ['orbit', 'pan', 'zoom', 'zoomWindow', 'position', 'walk', 'lookaround']
    const inMenus = new Set<ToolId>([...DRAW_MENU_TOOLS, ...TOOLS_MENU_TOOLS])
    for (const id of ALL_TOOLS) {
      if (cameraOnly.includes(id)) continue
      expect(inMenus.has(id), `"${id}" fehlt in Zeichnen- und Werkzeugmenue`).toBe(true)
    }
  })

  it('vergibt eindeutige Gruppen- und Eintragsschluessel in der Werkzeugleiste', () => {
    const groupIds = TOOLBAR_GROUPS.map((group) => group.id)
    expect(new Set(groupIds).size).toBe(groupIds.length)
    for (const group of TOOLBAR_GROUPS) {
      const entryIds = group.entries.map((entry) => entry.id)
      expect(new Set(entryIds).size, `Gruppe "${group.id}"`).toBe(entryIds.length)
      expect(group.label.trim().length, `Gruppe "${group.id}" ohne Beschriftung`).toBeGreaterThan(0)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

describe('Panel-Registry', () => {
  it('hat zu jeder PanelId eine Komponente', () => {
    for (const id of ALL_PANELS) {
      expect(PANEL_COMPONENTS[id], `Kein Panel für "${id}"`).toBeTypeOf('function')
    }
    expect(Object.keys(PANEL_COMPONENTS).sort()).toEqual([...ALL_PANELS].sort())
  })

  it('hat zu jeder PanelId Metadaten', () => {
    expect(Object.keys(PANEL_META).sort()).toEqual([...ALL_PANELS].sort())
    for (const id of ALL_PANELS) {
      const meta = PANEL_META[id]
      expect(meta.id, `PANEL_META["${id}"].id`).toBe(id)
      expect(meta.title.trim().length, `Titel für "${id}"`).toBeGreaterThan(0)
      expect(meta.description.trim().length, `Beschreibung für "${id}"`).toBeGreaterThan(0)
      expect(meta.icon, `Symbol für "${id}"`).toBeTruthy()
      expect(findSubstituteSpellings(meta.title), `Titel für "${id}": ${spellingHint(meta.title)}`).toEqual([])
      expect(
        findSubstituteSpellings(meta.description),
        `Beschreibung für "${id}": ${spellingHint(meta.description)}`,
      ).toEqual([])
    }
  })

  it('listet jedes Panel genau einmal in der Tray-Reihenfolge', () => {
    expect([...PANEL_ORDER].sort()).toEqual([...ALL_PANELS].sort())
    expect(new Set(PANEL_ORDER).size).toBe(PANEL_ORDER.length)
  })

  it('vergibt keine zwei Panels denselben Titel', () => {
    const titles = ALL_PANELS.map((id) => PANEL_META[id].title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})

/* ------------------------------------------------------------------ */
/* Dialoge                                                             */
/* ------------------------------------------------------------------ */

describe('Dialog-Registry', () => {
  it('hat zu jeder DialogState-Variante einen Dialog', () => {
    for (const kind of ALL_DIALOGS) {
      expect(DIALOG_RENDERERS[kind], `Kein Dialog für "${kind}"`).toBeTypeOf('function')
    }
    expect([...DIALOG_KINDS].sort()).toEqual([...ALL_DIALOGS].sort())
  })

  it('kennt keine Dialogvariante, die es im Contract nicht gibt', () => {
    for (const kind of DIALOG_KINDS) {
      expect(ALL_DIALOGS, `"${kind}" steht nicht in DialogState`).toContain(kind)
    }
  })

  it('hat zu jedem oberflaechlichen Dialog eine Komponente', () => {
    expect([...LOCAL_DIALOG_KINDS].sort()).toEqual(['quickstart', 'saveAs', 'shortcuts'])
    for (const kind of LOCAL_DIALOG_KINDS) {
      expect(LOCAL_DIALOG_RENDERERS[kind], `Kein Dialog für "${kind}"`).toBeTypeOf('function')
    }
  })
})

/* ------------------------------------------------------------------ */
/* Abgleich mit der Werkzeugschicht                                     */
/* ------------------------------------------------------------------ */

describe('Abgleich mit der Werkzeugschicht', () => {
  it('belegt jedes Werkzeug in TOOL_SHORTCUTS mit einer echten ToolId', () => {
    for (const [combo, id] of Object.entries(TOOL_SHORTCUTS)) {
      expect(ALL_TOOLS, `Kürzel "${combo}" zeigt auf "${id}" - keine ToolId`).toContain(id)
    }
  })

  it('vergibt für jedes Werkzeug genau ein Kürzel', () => {
    const covered = Object.values(TOOL_SHORTCUTS)
    for (const id of ALL_TOOLS) {
      expect(covered.filter((entry) => entry === id).length, `Kürzel für "${id}"`).toBe(1)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Instructor                                                          */
/* ------------------------------------------------------------------ */

describe('Instructor', () => {
  it('hat zu jedem Werkzeug eine Anleitung', () => {
    for (const id of ALL_TOOLS) {
      expect(TOOL_INSTRUCTIONS[id], `Keine Anleitung für "${id}"`).toBeDefined()
    }
    expect(Object.keys(TOOL_INSTRUCTIONS).sort()).toEqual([...ALL_TOOLS].sort())
  })

  it('nennt in jeder Anleitung mindestens einen Arbeitsschritt', () => {
    // Ein leeres Instructor-Panel sieht aus wie ein Fehler, nicht wie
    // "hier gibt es nichts zu erklaeren".
    for (const id of ALL_TOOLS) {
      const instruction = instructionFor(id)
      expect(instruction.steps.length, `"${id}" ohne Arbeitsschritt`).toBeGreaterThan(0)
      for (const step of instruction.steps) {
        expect(step.trim().length, `"${id}": leerer Arbeitsschritt`).toBeGreaterThan(0)
      }
    }
  })

  it('beschriftet jede Sondertaste mit Taste und Wirkung', () => {
    for (const id of ALL_TOOLS) {
      for (const modifier of instructionFor(id).modifiers) {
        expect(modifier.key.trim().length, `"${id}": Sondertaste ohne Bezeichnung`).toBeGreaterThan(0)
        expect(modifier.effect.trim().length, `"${id}": Sondertaste "${modifier.key}" ohne Wirkung`).toBeGreaterThan(0)
      }
    }
  })

  it('schreibt die Anleitungen mit echten Umlauten', () => {
    for (const id of ALL_TOOLS) {
      const instruction = instructionFor(id)
      const texts = [
        ...instruction.steps,
        instruction.vcb ?? '',
        ...instruction.modifiers.flatMap((modifier) => [modifier.key, modifier.effect]),
      ]
      for (const text of texts) {
        expect(findSubstituteSpellings(text), `"${id}": ${spellingHint(text)}`).toEqual([])
      }
    }
  })
})
