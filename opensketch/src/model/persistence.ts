/**
 * Persistenz: Autosave in IndexedDB, Speicherslots, Datei-Import/-Export.
 *
 * Datenbank `opensketch`, Object-Store `documents` (keyPath `id`).
 * Ein Datensatz ist ein Slot:
 *
 * ```ts
 * { id, name, savedAt, modifiedAt, thumbnail, size, data /* .osk-JSON *\/ }
 * ```
 *
 * Der Slot `autosave` wird debounced (~2 s nach der letzten Aenderung)
 * geschrieben; benannte Slots legt der Nutzer ueber "Speichern" an.
 *
 * Alles hier ist defensiv: ohne IndexedDB (Tests, privater Modus) faellt das
 * Modul auf einen In-Memory-Speicher zurueck, statt zu werfen. Lesefunktionen
 * liefern im Fehlerfall `null` bzw. eine leere Liste - `@/app/bootstrap`
 * verlaesst sich darauf.
 *
 * OWNERSHIP: Model.
 */

import type { SketchDocument } from '@/shared/types'
import { deserializeDocument, serializeDocument, OSK_EXTENSION } from './serialize'

export const DB_NAME = 'opensketch'
export const DB_VERSION = 1
export const STORE_NAME = 'documents'
export const AUTOSAVE_ID = 'autosave'
export const AUTOSAVE_DELAY_MS = 2000
const RECENT_KEY = 'opensketch.recent'
const RECENT_LIMIT = 12

export interface StoredDocument {
  id: string
  name: string
  /** Zeitpunkt der letzten Dokumentaenderung (`meta.modifiedAt`) */
  modifiedAt: string
  /** Zeitpunkt des Schreibvorgangs */
  savedAt: string
  /** Vorschaubild als data-URL - Platzhalter, bis der Renderer eins liefert */
  thumbnail: string | null
  /** Groesse des JSON in Bytes */
  size: number
  data: string
}

export interface DocumentSlotInfo {
  id: string
  name: string
  modifiedAt: string
  savedAt: string
  thumbnail: string | null
  size: number
}

/* ------------------------------------------------------------------ */
/* Speicher-Backend                                                    */
/* ------------------------------------------------------------------ */

const memoryStore = new Map<string, StoredDocument>()
let warnedNoIndexedDb = false
let dbPromise: Promise<IDBDatabase | null> | null = null

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) {
    if (!warnedNoIndexedDb) {
      warnedNoIndexedDb = true
      console.warn('[model] IndexedDB nicht verfuegbar - Dokumente werden nur im Speicher gehalten')
    }
    return Promise.resolve(null)
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      console.warn('[model] IndexedDB konnte nicht geoeffnet werden', err)
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      console.warn('[model] IndexedDB-Fehler', request.error)
      resolve(null)
    }
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Transaktion abgebrochen'))
    tx.onerror = () => reject(tx.error ?? new Error('Transaktionsfehler'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB-Anfrage fehlgeschlagen'))
  })
}

async function putRecord(record: StoredDocument): Promise<void> {
  const db = await openDatabase()
  if (!db) {
    memoryStore.set(record.id, record)
    return
  }
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    await transactionDone(tx)
  } catch (err) {
    console.warn('[model] Speichern fehlgeschlagen, weiche auf den Speicher aus', err)
    memoryStore.set(record.id, record)
  }
}

async function getRecord(id: string): Promise<StoredDocument | null> {
  const db = await openDatabase()
  if (!db) return memoryStore.get(id) ?? null
  try {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<StoredDocument | undefined>(
      tx.objectStore(STORE_NAME).get(id) as IDBRequest<StoredDocument | undefined>,
    )
    return result ?? memoryStore.get(id) ?? null
  } catch (err) {
    console.warn('[model] Lesen fehlgeschlagen', err)
    return memoryStore.get(id) ?? null
  }
}

async function getAllRecords(): Promise<StoredDocument[]> {
  const db = await openDatabase()
  if (!db) return Array.from(memoryStore.values())
  try {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<StoredDocument[]>(
      tx.objectStore(STORE_NAME).getAll() as IDBRequest<StoredDocument[]>,
    )
    return result ?? []
  } catch (err) {
    console.warn('[model] Liste konnte nicht gelesen werden', err)
    return Array.from(memoryStore.values())
  }
}

async function deleteRecord(id: string): Promise<void> {
  memoryStore.delete(id)
  const db = await openDatabase()
  if (!db) return
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    await transactionDone(tx)
  } catch (err) {
    console.warn('[model] Loeschen fehlgeschlagen', err)
  }
}

/** Nur fuer Tests: verwirft den In-Memory-Speicher und den DB-Handle. */
export function resetPersistenceForTests(): void {
  memoryStore.clear()
  dbPromise = null
  cancelAutosave()
}

/**
 * Nur fuer Tests: legt einen Slot mit beliebigem Rohinhalt ab - so entsteht
 * ein beschaedigter Speicherstand, wie ihn ein abgebrochener Schreibvorgang
 * hinterlaesst.
 */
export function saveRawForTests(id: string, data: string): void {
  memoryStore.set(id, {
    id,
    name: id,
    modifiedAt: new Date(0).toISOString(),
    savedAt: new Date(0).toISOString(),
    thumbnail: null,
    size: data.length,
    data,
  })
}

/* ------------------------------------------------------------------ */
/* Slots                                                               */
/* ------------------------------------------------------------------ */

function buildRecord(id: string, doc: SketchDocument, thumbnail: string | null): StoredDocument {
  const data = serializeDocument(doc)
  return {
    id,
    name: doc.meta.name || 'Unbenannt',
    modifiedAt: doc.meta.modifiedAt,
    savedAt: new Date().toISOString(),
    thumbnail,
    size: data.length,
    data,
  }
}

function toInfo(record: StoredDocument): DocumentSlotInfo {
  return {
    id: record.id,
    name: record.name,
    modifiedAt: record.modifiedAt,
    savedAt: record.savedAt,
    thumbnail: record.thumbnail ?? null,
    size: record.size,
  }
}

/** Schreibt einen beliebigen Slot. */
export async function saveSlot(id: string, doc: SketchDocument, opts?: { thumbnail?: string | null }): Promise<void> {
  await putRecord(buildRecord(id, doc, opts?.thumbnail ?? null))
}

/** Liest einen Slot. Liefert `null`, wenn er fehlt oder unlesbar ist. */
export async function loadSlot(id: string): Promise<SketchDocument | null> {
  const record = await getRecord(id)
  if (!record?.data) return null
  try {
    return deserializeDocument(record.data)
  } catch (err) {
    console.warn(`[model] Slot "${id}" konnte nicht gelesen werden`, err)
    return null
  }
}

export async function deleteSlot(id: string): Promise<void> {
  await deleteRecord(id)
  removeRecent(id)
}

/** Alle Slots, neueste zuerst. `includeAutosave` standardmaessig aus. */
export async function listSlots(opts?: { includeAutosave?: boolean }): Promise<DocumentSlotInfo[]> {
  const records = await getAllRecords()
  return records
    .filter((r) => (opts?.includeAutosave ? true : r.id !== AUTOSAVE_ID))
    .map(toInfo)
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0))
}

/** Hinterlegt nachtraeglich ein Vorschaubild (der Renderer liefert es spaeter). */
export async function setSlotThumbnail(id: string, thumbnail: string): Promise<void> {
  const record = await getRecord(id)
  if (!record) return
  await putRecord({ ...record, thumbnail })
}

/** Legt einen neuen benannten Slot an oder ueberschreibt den gleichnamigen. */
export async function saveNamedSlot(doc: SketchDocument, opts?: { thumbnail?: string | null }): Promise<string> {
  const name = doc.meta.name || 'Unbenannt'
  const existing = (await getAllRecords()).find((r) => r.id !== AUTOSAVE_ID && r.name === name)
  const id = existing?.id ?? `doc-${Date.now().toString(36)}-${Math.floor(Math.random() * 46655).toString(36)}`
  await saveSlot(id, doc, { thumbnail: opts?.thumbnail ?? existing?.thumbnail ?? null })
  rememberRecent({ id, name, at: new Date().toISOString() })
  return id
}

/* ------------------------------------------------------------------ */
/* Autosave                                                            */
/* ------------------------------------------------------------------ */

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let autosavePending: SketchDocument | null = null

/** Schreibt den Autosave-Slot sofort. */
export async function saveAutosave(doc: SketchDocument): Promise<void> {
  await saveSlot(AUTOSAVE_ID, doc)
}

/** Liest den Autosave-Slot. `null`, wenn keiner existiert. */
export async function loadAutosave(): Promise<SketchDocument | null> {
  try {
    return await loadSlot(AUTOSAVE_ID)
  } catch (err) {
    console.warn('[model] Autosave konnte nicht geladen werden', err)
    return null
  }
}

export async function clearAutosave(): Promise<void> {
  await deleteRecord(AUTOSAVE_ID)
}

/**
 * Plant einen Autosave ~2 s nach der letzten Aenderung.
 * Mehrfachaufrufe verschieben den Zeitpunkt (Debounce).
 */
export function scheduleAutosave(doc: SketchDocument, delayMs = AUTOSAVE_DELAY_MS): void {
  autosavePending = doc
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    const pending = autosavePending
    autosavePending = null
    if (pending) void saveAutosave(pending).catch((err) => console.warn('[model] Autosave fehlgeschlagen', err))
  }, delayMs)
}

export function cancelAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = null
  autosavePending = null
}

/** Schreibt einen geplanten Autosave sofort (z. B. vor dem Schliessen). */
export async function flushAutosave(): Promise<void> {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = null
  const pending = autosavePending
  autosavePending = null
  if (pending) await saveAutosave(pending)
}

/* ------------------------------------------------------------------ */
/* Zuletzt geoeffnet                                                   */
/* ------------------------------------------------------------------ */

export interface RecentEntry {
  id: string
  name: string
  at: string
}

function readStorage(): RecentEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is RecentEntry =>
        typeof e === 'object' && e !== null && typeof (e as RecentEntry).id === 'string',
    )
  } catch {
    return []
  }
}

function writeStorage(entries: RecentEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_LIMIT)))
  } catch {
    /* Speicher voll oder gesperrt - kein Grund, den Nutzer zu stoeren */
  }
}

export function getRecentDocuments(): RecentEntry[] {
  return readStorage()
}

export function rememberRecent(entry: RecentEntry): void {
  const rest = readStorage().filter((e) => e.id !== entry.id)
  writeStorage([entry, ...rest])
}

export function removeRecent(id: string): void {
  writeStorage(readStorage().filter((e) => e.id !== id))
}

export function clearRecentDocuments(): void {
  writeStorage([])
}

/* ------------------------------------------------------------------ */
/* Datei-Download / -Upload                                            */
/* ------------------------------------------------------------------ */

export function documentFilename(doc: SketchDocument): string {
  const base = (doc.meta.name || 'Unbenannt').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Unbenannt'
  return base.toLowerCase().endsWith(OSK_EXTENSION) ? base : `${base}${OSK_EXTENSION}`
}

/** Erzeugt einen Blob im nativen Format. */
export function documentBlob(doc: SketchDocument): Blob {
  return new Blob([serializeDocument(doc, { pretty: true })], { type: 'application/json' })
}

/** Loest den Browser-Download der `.osk`-Datei aus. */
export function saveToFile(doc: SketchDocument, filename?: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new Error('Datei-Download steht in dieser Umgebung nicht zur Verfuegung')
  }
  const blob = documentBlob(doc)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? documentFilename(doc)
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Der Browser braucht den Blob noch einen Tick lang.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Liest eine vom Nutzer gewaehlte `.osk`-Datei. */
export async function loadFromFile(file: File): Promise<SketchDocument> {
  const text = await readFileText(file)
  return deserializeDocument(text)
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader steht in dieser Umgebung nicht zur Verfuegung'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Datei konnte nicht gelesen werden'))
    reader.readAsText(file)
  })
}
