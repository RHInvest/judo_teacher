/**
 * Die Persistenz-Fassade aus `../index`.
 *
 * Diese acht Funktionen sind ein vom Lead festgelegter Contract; `@/ui` und
 * `@/app/bootstrap` rufen ausschliesslich sie auf. Sie muessen im Fehlerfall
 * `null` bzw. eine leere Liste liefern, statt zu werfen - sonst haengt der
 * Start der Anwendung an einem kaputten Speicherstand.
 *
 * Die Tests laufen ohne IndexedDB und ohne localStorage; genau das ist auch
 * der Zustand im privaten Fenster eines Browsers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SketchDocument } from '@/shared/types'
import { useStore, resetStoreForTests } from '../store'
import {
  deleteSavedDocument,
  downloadDocument,
  listSavedDocuments,
  loadAutosave,
  loadSavedDocument,
  readDocumentFile,
  saveAutosave,
  saveNamedDocument,
} from '../index'
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_ID,
  cancelAutosave,
  clearAutosave,
  documentBlob,
  documentFilename,
  flushAutosave,
  getRecentDocuments,
  listSlots,
  loadSlot,
  rememberRecent,
  resetPersistenceForTests,
  saveRawForTests,
  scheduleAutosave,
  setSlotThumbnail,
} from '../persistence'
import { deserializeDocument, serializeDocument } from '../serialize'
import { buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
  resetPersistenceForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

const state = () => useStore.getState()

function namedDocument(name: string): SketchDocument {
  state().setDocumentName(name)
  installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 2, 2))
  return state().exportDocument()
}

describe('Benannte Dokumente', () => {
  it('speichern, auflisten, laden, loeschen', async () => {
    const doc = namedDocument('Gartenhaus')
    const id = await saveNamedDocument(doc)
    expect(id).toBeTruthy()

    const list = await listSavedDocuments()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, name: 'Gartenhaus' })
    expect(list[0].modifiedAt).toBe(doc.meta.modifiedAt)

    const loaded = await loadSavedDocument(id)
    expect(loaded).not.toBeNull()
    expect(loaded?.meta.name).toBe('Gartenhaus')
    expect(Object.keys(loaded?.definitions ?? {})).toEqual(Object.keys(doc.definitions))

    await deleteSavedDocument(id)
    expect(await listSavedDocuments()).toEqual([])
    expect(await loadSavedDocument(id)).toBeNull()
  })

  it('derselbe Name landet im selben Slot', async () => {
    const first = await saveNamedDocument(namedDocument('Carport'))
    state().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 })
    const second = await saveNamedDocument(state().exportDocument())

    expect(second).toBe(first)
    expect(await listSavedDocuments()).toHaveLength(1)
    const loaded = await loadSavedDocument(first)
    expect(Object.keys(loaded?.definitions[loaded.rootId].geometry.edges ?? {})).toHaveLength(5)
  })

  it('listet neueste zuerst und laesst den Autosave-Slot aus', async () => {
    vi.useFakeTimers()

    vi.setSystemTime(new Date('2024-01-01T10:00:00.000Z'))
    await saveNamedDocument(namedDocument('Alt'))
    vi.setSystemTime(new Date('2024-01-02T10:00:00.000Z'))
    await saveNamedDocument(namedDocument('Neu'))
    await saveAutosave(state().exportDocument())

    const list = await listSavedDocuments()
    expect(list.map((entry) => entry.name)).toEqual(['Neu', 'Alt'])
    expect(list.some((entry) => entry.id === AUTOSAVE_ID)).toBe(false)
    // Ueber die interne API ist der Autosave sehr wohl sichtbar
    expect((await listSlots({ includeAutosave: true })).some((entry) => entry.id === AUTOSAVE_ID)).toBe(true)
  })

  it('ein unlesbarer Slot bringt weder Liste noch Laden zu Fall', async () => {
    await saveNamedDocument(namedDocument('Heil'))
    saveRawForTests('doc-kaputt', 'kein json')

    // Die Liste kommt aus den Metadaten und bleibt vollstaendig
    expect(await listSavedDocuments()).toHaveLength(2)
    expect(await loadSavedDocument('doc-kaputt')).toBeNull()
    expect(await loadSavedDocument('gibtsnicht')).toBeNull()
  })

  it('haengt nachtraeglich ein Vorschaubild an', async () => {
    const id = await saveNamedDocument(namedDocument('Mit Bild'))
    await setSlotThumbnail(id, 'data:image/png;base64,ZZZZ')

    const list = await listSlots()
    expect(list.find((entry) => entry.id === id)?.thumbnail).toBe('data:image/png;base64,ZZZZ')
    // Das Dokument selbst bleibt lesbar
    expect(await loadSlot(id)).not.toBeNull()
    // Eine unbekannte Id tut einfach nichts
    await expect(setSlotThumbnail('gibtsnicht', 'x')).resolves.toBeUndefined()
  })
})

describe('Autosave', () => {
  it('schreibt gedrosselt und nur einmal', async () => {
    vi.useFakeTimers()
    const doc = namedDocument('Getippt')

    scheduleAutosave(doc)
    scheduleAutosave(doc)
    scheduleAutosave(doc)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1)
    expect(await loadAutosave()).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    const saved = await loadAutosave()
    expect(saved?.meta.name).toBe('Getippt')
  })

  it('cancelAutosave verwirft den geplanten Schreibvorgang', async () => {
    vi.useFakeTimers()
    scheduleAutosave(namedDocument('Doch nicht'))
    cancelAutosave()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    expect(await loadAutosave()).toBeNull()
  })

  it('flushAutosave schreibt sofort - auch vor Ablauf der Wartezeit', async () => {
    vi.useFakeTimers()
    scheduleAutosave(namedDocument('Vor dem Schliessen'))

    await flushAutosave()
    expect((await loadAutosave())?.meta.name).toBe('Vor dem Schliessen')

    // Danach ist nichts mehr geplant
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    await flushAutosave()
    expect((await loadAutosave())?.meta.name).toBe('Vor dem Schliessen')
  })

  it('clearAutosave raeumt den Slot ab', async () => {
    await saveAutosave(namedDocument('Weg damit'))
    expect(await loadAutosave()).not.toBeNull()

    await clearAutosave()
    expect(await loadAutosave()).toBeNull()
  })
})

describe('Dateien', () => {
  it('liest eine .osk-Datei ein', async () => {
    const doc = namedDocument('Aus der Datei')
    const file = new File([serializeDocument(doc, { pretty: true })], 'aus-der-datei.osk', {
      type: 'application/json',
    })

    const loaded = await readDocumentFile(file)
    expect(loaded.meta.name).toBe('Aus der Datei')
    expect(loaded).toEqual(deserializeDocument(serializeDocument(doc)))
  })

  it('eine kaputte Datei meldet sich mit Klartext', async () => {
    const file = new File(['{ kaputt'], 'kaputt.osk', { type: 'application/json' })
    await expect(readDocumentFile(file)).rejects.toThrow(/JSON/)
  })

  it('documentFilename saeubert den Namen und haengt die Endung an', () => {
    const doc = namedDocument('Haus')
    expect(documentFilename(doc)).toBe('Haus.osk')

    // Zeichen, die kein Dateisystem mag, werden ersetzt - Gross/Klein bleibt
    expect(documentFilename({ ...doc, meta: { ...doc.meta, name: 'Plan: 1/2 <Entwurf>' } })).toBe(
      'Plan_ 1_2 _Entwurf_.osk',
    )
    expect(documentFilename({ ...doc, meta: { ...doc.meta, name: '' } })).toBe('Unbenannt.osk')
    // Eine schon vorhandene Endung wird nicht verdoppelt
    expect(documentFilename({ ...doc, meta: { ...doc.meta, name: 'schon.osk' } })).toBe('schon.osk')
    expect(documentFilename({ ...doc, meta: { ...doc.meta, name: 'Gross.OSK' } })).toBe('Gross.OSK')
  })

  it('documentBlob enthaelt lesbares, eingeruecktes JSON', async () => {
    const doc = namedDocument('Blob')
    const blob = documentBlob(doc)
    expect(blob.type).toBe('application/json')

    const text = await blob.text()
    expect(text).toContain('\n  ')
    expect(deserializeDocument(text).meta.name).toBe('Blob')
  })

  it('ohne Browser meldet der Download einen klaren Fehler', () => {
    // In dieser Umgebung gibt es kein `document` - der Nutzer bekaeme sonst
    // eine ReferenceError-Kaskade statt einer Meldung.
    expect(() => downloadDocument(namedDocument('Kein Browser'))).toThrow(
      /steht in dieser Umgebung nicht zur Verfuegung/,
    )
  })
})

describe('Zuletzt geoeffnet ohne localStorage', () => {
  it('liefert eine leere Liste, statt zu werfen', async () => {
    expect(getRecentDocuments()).toEqual([])
    expect(() => rememberRecent({ id: 'x', name: 'X', at: new Date(0).toISOString() })).not.toThrow()
    expect(getRecentDocuments()).toEqual([])

    // Und das Laden ueber die Fassade, das intern `rememberRecent` ruft, geht trotzdem
    const id = await saveNamedDocument(namedDocument('Ohne Verlauf'))
    expect(await loadSavedDocument(id)).not.toBeNull()
  })
})
