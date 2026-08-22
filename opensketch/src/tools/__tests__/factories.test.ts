/**
 * KEIN PLATZHALTER BLEIBT UEBRIG.
 *
 * `PlaceholderTool` haelt die Anwendung am Leben, wenn eine `ToolId` noch
 * keine Umsetzung hat - und genau deshalb faellt eine fehlende Umsetzung im
 * Betrieb nicht auf: das Werkzeug laesst sich waehlen, zeigt einen Cursor und
 * tut nichts. Sieben Werkzeuge sind so wochenlang durchgerutscht.
 *
 * Dieser Test zaehlt sie. Kommt im Contract eine `ToolId` dazu, ist er rot,
 * bis es das Werkzeug wirklich gibt.
 *
 * Die Gegenrichtung (jede ToolId hat Knopf, Kuerzel und Menueeintrag) prueft
 * `ui-dev` in seiner Schicht.
 */

import { describe, expect, it } from 'vitest'
import { InferenceEngine } from '../inference'
import { PlaceholderTool } from '../placeholder'
import { ALL_TOOL_IDS, TOOL_FACTORIES, TOOL_NAMES, TOOL_SHORTCUTS, ToolManager } from '../toolManager'
import { createFakeStore, createFakeViewport } from './harness'

function setup() {
  const store = createFakeStore()
  const viewport = createFakeViewport()
  const inference = new InferenceEngine(store.handle, viewport.api)
  return { store, manager: new ToolManager({ store: store.handle, viewport: viewport.api, inference }) }
}

describe('Werkzeugverzeichnis', () => {
  it('kennt jede ToolId aus dem Contract', () => {
    // `TOOL_NAMES` ist `Record<ToolId, string>` - die Liste kann nicht veralten.
    expect(ALL_TOOL_IDS.length).toBeGreaterThan(30)
    const missing = ALL_TOOL_IDS.filter((id) => !TOOL_FACTORIES[id])
    expect(missing, `ohne Fabrik: ${missing.join(', ')}`).toEqual([])
  })

  it('erzeugt zu keiner ToolId ein PlaceholderTool', () => {
    const { manager } = setup()
    const placeholders: string[] = []
    for (const id of ALL_TOOL_IDS) {
      manager.setTool(id)
      const tool = manager.getTool()
      expect(tool, `${id} liefert kein Werkzeug`).not.toBeNull()
      expect(tool?.id, `${id} meldet eine andere Kennung`).toBe(id)
      expect(tool?.name).toBe(TOOL_NAMES[id])
      if (tool instanceof PlaceholderTool) placeholders.push(id)
    }
    expect(placeholders, `noch Platzhalter: ${placeholders.join(', ')}`).toEqual([])
  })

  it('gibt jedem Werkzeug einen Statushinweis', () => {
    for (const id of ALL_TOOL_IDS) {
      const tool = TOOL_FACTORIES[id]?.()
      expect(tool?.hint.length, `${id} ohne Hinweis`).toBeGreaterThan(0)
    }
  })

  it('vergibt jedes Kürzel nur einmal', () => {
    const seen = new Map<string, string>()
    for (const [combo, id] of Object.entries(TOOL_SHORTCUTS)) {
      expect(seen.has(combo), `${combo} doppelt vergeben`).toBe(false)
      seen.set(combo, id)
      expect(ALL_TOOL_IDS).toContain(id)
    }
  })
})
