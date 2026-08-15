/**
 * Transaktionen, Undo/Redo und Copy-on-Write.
 *
 * Der wichtigste Test der Modellschicht: der Kernel mutiert `Geometry` in
 * place. Nur weil der Store vor jeder Aenderung `touchDefinition` ruft, bleiben
 * die Snapshots der Historie unversehrt.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Id, Mat4Like } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { M } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import { buildBox, buildQuad, installGeometry } from './helpers'

/** Transform einer Instanz, mit Typpruefung statt Cast. */
function instanceTransform(id: Id): Mat4Like {
  const entity = useStore.getState().getEntity(id)
  if (entity?.type !== 'instance') throw new Error('Instanz erwartet')
  return entity.transform
}

beforeEach(() => {
  resetStoreForTests('metric')
})

const geom = () => useStore.getState().getActiveGeometry()
const edgeCount = () => Object.keys(geom().edges).length
const faceCount = () => Object.keys(geom().faces).length

describe('Einzelne Operationen', () => {
  it('undo und redo einer Kante', () => {
    expect(useStore.getState().canUndo()).toBe(false)
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(edgeCount()).toBe(1)
    expect(useStore.getState().canUndo()).toBe(true)

    useStore.getState().undo()
    expect(edgeCount()).toBe(0)
    expect(useStore.getState().canRedo()).toBe(true)

    useStore.getState().redo()
    expect(edgeCount()).toBe(1)
    expect(useStore.getState().canRedo()).toBe(false)
  })

  it('haelt die Reihenfolge ueber mehrere Operationen', () => {
    const s = useStore.getState()
    s.addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    s.addEdge({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })
    s.addEdge({ x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 })
    expect(edgeCount()).toBe(3)

    useStore.getState().undo()
    expect(edgeCount()).toBe(2)
    useStore.getState().undo()
    expect(edgeCount()).toBe(1)
    useStore.getState().undo()
    expect(edgeCount()).toBe(0)
    expect(useStore.getState().canUndo()).toBe(false)

    useStore.getState().redo()
    useStore.getState().redo()
    useStore.getState().redo()
    expect(edgeCount()).toBe(3)
  })

  it('eine neue Operation verwirft den Redo-Stapel', () => {
    const s = useStore.getState()
    s.addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    useStore.getState().undo()
    expect(useStore.getState().canRedo()).toBe(true)

    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
    expect(useStore.getState().canRedo()).toBe(false)
    expect(edgeCount()).toBe(1)
  })

  it('benennt die Schritte fuer das Bearbeiten-Menue', () => {
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const history = useStore.getState().history
    expect(history.undoStack).toHaveLength(1)
    expect(history.undoStack[0].name).toBe('Kante zeichnen')
    expect(history.pending).toBeNull()
  })

  it('clearHistory leert beide Stapel, laesst das Dokument aber stehen', () => {
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    useStore.getState().clearHistory()
    expect(useStore.getState().canUndo()).toBe(false)
    expect(useStore.getState().canRedo()).toBe(false)
    expect(edgeCount()).toBe(1)
  })
})

describe('Verschachtelte Transaktionen', () => {
  it('erzeugt genau einen Undo-Schritt', () => {
    useStore.getState().operation('Rechteck zeichnen', () => {
      const s = useStore.getState()
      s.addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
      s.addEdge({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })
      s.addEdge({ x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 0 })
    })
    expect(edgeCount()).toBe(3)
    expect(useStore.getState().history.undoStack).toHaveLength(1)
    expect(useStore.getState().history.undoStack[0].name).toBe('Rechteck zeichnen')

    useStore.getState().undo()
    expect(edgeCount()).toBe(0)
  })

  it('meldet die laufende Operation als pending', () => {
    useStore.getState().beginOperation('Laeuft gerade')
    expect(useStore.getState().history.pending).toBe('Laeuft gerade')
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(useStore.getState().history.pending).toBe('Laeuft gerade')
    useStore.getState().commitOperation()
    expect(useStore.getState().history.pending).toBeNull()
    expect(useStore.getState().history.undoStack).toHaveLength(1)
  })

  it('abortOperation stellt den Stand des aeussersten beginOperation her', () => {
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const before = edgeCount()

    useStore.getState().beginOperation('Aeussere Operation')
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
    useStore.getState().beginOperation('Innere Operation')
    useStore.getState().addEdge({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 })
    expect(edgeCount()).toBe(before + 2)

    useStore.getState().abortOperation()
    expect(edgeCount()).toBe(before)
    expect(useStore.getState().history.pending).toBeNull()
    // Der Abbruch selbst ist kein Undo-Schritt
    expect(useStore.getState().history.undoStack).toHaveLength(1)
  })

  it('eine Ausnahme im Rumpf bricht ab und wird durchgereicht', () => {
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(() =>
      useStore.getState().operation('Fehlerhaft', () => {
        useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
        throw new Error('Absicht')
      }),
    ).toThrow('Absicht')
    expect(edgeCount()).toBe(1)
    expect(useStore.getState().history.undoStack).toHaveLength(1)
  })

  it('eine Operation ohne Aenderung verschmutzt die Historie nicht', () => {
    useStore.getState().operation('Leerlauf', () => undefined)
    expect(useStore.getState().canUndo()).toBe(false)
  })
})

describe('Copy-on-Write', () => {
  it('spaetere In-Place-Mutationen beschaedigen den Snapshot nicht', () => {
    const built = installGeometry(buildQuad())
    const vertexId = built.vertexIds[0]

    useStore.getState().addEdge({ x: 5, y: 5, z: 0 }, { x: 6, y: 5, z: 0 })
    const snapshotDoc = useStore.getState().doc
    const rootId = snapshotDoc.rootId
    const before = { ...snapshotDoc.definitions[rootId].geometry.vertices[vertexId].p }

    // Der Fallback mutiert vertex.p in place - das darf den alten Stand nicht treffen
    useStore.getState().moveVertices([vertexId], { x: 0, y: 0, z: 10 })
    expect(snapshotDoc.definitions[rootId].geometry.vertices[vertexId].p).toEqual(before)
    expect(useStore.getState().doc.definitions[rootId].geometry.vertices[vertexId].p.z).toBeCloseTo(
      before.z + 10,
      9,
    )

    useStore.getState().undo()
    expect(useStore.getState().getActiveGeometry().vertices[vertexId].p).toEqual(before)
  })

  it('teilt unveraenderte Definitionen zwischen den Snapshots', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    useStore.getState().makeGroup('Gruppe')

    const docBefore = useStore.getState().doc
    const groupDefId = Object.keys(docBefore.definitions).find((id) => id !== docBefore.rootId)
    expect(groupDefId).toBeDefined()

    // Aenderung nur an der Wurzel: die Gruppendefinition bleibt dasselbe Objekt
    useStore.getState().addEdge({ x: 20, y: 0, z: 0 }, { x: 21, y: 0, z: 0 })
    const docAfter = useStore.getState().doc
    expect(docAfter).not.toBe(docBefore)
    expect(docAfter.definitions[groupDefId as string]).toBe(docBefore.definitions[groupDefId as string])
  })

  it('das Dokumentobjekt wird bei jeder Aenderung ersetzt', () => {
    const before = useStore.getState().doc
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(useStore.getState().doc).not.toBe(before)
  })
})

describe('Undo ueber Kontextwechsel', () => {
  it('stellt Geometrie und Editierkontext gemeinsam wieder her', () => {
    installGeometry(buildBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Wuerfel')
    expect(instanceId).not.toBeNull()
    const rootId = useStore.getState().doc.rootId

    useStore.getState().enterContext(instanceId as string)
    const groupDefId = useStore.getState().context.definitionId
    expect(groupDefId).not.toBe(rootId)
    const facesInGroup = faceCount()

    // Innerhalb der Gruppe zeichnen
    useStore.getState().addEdge({ x: 0, y: 0, z: 5 }, { x: 2, y: 0, z: 5 })
    expect(edgeCount()).toBe(13)

    // Kontext verlassen und erst dann rueckgaengig machen
    useStore.getState().exitContext()
    expect(useStore.getState().context.definitionId).toBe(rootId)

    useStore.getState().undo()
    // Undo springt zurueck in den Kontext, in dem gezeichnet wurde
    expect(useStore.getState().context.definitionId).toBe(groupDefId)
    expect(edgeCount()).toBe(12)
    expect(faceCount()).toBe(facesInGroup)

    useStore.getState().redo()
    expect(useStore.getState().context.definitionId).toBe(groupDefId)
    expect(edgeCount()).toBe(13)
  })

  it('macht das Gruppieren selbst rueckgaengig', () => {
    const built = installGeometry(buildQuad())
    const rootId = useStore.getState().doc.rootId
    const definitionsBefore = Object.keys(useStore.getState().doc.definitions).length

    useStore.getState().selectAll()
    useStore.getState().makeGroup('Weg damit')
    expect(Object.keys(useStore.getState().doc.definitions)).toHaveLength(definitionsBefore + 1)
    expect(Object.keys(useStore.getState().doc.definitions[rootId].geometry.faces)).toHaveLength(0)

    useStore.getState().undo()
    const doc = useStore.getState().doc
    expect(Object.keys(doc.definitions)).toHaveLength(definitionsBefore)
    expect(Object.keys(doc.definitions[rootId].geometry.faces)).toEqual(built.faceIds)
    expect(Object.keys(doc.entities)).toHaveLength(0)
  })

  it('undo waehrend einer laufenden Operation bricht diese zuerst ab', () => {
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    useStore.getState().beginOperation('Angefangen')
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
    useStore.getState().undo()
    expect(useStore.getState().history.pending).toBeNull()
    expect(edgeCount()).toBe(0)
  })
})

describe('Revisionszaehler und dirty', () => {
  it('erhoeht nur die betroffenen Zaehler', () => {
    const before = useStore.getState()
    const geometryRevision = before.geometryRevision
    const materialRevision = before.materialRevision
    const styleRevision = before.styleRevision

    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(useStore.getState().geometryRevision).toBe(geometryRevision + 1)
    expect(useStore.getState().materialRevision).toBe(materialRevision)

    useStore.getState().updateStyle({ showGrid: true })
    expect(useStore.getState().styleRevision).toBe(styleRevision + 1)
    expect(useStore.getState().geometryRevision).toBe(geometryRevision + 1)
  })

  it('dirty wird gesetzt und laesst sich zuruecksetzen', () => {
    expect(useStore.getState().dirty).toBe(false)
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(useStore.getState().dirty).toBe(true)
    useStore.getState().setDirty(false)
    expect(useStore.getState().dirty).toBe(false)
  })

  it('setzt modifiedAt beim Commit', () => {
    const before = useStore.getState().doc.meta.modifiedAt
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const after = useStore.getState().doc.meta.modifiedAt
    expect(Date.parse(after)).toBeGreaterThanOrEqual(Date.parse(before))
  })
})

describe('Entities in der Historie', () => {
  it('macht Verschieben von Instanzen rueckgaengig', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Beweglich') as string

    const before = M.getTranslation(instanceTransform(instanceId))
    useStore.getState().transformEntities([instanceId], M.translation({ x: 5, y: 0, z: 0 }), false)
    const moved = M.getTranslation(instanceTransform(instanceId))
    expect(moved.x).toBeCloseTo(before.x + 5, 9)

    useStore.getState().undo()
    const restored = M.getTranslation(instanceTransform(instanceId))
    expect(restored.x).toBeCloseTo(before.x, 9)
  })

  it('transformPrimitives verschiebt Geometrie und Entities in einem Schritt', () => {
    const built = installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Mit dabei') as string

    // Neue Geometrie neben der Gruppe
    const change = useStore.getState().addEdge({ x: 10, y: 0, z: 0 }, { x: 11, y: 0, z: 0 })
    const edgeId = change.addedEdges[0]

    useStore.getState().setSelection({
      ...emptySelection(),
      edgeIds: [edgeId],
      entityIds: [instanceId],
    })
    useStore.getState().transformPrimitives(
      useStore.getState().selection,
      M.translation({ x: 0, y: 0, z: 3 }),
      false,
    )

    const instance = useStore.getState().getEntity(instanceId)
    expect(instance?.type).toBe('instance')
    if (instance?.type === 'instance') {
      expect(M.getTranslation(instance.transform).z).toBeCloseTo(3, 9)
    }
    const edge = useStore.getState().getActiveGeometry().edges[edgeId]
    expect(useStore.getState().getActiveGeometry().vertices[edge.a].p.z).toBeCloseTo(3, 9)
    expect(built.faceIds.length).toBe(1)

    // Beides zusammen in einem Undo-Schritt
    useStore.getState().undo()
    const back = useStore.getState().getEntity(instanceId)
    if (back?.type === 'instance') expect(M.getTranslation(back.transform).z).toBeCloseTo(0, 9)
    const edgeBack = useStore.getState().getActiveGeometry().edges[edgeId]
    expect(useStore.getState().getActiveGeometry().vertices[edgeBack.a].p.z).toBeCloseTo(0, 9)
  })
})
