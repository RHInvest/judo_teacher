/**
 * Zentrale Befehlsschicht.
 *
 * Menueleiste, Kontextmenue, Tastatur und Panels rufen ausschliesslich diese
 * Funktionen auf. Jede von ihnen ist defensiv: schlaegt eine noch nicht
 * implementierte Store-, IO- oder Renderer-Funktion fehl, gibt es eine
 * Kurzmeldung statt eines Absturzes.
 */

import {
  deleteSavedDocument,
  downloadDocument,
  listSavedDocuments,
  loadSavedDocument,
  readDocumentFile,
  saveNamedDocument,
} from '@/model'
import { bus } from '@/shared/events'
import { emptySelection, selectionCount } from '@/shared/types'
import type { Id, Mat4Like, Selection, StandardView, ToolId } from '@/shared/types'
import { getViewport } from '@/app/ViewportHost'
import { act, edit, read, toast } from '@/ui/state/store'
import { downloadBlob, pickFiles } from './hooks'

/* ------------------------------------------------------------------ */
/* Zustandsabfragen                                                    */
/* ------------------------------------------------------------------ */

export function currentSelection(): Selection {
  return read((state) => state.selection ?? emptySelection(), emptySelection())
}

export function hasSelection(): boolean {
  try {
    return selectionCount(currentSelection()) > 0
  } catch {
    return false
  }
}

export function selectionHasEntities(): boolean {
  return currentSelection().entityIds.length > 0
}

export function selectionHasFaces(): boolean {
  return currentSelection().faceIds.length > 0
}

export function selectionHasEdges(): boolean {
  return currentSelection().edgeIds.length > 0
}

export function inNestedContext(): boolean {
  return read((state) => (state.context?.instancePath?.length ?? 0) > 0, false)
}

/* ------------------------------------------------------------------ */
/* Zwischenablage                                                      */
/* ------------------------------------------------------------------ */

/**
 * Der Store bietet keine eigene Zwischenablage. Die Oberflaeche merkt sich
 * deshalb die zuletzt kopierte Auswahl und dupliziert sie beim Einfuegen
 * ueber `transformPrimitives(..., copy = true)`.
 */
const clipboard: { selection: Selection | null } = { selection: null }

export function clipboardFilled(): boolean {
  return clipboard.selection !== null && selectionCount(clipboard.selection) > 0
}

export function cmdCopy(): void {
  const selection = currentSelection()
  if (selectionCount(selection) === 0) return
  clipboard.selection = {
    edgeIds: [...selection.edgeIds],
    faceIds: [...selection.faceIds],
    vertexIds: [...selection.vertexIds],
    entityIds: [...selection.entityIds],
  }
  toast('Auswahl kopiert.', 'success')
}

export function cmdCut(): void {
  cmdCopy()
  cmdDelete()
  clipboard.selection = null
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as unknown as Mat4Like

export function cmdPaste(inPlace = false): void {
  const source = clipboard.selection
  if (!source) {
    toast('Die Zwischenablage ist leer.', 'warn')
    return
  }
  edit(inPlace ? 'An Ort einfuegen' : 'Einfuegen', (state) => {
    state.transformPrimitives(source, IDENTITY, true)
  })
}

/* ------------------------------------------------------------------ */
/* Datei                                                               */
/* ------------------------------------------------------------------ */

export const RECENT_KEY = 'opensketch.recent'

export interface RecentEntry {
  id: string
  name: string
  openedAt: number
}

export function readRecent(): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecentEntry[]).slice(0, 10) : []
  } catch {
    return []
  }
}

export function pushRecent(entry: RecentEntry): void {
  try {
    const list = readRecent().filter((item) => item.id !== entry.id)
    list.unshift(entry)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)))
  } catch {
    /* Speicher nicht verfuegbar */
  }
}

export function cmdNew(template: 'metric' | 'imperial' | 'empty' = 'metric'): void {
  act((state) => state.newDocument(template))
  act((state) => state.setDirty(false))
  toast('Neues Modell angelegt.', 'success')
}

export async function cmdSave(): Promise<void> {
  const doc = read((state) => state.exportDocument(), null)
  if (!doc) {
    toast('Dokument konnte nicht gelesen werden.', 'error')
    return
  }
  try {
    const id = await saveNamedDocument(doc)
    act((state) => state.setDirty(false))
    pushRecent({ id, name: doc.meta?.name ?? 'Unbenannt', openedAt: Date.now() })
    toast('Modell gespeichert.', 'success')
  } catch (err) {
    console.warn('[ui] Speichern fehlgeschlagen', err)
    toast('Speichern ist noch nicht verfuegbar.', 'warn')
  }
}

export function cmdSaveAs(name?: string): void {
  const doc = read((state) => state.exportDocument(), null)
  if (!doc) {
    toast('Dokument konnte nicht gelesen werden.', 'error')
    return
  }
  if (name && name.trim()) act((state) => state.setDocumentName(name.trim()))
  const target = read((state) => state.exportDocument(), doc)
  try {
    downloadDocument(target)
    act((state) => state.setDirty(false))
    toast('Datei wird heruntergeladen.', 'success')
  } catch (err) {
    console.warn('[ui] Download fehlgeschlagen', err)
    try {
      const blob = new Blob([JSON.stringify(target)], { type: 'application/json' })
      downloadBlob(blob, `${target.meta?.name || 'modell'}.osk`)
      toast('Datei wird heruntergeladen.', 'success')
    } catch {
      toast('Speichern unter ist noch nicht verfuegbar.', 'warn')
    }
  }
}

export async function cmdListSaved(): Promise<{ id: string; name: string; modifiedAt: string }[]> {
  try {
    return (await listSavedDocuments()) ?? []
  } catch (err) {
    console.warn('[ui] Dokumentliste nicht verfuegbar', err)
    return []
  }
}

export async function cmdOpenSaved(id: string): Promise<boolean> {
  try {
    const doc = await loadSavedDocument(id)
    if (!doc) {
      toast('Modell wurde nicht gefunden.', 'warn')
      return false
    }
    act((state) => state.loadDocument(doc))
    pushRecent({ id, name: doc.meta?.name ?? 'Unbenannt', openedAt: Date.now() })
    toast(`"${doc.meta?.name ?? 'Modell'}" geoeffnet.`, 'success')
    return true
  } catch (err) {
    console.warn('[ui] Oeffnen fehlgeschlagen', err)
    toast('Oeffnen ist noch nicht verfuegbar.', 'warn')
    return false
  }
}

export async function cmdDeleteSaved(id: string): Promise<void> {
  try {
    await deleteSavedDocument(id)
    toast('Eintrag geloescht.', 'success')
  } catch (err) {
    console.warn('[ui] Loeschen fehlgeschlagen', err)
    toast('Loeschen ist noch nicht verfuegbar.', 'warn')
  }
}

export async function cmdOpenFromDisk(): Promise<void> {
  const files = await pickFiles('.osk,application/json')
  const file = files[0]
  if (!file) return
  try {
    const doc = await readDocumentFile(file)
    act((state) => state.loadDocument(doc))
    toast(`"${file.name}" geoeffnet.`, 'success')
  } catch (err) {
    console.warn('[ui] Datei konnte nicht gelesen werden', err)
    toast('Diese Datei konnte nicht gelesen werden.', 'error')
  }
}

/** Import laeuft ueber den Bus - die Integrationsschicht uebernimmt alles Weitere. */
export function importFiles(files: File[]): void {
  for (const file of files) bus.emit('file:import', { file })
}

export async function cmdImport(): Promise<void> {
  const files = await pickFiles('.obj,.stl,.gltf,.glb,.svg,.png,.jpg,.jpeg,.osk', true)
  if (files.length === 0) return
  importFiles(files)
}

/* ------------------------------------------------------------------ */
/* Bearbeiten                                                          */
/* ------------------------------------------------------------------ */

export function undoName(): string | null {
  return read((state) => state.history?.undoStack?.at(-1)?.name ?? null, null)
}

export function redoName(): string | null {
  return read((state) => state.history?.redoStack?.at(-1)?.name ?? null, null)
}

export function canUndo(): boolean {
  return read((state) => state.canUndo(), false)
}

export function canRedo(): boolean {
  return read((state) => state.canRedo(), false)
}

export function cmdUndo(): void {
  act((state) => state.undo())
}

export function cmdRedo(): void {
  act((state) => state.redo())
}

export function cmdDelete(): void {
  const selection = currentSelection()
  if (selectionCount(selection) === 0) return
  edit('Loeschen', (state) => {
    state.deletePrimitives({
      edgeIds: selection.edgeIds,
      faceIds: selection.faceIds,
      vertexIds: selection.vertexIds,
      entityIds: selection.entityIds,
    })
    state.clearSelection()
  })
}

export function cmdSelectAll(): void {
  act((state) => state.selectAll())
}

export function cmdDeselect(): void {
  act((state) => state.clearSelection())
}

export function cmdInvertSelection(): void {
  act((state) => state.invertSelection())
}

export function cmdGroup(): void {
  if (!hasSelection()) return
  edit('Gruppe erstellen', (state) => {
    state.makeGroup()
  })
}

export function cmdExplode(): void {
  const ids = currentSelection().entityIds
  if (ids.length === 0) return
  edit('Aufloesen', (state) => state.explode(ids))
}

export function cmdMakeUnique(ids?: Id[]): void {
  const target = ids ?? currentSelection().entityIds
  if (target.length === 0) return
  edit('Eindeutig machen', (state) => state.makeUnique(target))
}

export function cmdHide(): void {
  const selection = currentSelection()
  if (selection.entityIds.length > 0) {
    edit('Verstecken', (state) => state.setEntityHidden(selection.entityIds, true))
    return
  }
  if (selection.edgeIds.length > 0) {
    edit('Verstecken', (state) => state.setEdgeFlags(selection.edgeIds, { hidden: true }))
  }
}

export function cmdUnhide(): void {
  edit('Einblenden', (state) => state.unhideAll())
}

export function cmdLock(locked: boolean): void {
  const ids = currentSelection().entityIds
  if (ids.length === 0) return
  edit(locked ? 'Sperren' : 'Entsperren', (state) => state.setEntityLocked(ids, locked))
}

export function cmdReverseFaces(): void {
  const ids = currentSelection().faceIds
  if (ids.length === 0) return
  edit('Flaechen umkehren', (state) => state.reverseFaces(ids))
}

export function cmdOrientFaces(): void {
  const ids = currentSelection().faceIds
  if (ids.length === 0) return
  edit('Flaechen ausrichten', (state) => state.orientFaces(ids[0]))
}

export function cmdIntersect(scope: 'selection' | 'model' | 'context'): void {
  edit('Schnittflaechen erzeugen', (state) => {
    state.intersectFaces(scope)
  })
}

export function cmdSoftenEdges(angleDegrees: number, softenCoplanar: boolean): void {
  const ids = currentSelection().edgeIds
  if (ids.length === 0) {
    toast('Bitte zuerst Kanten auswaehlen.', 'warn')
    return
  }
  edit('Kanten weichzeichnen', (state) => state.softenEdges(ids, angleDegrees, { softenCoplanar }))
}

export function cmdReplaceMaterialInModel(materialId: Id | null): void {
  edit('Material im Modell ersetzen', (state) => {
    const selection = state.selection
    state.applyMaterial(selection, materialId, 'both')
  })
}

/* ------------------------------------------------------------------ */
/* Kontext                                                             */
/* ------------------------------------------------------------------ */

export function cmdEnterContext(instanceId?: Id): void {
  const id = instanceId ?? currentSelection().entityIds[0]
  if (!id) return
  act((state) => state.enterContext(id))
}

export function cmdExitContext(): void {
  act((state) => state.exitContext())
}

/* ------------------------------------------------------------------ */
/* Kamera & Ansicht                                                    */
/* ------------------------------------------------------------------ */

export function cmdStandardView(view: StandardView): void {
  bus.emit('camera:command', { command: 'standardView', view })
  getViewportSafe()?.setStandardView(view, true)
}

export function cmdZoomExtents(): void {
  bus.emit('camera:command', { command: 'zoomExtents' })
  getViewportSafe()?.zoomExtents(true)
}

export function cmdZoomSelection(): void {
  bus.emit('camera:command', { command: 'zoomSelection' })
  getViewportSafe()?.zoomSelection(true)
}

export function cmdToggleProjection(): void {
  bus.emit('camera:command', { command: 'toggleProjection' })
}

export function cmdSetProjection(mode: 'perspective' | 'parallel'): void {
  const viewport = getViewportSafe()
  if (!viewport) {
    bus.emit('camera:command', { command: 'toggleProjection' })
    return
  }
  try {
    viewport.setProjection(mode)
  } catch (err) {
    console.warn('[ui] Projektion konnte nicht gesetzt werden', err)
  }
}

export function cmdTwoPointPerspective(enabled: boolean): void {
  const viewport = getViewportSafe()
  if (!viewport) return
  try {
    viewport.setCamera({ twoPointPerspective: enabled }, true)
  } catch (err) {
    console.warn('[ui] Zwei-Punkt-Perspektive nicht verfuegbar', err)
  }
}

export function getViewportSafe() {
  try {
    return getViewport()
  } catch {
    return null
  }
}

export function currentProjection(): 'perspective' | 'parallel' {
  try {
    return getViewport()?.getCamera()?.projection ?? 'perspective'
  } catch {
    return 'perspective'
  }
}

/* ------------------------------------------------------------------ */
/* Werkzeuge                                                           */
/* ------------------------------------------------------------------ */

export function setTool(id: ToolId): void {
  act((state) => state.setActiveTool(id))
  bus.emit('tool:changed', { id })
}
