/**
 * Anwendungsverdrahtung.
 * OWNERSHIP: Lead. Andere Entwickler aendern diese Datei nicht.
 *
 * Verbindet die Module ueber den Event-Bus, ohne dass sie voneinander wissen:
 *  - Dokument beim Start laden (Autosave) oder neu anlegen
 *  - Autosave nach Aenderungen
 *  - Dateiimport per Drag & Drop
 *  - Komponenten aus der Bibliothek platzieren
 *  - Kamerabefehle und Szenenwechsel an den Viewport durchreichen
 *  - Warnung vor dem Schliessen bei ungesicherten Aenderungen
 */

import { bus } from '@/shared/events'
import { store } from '@/model/store'
import { loadAutosave, saveAutosave } from '@/model'
import { IDENTITY_MATRIX } from '@/shared/types'
import { getViewport } from './ViewportHost'

let initialized = false
const disposers: (() => void)[] = []

/** Ruft `fn` auf und schluckt Fehler aus noch nicht fertigen Modulen. */
function safe<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn()
  } catch (err) {
    console.warn(`[app] ${label}:`, err instanceof Error ? err.message : err)
    return undefined
  }
}

async function restoreOrCreateDocument(): Promise<void> {
  const state = safe('Store nicht bereit', () => store.getState())
  if (!state) return

  const loaded = await loadAutosave().catch((err) => {
    console.warn('[app] Autosave laden fehlgeschlagen', err)
    return null
  })
  if (loaded) {
    const ok = safe('Dokument uebernehmen', () => {
      store.getState().loadDocument(loaded)
      return true
    })
    if (ok) {
      bus.emit('document:loaded')
      return
    }
  }
  safe('Neues Dokument', () => store.getState().newDocument('metric'))
  bus.emit('document:loaded')
}

function wireAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = safe('Autosave-Abo', () =>
    store.subscribe((state, prev) => {
      const changed =
        state.geometryRevision !== prev.geometryRevision ||
        state.sceneRevision !== prev.sceneRevision ||
        state.materialRevision !== prev.materialRevision ||
        state.styleRevision !== prev.styleRevision
      if (!changed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void saveAutosave(store.getState().exportDocument()).catch((err) =>
          console.warn('[app] Autosave fehlgeschlagen', err),
        )
      }, 2000)
    }),
  )
  if (unsubscribe) disposers.push(unsubscribe)
  disposers.push(() => {
    if (timer) clearTimeout(timer)
  })
}

function wireImport(): void {
  disposers.push(
    bus.on('file:import', ({ file }) => {
      void (async () => {
        const state = store.getState()
        state.setBusy(`Importiere ${file.name} ...`)
        try {
          const io = await import('@/io')
          const result = await io.importFile(file)
          state.operation(`Import ${file.name}`, () => {
            for (const def of result.definitions) state.upsertDefinition(def)
            for (const material of result.materials) state.addMaterial(material)
            for (const texture of result.textures) state.addTexture(texture)
            state.placeInstance(result.rootDefinitionId, IDENTITY_MATRIX)
          })
          for (const warning of result.warnings) state.toast(warning, 'warn')
          state.toast(`${file.name} importiert`, 'success')
          getViewport()?.zoomExtents(true)
        } catch (err) {
          console.error('[app] Import fehlgeschlagen', err)
          store.getState().toast(`Import fehlgeschlagen: ${err instanceof Error ? err.message : err}`, 'error')
        } finally {
          store.getState().setBusy(null)
        }
      })()
    }),
  )
}

function wirePlacement(): void {
  disposers.push(
    bus.on('component:place', ({ definitionId }) => {
      safe('Komponente platzieren', () => {
        const state = store.getState()
        const id = state.operation('Komponente platzieren', () => state.placeInstance(definitionId, IDENTITY_MATRIX))
        state.setSelection({ edgeIds: [], faceIds: [], vertexIds: [], entityIds: [id] })
        state.setActiveTool('move')
      })
    }),
  )
}

function wireCamera(): void {
  disposers.push(
    bus.on('camera:command', ({ command, view }) => {
      const vp = getViewport()
      if (!vp) return
      safe('Kamerabefehl', () => {
        switch (command) {
          case 'zoomExtents':
            vp.zoomExtents(true)
            break
          case 'zoomSelection':
            vp.zoomSelection(true)
            break
          case 'standardView':
            if (view) vp.setStandardView(view, true)
            break
          case 'toggleProjection':
            vp.setProjection(vp.getCamera().projection === 'perspective' ? 'parallel' : 'perspective')
            break
        }
      })
    }),
  )

  disposers.push(
    bus.on('scene:activate', (scene) => {
      safe('Szene aktivieren', () => getViewport()?.animateToScene(scene))
    }),
  )
}

function wireUnloadGuard(): void {
  const handler = (e: BeforeUnloadEvent) => {
    const dirty = safe('Dirty-Status', () => store.getState().dirty)
    if (dirty) {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', handler)
  disposers.push(() => window.removeEventListener('beforeunload', handler))
}


/** Wird einmalig aus `main.tsx` aufgerufen. */
export function bootstrap(): void {
  if (initialized) return
  initialized = true
  wireAutosave()
  wireImport()
  wirePlacement()
  wireCamera()
  wireUnloadGuard()
  void restoreOrCreateDocument()
}

export function disposeApp(): void {
  for (const dispose of disposers.splice(0)) {
    try {
      dispose()
    } catch {
      /* ignorieren */
    }
  }
  initialized = false
}
