/**
 * Werkzeugmanager: Wechsel, transiente Kamerawerkzeuge, Kuerzel, Esc.
 */

import { describe, expect, it } from 'vitest'
import { ToolManager, toolForKey } from '../toolManager'
import { createFakeStore, createFakeViewport, key, pointer } from './harness'
import { InferenceEngine } from '../inference'

function setup() {
  const store = createFakeStore()
  const viewport = createFakeViewport()
  const inference = new InferenceEngine(store.handle, viewport.api)
  const manager = new ToolManager({ store: store.handle, viewport: viewport.api, inference })
  return { store, viewport, inference, manager }
}

describe('ToolManager', () => {
  it('startet mit dem Auswahlwerkzeug', () => {
    const { manager } = setup()
    expect(manager.getToolId()).toBe('select')
    expect(manager.getTool()?.name).toBe('Auswahl')
  })

  it('wechselt Werkzeuge und meldet es dem Store', () => {
    const { manager, store } = setup()
    manager.setTool('line')
    expect(manager.getToolId()).toBe('line')
    expect(store.calls.some((c) => c.name === 'setActiveTool' && c.args[0] === 'line')).toBe(true)
  })

  it('kennt jede ToolId - unbekannte Werkzeuge fallen nie auf null', () => {
    const { manager } = setup()
    const ids = [
      'select', 'lasso', 'eraser', 'paint', 'line', 'freehand', 'rectangle', 'rotatedRectangle',
      'circle', 'polygon', 'arc2', 'arc3', 'arc', 'pie', 'bezier', 'move', 'rotate', 'scale',
      'pushpull', 'followme', 'offset', 'tape', 'protractor', 'axes', 'dimension', 'text',
      'text3d', 'sectionPlane', 'orbit', 'pan', 'zoom', 'zoomWindow', 'position', 'walk',
      'lookaround',
    ] as const
    for (const id of ids) {
      manager.setTool(id)
      expect(manager.getToolId()).toBe(id)
      expect(manager.getTool()).not.toBeNull()
    }
  })

  it('mittlere Maustaste orbitet transient und kehrt danach zurueck', () => {
    const { manager, viewport } = setup()
    manager.setTool('line')
    manager.handlePointerDown(pointer(100, 100, { button: 1, buttons: 4 }))
    expect(manager.getToolId()).toBe('orbit')
    manager.handlePointerMove(pointer(140, 120, { button: 1, buttons: 4 }))
    expect(viewport.camera.orbit).toBeGreaterThan(0)
    manager.handlePointerUp(pointer(140, 120, { button: 1, buttons: 0 }))
    expect(manager.getToolId()).toBe('line')
  })

  it('mittlere Maustaste mit Umschalt schwenkt', () => {
    const { manager, viewport } = setup()
    manager.setTool('circle')
    manager.handlePointerDown(pointer(10, 10, { button: 1, buttons: 4, shift: true }))
    expect(manager.getToolId()).toBe('pan')
    manager.handlePointerMove(pointer(30, 10, { button: 1, buttons: 4, shift: true }))
    expect(viewport.camera.pan).toBeGreaterThan(0)
    manager.handlePointerUp(pointer(30, 10, { button: 1, buttons: 0, shift: true }))
    expect(manager.getToolId()).toBe('circle')
  })

  it('das Mausrad zoomt in jedem Werkzeug', () => {
    const { manager, viewport } = setup()
    manager.setTool('rectangle')
    manager.handleWheel(pointer(400, 300, { delta: -100 }))
    expect(viewport.camera.dolly).toBeGreaterThan(0)
    expect(manager.getToolId()).toBe('rectangle')
  })

  it('Leertaste: halten orbitet, tippen waehlt das Auswahlwerkzeug', () => {
    const { manager } = setup()
    manager.setTool('line')
    manager.handleKeyDown(key(' '))
    expect(manager.getToolId()).toBe('orbit')
    manager.handleKeyUp(key(' '))
    // sehr kurz gehalten -> Tippen
    expect(manager.getToolId()).toBe('select')
  })

  it('Buchstabenkuerzel wechseln das Werkzeug', () => {
    const { manager } = setup()
    manager.handleKeyDown(key('l'))
    expect(manager.getToolId()).toBe('line')
    manager.handleKeyDown(key('r'))
    expect(manager.getToolId()).toBe('rectangle')
    manager.handleKeyDown(key('r', { shift: true }))
    expect(manager.getToolId()).toBe('rotatedRectangle')
  })

  it('Entf loescht die Auswahl als eigene Operation', () => {
    const { manager, store } = setup()
    store.state.setSelection({ edgeIds: ['e1'], faceIds: [], vertexIds: [], entityIds: [] })
    manager.handleKeyDown(key('Delete'))
    expect(store.operations).toContain('Löschen')
    expect(store.calls.some((c) => c.name === 'deletePrimitives')).toBe(true)
  })

  it('zweimal Esc leert die Auswahl, danach verlaesst es den Kontext', () => {
    const { manager, store } = setup()
    store.state.setSelection({ edgeIds: ['e1'], faceIds: [], vertexIds: [], entityIds: [] })
    manager.handleKeyDown(key('Escape'))
    manager.handleKeyDown(key('Escape'))
    expect(store.calls.some((c) => c.name === 'clearSelection')).toBe(true)

    manager.handleKeyDown(key('Escape'))
    manager.handleKeyDown(key('Escape'))
    expect(store.calls.some((c) => c.name === 'exitContext')).toBe(true)
  })

  it('faengt Werkzeugfehler ab, statt die Anwendung abstuerzen zu lassen', () => {
    const { manager, store } = setup()
    const tool = manager.getTool()
    expect(tool).not.toBeNull()
    if (tool) {
      tool.onPointerDown = () => {
        throw new Error('kaputt')
      }
    }
    expect(() => manager.handlePointerDown(pointer(10, 10))).not.toThrow()
    expect(store.calls.some((c) => c.name === 'toast')).toBe(true)
  })

  it('dispose deaktiviert das Werkzeug und ignoriert weitere Ereignisse', () => {
    const { manager } = setup()
    manager.dispose()
    expect(manager.getTool()).toBeNull()
    expect(() => manager.handlePointerMove(pointer(1, 1))).not.toThrow()
  })
})

describe('toolForKey', () => {
  it('unterscheidet Modifikatoren', () => {
    expect(toolForKey(key('a'))).toBe('arc2')
    expect(toolForKey(key('a', { shift: true }))).toBe('arc3')
    expect(toolForKey(key('a', { alt: true }))).toBe('arc')
    expect(toolForKey(key('a', { alt: true, shift: true }))).toBe('pie')
  })

  it('liefert fuer die Leertaste nichts - sie wird gesondert behandelt', () => {
    expect(toolForKey(key(' '))).toBeNull()
  })

  it('ignoriert Strg-Kombinationen der Menues', () => {
    expect(toolForKey(key('z', { ctrl: true }))).toBeNull()
  })
})
