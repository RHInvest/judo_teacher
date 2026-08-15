/**
 * Undo / Redo per strukturellem Snapshotting mit Structural Sharing.
 *
 * IDEE
 * ----
 * Ein Snapshot ist einfach die Referenz auf das aktuelle `doc`-Objekt. Das ist
 * nur dann sicher, wenn niemand dieses Objekt (oder etwas darin) nachtraeglich
 * mutiert. Der Kernel mutiert `Geometry` aber ausdruecklich IN PLACE.
 *
 * Deshalb gilt im Store die Regel: **vor jeder Aenderung an einer Definition
 * `touchDefinition(doc, defId)` aufrufen.** Die Funktion legt eine private
 * Kopie der Definition (inklusive tief kopierter Geometrie) an und haengt sie
 * in eine frische `definitions`-Map. Alles Unveraenderte bleibt geteilt -
 * ein Snapshot kostet dadurch nur so viel Speicher wie die tatsaechlich
 * geaenderten Definitionen.
 *
 * Analog dazu klonen `touchEntities`, `touchMaterials`, ... die jeweilige
 * Top-Level-Map genau einmal pro Operation.
 *
 * OWNERSHIP: Model.
 */

import type {
  Definition,
  EditContext,
  Entity,
  Id,
  Material,
  Scene,
  Selection,
  SketchDocument,
  Style,
  Tag,
  TagFolder,
  Texture,
} from '@/shared/types'
import type { HistoryEntry, HistoryState } from '@/shared/store-api'
import { newId } from '@/shared/ids'
import { cloneGeometry } from './geometry-utils'
import { cloneEntity, cloneScene } from './document'

/** Maximale Anzahl an Undo-Schritten. */
export const HISTORY_LIMIT = 100

/* ------------------------------------------------------------------ */
/* Copy-on-Write Helfer                                                */
/* ------------------------------------------------------------------ */

/** Merkzettel der innerhalb einer Operation bereits privatisierten Objekte. */
export interface TouchState {
  definitions: Set<Id>
  maps: Set<string>
}

export function createTouchState(): TouchState {
  return { definitions: new Set(), maps: new Set() }
}

/**
 * Privatisiert eine Definition, damit der Kernel ihre Geometrie gefahrlos
 * in place mutieren kann, ohne den Undo-Snapshot zu beschaedigen.
 *
 * Gibt die (nun private) Definition zurueck oder `undefined`, wenn es sie
 * nicht gibt. Mehrfachaufrufe innerhalb einer Operation sind billig.
 */
export function touchDefinition(doc: SketchDocument, defId: Id, touch?: TouchState): Definition | undefined {
  const existing = doc.definitions[defId]
  if (!existing) return undefined
  if (touch?.definitions.has(defId)) return existing

  const copy: Definition = {
    ...existing,
    geometry: cloneGeometry(existing.geometry),
    children: existing.children.slice(),
    behavior: existing.behavior ? { ...existing.behavior } : undefined,
  }
  if (!touch?.maps.has('definitions')) {
    doc.definitions = { ...doc.definitions }
    touch?.maps.add('definitions')
  }
  doc.definitions[defId] = copy
  touch?.definitions.add(defId)
  return copy
}

type DocMapKey = 'definitions' | 'entities' | 'materials' | 'textures' | 'tags' | 'tagFolders' | 'styles'

/** Klont eine Top-Level-Map des Dokuments genau einmal pro Operation. */
export function touchMap(doc: SketchDocument, key: DocMapKey, touch?: TouchState): void {
  if (touch?.maps.has(key)) return
  switch (key) {
    case 'definitions':
      doc.definitions = { ...doc.definitions }
      break
    case 'entities':
      doc.entities = { ...doc.entities }
      break
    case 'materials':
      doc.materials = { ...doc.materials }
      break
    case 'textures':
      doc.textures = { ...doc.textures }
      break
    case 'tags':
      doc.tags = { ...doc.tags }
      break
    case 'tagFolders':
      doc.tagFolders = { ...doc.tagFolders }
      break
    case 'styles':
      doc.styles = { ...doc.styles }
      break
  }
  touch?.maps.add(key)
}

/** Privatisiert eine einzelne Entity (die Maps darin sind flach genug). */
export function touchEntity(doc: SketchDocument, id: Id, touch?: TouchState): Entity | undefined {
  const existing = doc.entities[id]
  if (!existing) return undefined
  const marker = `entity:${id}`
  if (touch?.maps.has(marker)) return existing
  touchMap(doc, 'entities', touch)
  const copy = cloneEntity(existing)
  doc.entities[id] = copy
  touch?.maps.add(marker)
  return copy
}

export function touchMaterial(doc: SketchDocument, id: Id, touch?: TouchState): Material | undefined {
  const existing = doc.materials[id]
  if (!existing) return undefined
  const marker = `material:${id}`
  if (touch?.maps.has(marker)) return existing
  touchMap(doc, 'materials', touch)
  const copy: Material = { ...existing }
  doc.materials[id] = copy
  touch?.maps.add(marker)
  return copy
}

export function touchTag(doc: SketchDocument, id: Id, touch?: TouchState): Tag | undefined {
  const existing = doc.tags[id]
  if (!existing) return undefined
  const marker = `tag:${id}`
  if (touch?.maps.has(marker)) return existing
  touchMap(doc, 'tags', touch)
  const copy: Tag = { ...existing }
  doc.tags[id] = copy
  touch?.maps.add(marker)
  return copy
}

export function touchTagFolder(doc: SketchDocument, id: Id, touch?: TouchState): TagFolder | undefined {
  const existing = doc.tagFolders[id]
  if (!existing) return undefined
  const marker = `folder:${id}`
  if (touch?.maps.has(marker)) return existing
  touchMap(doc, 'tagFolders', touch)
  const copy: TagFolder = { ...existing }
  doc.tagFolders[id] = copy
  touch?.maps.add(marker)
  return copy
}

export function touchStyle(doc: SketchDocument, id: Id, touch?: TouchState): Style | undefined {
  const existing = doc.styles[id]
  if (!existing) return undefined
  const marker = `style:${id}`
  if (touch?.maps.has(marker)) return existing
  touchMap(doc, 'styles', touch)
  const copy: Style = { ...existing }
  doc.styles[id] = copy
  touch?.maps.add(marker)
  return copy
}

export function touchTexture(doc: SketchDocument, id: Id, touch?: TouchState): Texture | undefined {
  const existing = doc.textures[id]
  if (!existing) return undefined
  const marker = `texture:${id}`
  if (touch?.maps.has(marker)) return existing
  touchMap(doc, 'textures', touch)
  const copy: Texture = { ...existing }
  doc.textures[id] = copy
  touch?.maps.add(marker)
  return copy
}

/** Szenen sind ein Array - hier wird es einmal pro Operation kopiert. */
export function touchScenes(doc: SketchDocument, touch?: TouchState): Scene[] {
  if (!touch?.maps.has('scenes')) {
    doc.scenes = doc.scenes.map(cloneScene)
    touch?.maps.add('scenes')
  }
  return doc.scenes
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

export interface HistorySnapshot {
  doc: SketchDocument
  context: EditContext
  selection: Selection
}

/** Welche Revisionszaehler eine Operation beruehrt hat. */
export interface DirtyMarks {
  /** Definitionen mit geaenderter Geometrie - fuer gezielte `geometry:changed` */
  definitions: Set<Id>
  geometry: boolean
  scene: boolean
  material: boolean
  style: boolean
  selection: boolean
  /**
   * true, sobald sich am Dokument etwas geaendert hat, das einen Undo-Schritt
   * rechtfertigt. Nur dann entsteht ein Eintrag - eine Operation, in der der
   * Kernel nichts getan hat, verschmutzt die Historie nicht.
   */
  document: boolean
}

export function createMarks(): DirtyMarks {
  return {
    definitions: new Set(),
    geometry: false,
    scene: false,
    material: false,
    style: false,
    selection: false,
    document: false,
  }
}

function mergeMarks(target: DirtyMarks, source: DirtyMarks): void {
  for (const id of source.definitions) target.definitions.add(id)
  target.geometry ||= source.geometry
  target.scene ||= source.scene
  target.material ||= source.material
  target.style ||= source.style
  target.selection ||= source.selection
  target.document ||= source.document
}

export interface HistoryRecord {
  entry: HistoryEntry
  before: HistorySnapshot
  after: HistorySnapshot
  marks: DirtyMarks
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/**
 * Referenzgezaehlte Transaktionen. Nur der aeusserste `begin`/`commit` erzeugt
 * einen Undo-Eintrag; verschachtelte Aufrufe zaehlen nur die Tiefe hoch.
 */
export class History {
  readonly limit: number

  private undoStack: HistoryRecord[] = []
  private redoStack: HistoryRecord[] = []
  private depth = 0
  private name: string | null = null
  private base: HistorySnapshot | null = null

  /** Copy-on-Write-Merkzettel der laufenden Operation. */
  touch: TouchState = createTouchState()
  /** Revisionsmarkierungen der laufenden Operation. */
  marks: DirtyMarks = createMarks()

  constructor(opts?: { limit?: number }) {
    this.limit = Math.max(1, opts?.limit ?? HISTORY_LIMIT)
  }

  get isRecording(): boolean {
    return this.depth > 0
  }

  get pending(): string | null {
    return this.depth > 0 ? this.name : null
  }

  get depthCount(): number {
    return this.depth
  }

  /** true, wenn dies der aeusserste `begin` war. */
  begin(name: string, snapshot: HistorySnapshot): boolean {
    this.depth += 1
    if (this.depth > 1) return false
    this.name = name
    this.base = snapshot
    this.touch = createTouchState()
    this.marks = createMarks()
    return true
  }

  /**
   * Schliesst eine Operation ab. Liefert den erzeugten Eintrag, wenn dies der
   * aeusserste `commit` war und sich tatsaechlich etwas geaendert hat.
   */
  commit(snapshot: HistorySnapshot): HistoryRecord | null {
    if (this.depth === 0) return null
    this.depth -= 1
    if (this.depth > 0) return null

    const before = this.base
    const name = this.name ?? 'Aenderung'
    const marks = this.marks
    this.base = null
    this.name = null
    this.touch = createTouchState()
    this.marks = createMarks()

    if (!before) return null
    // Leerlauf-Operationen erzeugen keinen Undo-Schritt.
    if (!marks.document || before.doc === snapshot.doc) return null

    const record: HistoryRecord = {
      entry: { id: newId('h'), name, timestamp: Date.now() },
      before,
      after: snapshot,
      marks,
    }
    this.undoStack.push(record)
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit)
    this.redoStack.length = 0
    return record
  }

  /**
   * Bricht die gesamte (auch verschachtelte) Operation ab und liefert den
   * Snapshot vom aeussersten `begin`.
   */
  abort(): { snapshot: HistorySnapshot; marks: DirtyMarks } | null {
    if (this.depth === 0) return null
    const before = this.base
    const marks = this.marks
    this.depth = 0
    this.base = null
    this.name = null
    this.touch = createTouchState()
    this.marks = createMarks()
    return before ? { snapshot: before, marks } : null
  }

  /** Verschmilzt Markierungen einer abgeschlossenen Teiloperation. */
  mergeMarks(marks: DirtyMarks): void {
    mergeMarks(this.marks, marks)
  }

  undo(): HistoryRecord | null {
    const record = this.undoStack.pop()
    if (!record) return null
    this.redoStack.push(record)
    return record
  }

  redo(): HistoryRecord | null {
    const record = this.redoStack.pop()
    if (!record) return null
    this.undoStack.push(record)
    return record
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.depth = 0
    this.name = null
    this.base = null
    this.touch = createTouchState()
    this.marks = createMarks()
  }

  /** Serialisierbarer Zustand fuer den Store (`AppState.history`). */
  state(): HistoryState {
    return {
      undoStack: this.undoStack.map((r) => r.entry),
      redoStack: this.redoStack
        .slice()
        .reverse()
        .map((r) => r.entry),
      pending: this.pending,
    }
  }

  /**
   * Grobe Speicherabschaetzung in Bytes. Geteilte Definitionen werden dank
   * Structural Sharing nur einmal gezaehlt - der Wert zeigt also den echten
   * Zusatzbedarf der Historie.
   */
  estimateBytes(): number {
    const seen = new Set<object>()
    let bytes = 0

    const measure = (snapshot: HistorySnapshot): void => {
      bytes += 256
      for (const id of Object.keys(snapshot.doc.definitions)) {
        const def = snapshot.doc.definitions[id]
        if (seen.has(def)) continue
        seen.add(def)
        bytes += 192
        bytes += Object.keys(def.geometry.vertices).length * 96
        bytes += Object.keys(def.geometry.edges).length * 144
        bytes += Object.keys(def.geometry.faces).length * 320
      }
      if (!seen.has(snapshot.doc.entities)) {
        seen.add(snapshot.doc.entities)
        bytes += Object.keys(snapshot.doc.entities).length * 224
      }
      if (!seen.has(snapshot.selection)) {
        seen.add(snapshot.selection)
        const s = snapshot.selection
        bytes += (s.edgeIds.length + s.faceIds.length + s.vertexIds.length + s.entityIds.length) * 24
      }
    }

    for (const record of this.undoStack) {
      measure(record.before)
      measure(record.after)
    }
    for (const record of this.redoStack) {
      measure(record.before)
      measure(record.after)
    }
    return bytes
  }

  /** Anzahl belegter Schritte (Undo + Redo) - fuer Diagnose. */
  size(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length }
  }
}
