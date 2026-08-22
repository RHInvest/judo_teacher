/**
 * Grenzfaelle der Historie.
 *
 *  - Was passiert am Rand des Stapels (Obergrenze, Redo danach)?
 *  - Was macht `abortOperation` bei mehrfach verschachtelten Operationen -
 *    und zwar nicht nur mit Geometrie, sondern auch mit Entities,
 *    Materialien, Tags, Auswahl und Kontext?
 *  - Was passiert, wenn Undo den Kontext wegzieht, in dem man gerade steht?
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { emptySelection } from '@/shared/types'
import { M } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import { HISTORY_LIMIT } from '../history'
import { buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
})

const state = () => useStore.getState()
const edgeCount = () => Object.keys(state().getActiveGeometry().edges).length

/** Definition, auf die eine Instanz zeigt. */
function definitionIdOf(instanceId: string): string {
  const entity = state().doc.entities[instanceId]
  if (!entity || entity.type !== 'instance') throw new Error(`Instanz "${instanceId}" fehlt`)
  return entity.definitionId
}

describe('Rand des Undo-Stapels', () => {
  it('Redo fuehrt nach dem Abraeumen wieder bis ganz nach vorne', () => {
    const steps = HISTORY_LIMIT + 5
    for (let i = 0; i < steps; i++) state().addEdge({ x: i, y: 0, z: 0 }, { x: i, y: 1, z: 0 })
    expect(edgeCount()).toBe(steps)
    expect(state().history.undoStack).toHaveLength(HISTORY_LIMIT)

    for (let i = 0; i < HISTORY_LIMIT; i++) state().undo()
    // Die fuenf aeltesten Schritte sind aus dem Stapel gefallen und bleiben stehen
    expect(edgeCount()).toBe(5)
    expect(state().canUndo()).toBe(false)
    expect(state().history.redoStack).toHaveLength(HISTORY_LIMIT)

    for (let i = 0; i < HISTORY_LIMIT; i++) state().redo()
    expect(edgeCount()).toBe(steps)
    expect(state().canRedo()).toBe(false)
    expect(state().history.undoStack).toHaveLength(HISTORY_LIMIT)
  })

  it('Undo und Redo am leeren Stapel tun nichts', () => {
    expect(state().canUndo()).toBe(false)
    expect(state().canRedo()).toBe(false)
    const before = state().doc
    state().undo()
    state().redo()
    expect(state().doc).toBe(before)
    expect(state().history.undoStack).toEqual([])
    expect(state().history.redoStack).toEqual([])
  })

  it('clearHistory waehrend einer laufenden Operation laesst nichts haengen', () => {
    state().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    state().beginOperation('Laeuft noch')
    state().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })

    state().clearHistory()

    expect(state().history.pending).toBeNull()
    expect(state().canUndo()).toBe(false)
    expect(state().canRedo()).toBe(false)
    // Das Dokument bleibt auf dem erreichten Stand ...
    expect(edgeCount()).toBe(2)
    // ... und die naechste Operation zaehlt wieder sauber.
    state().addEdge({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })
    expect(state().history.undoStack).toHaveLength(1)
  })
})

describe('abortOperation bei verschachtelten Operationen', () => {
  it('nimmt drei Ebenen auf einmal zurueck - mit allem, was dazugehoert', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    const materialsBefore = Object.keys(state().doc.materials).length
    const tagsBefore = Object.keys(state().doc.tags).length
    state().selectAll()
    const selectionBefore = state().selection
    const docBefore = state().doc
    const edgesBefore = edgeCount()

    state().beginOperation('Ebene 1')
    state().addEdge({ x: 5, y: 0, z: 0 }, { x: 6, y: 0, z: 0 })

    state().beginOperation('Ebene 2')
    state().addEntity({
      id: '',
      type: 'guidePoint',
      name: 'Hilfe',
      tagId: null,
      hidden: false,
      locked: false,
      position: { x: 9, y: 9, z: 9 },
    })

    state().beginOperation('Ebene 3')
    state().addTag('Neues Tag')
    state().addMaterial({
      name: 'Provisorisch',
      color: '#123456',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.5,
      metalness: 0,
      category: 'Eigene',
      colorize: false,
    })
    state().clearSelection()

    expect(state().history.pending).toBe('Ebene 1')
    expect(edgeCount()).toBe(edgesBefore + 1)
    expect(Object.keys(state().doc.entities)).toHaveLength(1)

    state().abortOperation()

    expect(state().history.pending).toBeNull()
    expect(edgeCount()).toBe(edgesBefore)
    expect(Object.keys(state().doc.entities)).toHaveLength(0)
    expect(Object.keys(state().doc.materials)).toHaveLength(materialsBefore)
    expect(Object.keys(state().doc.tags)).toHaveLength(tagsBefore)
    expect(state().selection).toEqual(selectionBefore)
    expect(state().doc).toBe(docBefore)
    // Der Abbruch selbst ist kein Undo-Schritt
    expect(state().canUndo()).toBe(false)
  })

  it('stellt auch den Editierkontext wieder her, wenn er mittendrin gewechselt wurde', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    state().selectAll()
    const instanceId = state().makeGroup('Kiste') as string
    const rootId = state().doc.rootId
    const groupDefinitionId = definitionIdOf(instanceId)
    expect(state().context.definitionId).toBe(rootId)

    state().beginOperation('Rein und was tun')
    state().enterContext(instanceId)
    expect(state().context.definitionId).toBe(groupDefinitionId)
    state().addEdge({ x: 0, y: 0, z: 4 }, { x: 1, y: 0, z: 4 })

    state().abortOperation()

    expect(state().context.definitionId).toBe(rootId)
    expect(state().context.instancePath).toEqual([])
    // Die im Gruppenkontext gezeichnete Kante ist ebenfalls weg
    expect(Object.keys(state().doc.definitions[groupDefinitionId].geometry.edges)).toHaveLength(4)
  })

  it('abortOperation ohne laufende Operation ist ein No-Op', () => {
    state().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const before = state().doc
    state().abortOperation()
    expect(state().doc).toBe(before)
    expect(edgeCount()).toBe(1)
    expect(state().history.undoStack).toHaveLength(1)
  })

  it('nach dem Abbruch zaehlt die naechste Operation wieder normal', () => {
    state().beginOperation('Verworfen')
    state().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    state().abortOperation()

    state().operation('Behalten', () => {
      state().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
      state().addEdge({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 })
    })

    expect(state().history.undoStack).toHaveLength(1)
    expect(state().history.undoStack[0].name).toBe('Behalten')
    expect(edgeCount()).toBe(2)
    state().undo()
    expect(edgeCount()).toBe(0)
  })

  it('commitOperation ohne beginOperation tut nichts', () => {
    const before = state().doc
    state().commitOperation()
    expect(state().doc).toBe(before)
    expect(state().canUndo()).toBe(false)
  })
})

describe('Undo ueber einen Kontextwechsel hinweg', () => {
  it('holt den Nutzer aus einem Kontext heraus, den das Undo aufloest', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 2, 2))
    const rootId = state().doc.rootId
    state().selectAll()
    const instanceId = state().makeGroup('Kiste') as string

    state().enterContext(instanceId)
    const groupDefinitionId = state().context.definitionId
    expect(groupDefinitionId).not.toBe(rootId)

    // Dieses Undo loescht die Definition, in der wir gerade stehen.
    state().undo()

    expect(state().doc.definitions[groupDefinitionId]).toBeUndefined()
    expect(state().context.definitionId).toBe(rootId)
    expect(state().context.instancePath).toEqual([])
    expect(state().context.definitionPath).toEqual([rootId])
    expect(M.isIdentity(state().context.worldTransform)).toBe(true)
    // Die Geometrie ist wieder in der Wurzel und benutzbar
    expect(Object.keys(state().getActiveGeometry().faces)).toHaveLength(1)
    expect(state().addEdge({ x: 9, y: 0, z: 0 }, { x: 9, y: 1, z: 0 }).addedEdges).toHaveLength(1)
  })

  it('jedes Undo landet in dem Kontext, in dem der Schritt passiert ist', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    state().selectAll()
    const instanceId = state().makeGroup('Kiste') as string

    // Schritt A in der Wurzel
    state().addEdge({ x: 10, y: 0, z: 0 }, { x: 11, y: 0, z: 0 })
    // Schritt B in der Gruppe
    state().enterContext(instanceId)
    const groupDefinitionId = state().context.definitionId
    state().addEdge({ x: 0, y: 0, z: 3 }, { x: 1, y: 0, z: 3 })
    state().exitContext()
    // Schritt C wieder in der Wurzel
    state().addEdge({ x: 12, y: 0, z: 0 }, { x: 13, y: 0, z: 0 })
    const rootId = state().doc.rootId

    state().undo() // C
    expect(state().context.definitionId).toBe(rootId)
    state().undo() // B - fuehrt zurueck in die Gruppe
    expect(state().context.definitionId).toBe(groupDefinitionId)
    expect(state().context.instancePath).toEqual([instanceId])
    expect(Object.keys(state().getActiveGeometry().edges)).toHaveLength(4)
    state().undo() // A - wieder in der Wurzel
    expect(state().context.definitionId).toBe(rootId)
    expect(Object.keys(state().getActiveGeometry().edges)).toHaveLength(0)

    // Und dieselbe Reise vorwaerts
    state().redo()
    expect(state().context.definitionId).toBe(rootId)
    state().redo()
    expect(state().context.definitionId).toBe(groupDefinitionId)
    expect(Object.keys(state().getActiveGeometry().edges)).toHaveLength(5)
    state().redo()
    expect(state().context.definitionId).toBe(rootId)
  })

  it('ein Kontextwechsel allein ist kein Undo-Schritt', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    state().selectAll()
    const instanceId = state().makeGroup('Kiste') as string
    const stepsBefore = state().history.undoStack.length

    state().enterContext(instanceId)
    state().exitContext()
    state().enterContext(instanceId)
    state().exitAllContexts()

    expect(state().history.undoStack).toHaveLength(stepsBefore)
    expect(state().selection).toEqual(emptySelection())
  })
})
