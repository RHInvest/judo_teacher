/** OWNERSHIP: Lead. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/ui/App'
import { bootstrap } from '@/app/bootstrap'
import { getToolManager, getViewport } from '@/app/ViewportHost'
import { store } from '@/model/store'
import { bus } from '@/shared/events'
import * as core from '@/core'
import * as units from '@/shared/units'
import './app.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root fehlt in index.html')

/**
 * Oeffentlicher Skript-Zugriff, vergleichbar mit SketchUps Ruby-Konsole.
 *
 * Damit laesst sich das Modell aus der Browserkonsole heraus lesen und
 * veraendern - fuer Automatisierung, Erweiterungen und fuer die
 * Bedienungstests, die gegen den fertigen Build laufen.
 *
 *   OpenSketch.store.getState().addPolyline([...], true)
 *   OpenSketch.core.solidVolume(OpenSketch.store.getState().getActiveGeometry())
 *   OpenSketch.viewport()?.zoomExtents(true)
 *
 * Jede Aenderung gehoert in eine Operation, sonst fehlt sie im Rueckgaengig-
 * Verlauf:  store.getState().operation('Name', () => { ... })
 */
declare global {
  interface Window {
    OpenSketch: {
      store: typeof store
      bus: typeof bus
      core: typeof core
      units: typeof units
      viewport: typeof getViewport
      tools: typeof getToolManager
      version: string
    }
  }
}

window.OpenSketch = {
  store,
  bus,
  core,
  units,
  viewport: getViewport,
  tools: getToolManager,
  version: '1.0.0',
}

bootstrap()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
