/**
 * Themensteuerung. Dark ist Standard, Light wird ueber `ui.theme` gewaehlt.
 * Es gibt bewusst kein zusaetzliches CSS-File - jedes Token ist eine
 * Tailwind-Klassenkette, die per Kontext an alle Komponenten verteilt wird.
 */

import { createContext, useContext } from 'react'

export interface Skin {
  /** Wurzelflaeche der App */
  app: string
  /** Menue-, Werkzeug- und Statusleiste */
  chrome: string
  /** Panel-Hintergrund */
  panel: string
  /** abgesetzte Flaeche innerhalb eines Panels */
  surface: string
  /** noch tiefer liegende Flaeche (Listen, Raster) */
  well: string
  /** Rahmenfarbe als border-Klasse */
  border: string
  /** duenner Trenner als Hintergrundfarbe */
  divider: string
  /** Primaertext */
  text: string
  /** Sekundaertext */
  muted: string
  /** sehr dezenter Text */
  dim: string
  /** Hover fuer Listeneintraege */
  hover: string
  /** aktiver / selektierter Eintrag */
  selected: string
  /** Eingabefelder */
  input: string
  /** schwebende Flaechen (Menues, Flyouts, Dialoge) */
  floating: string
  /** Schlagschatten fuer schwebende Flaechen */
  shadow: string
  /** Overlay hinter Dialogen */
  scrim: string
  /** Icon-Schaltflaeche im Ruhezustand */
  iconBtn: string
  /** aktive Icon-Schaltflaeche */
  iconBtnActive: string
  /** Sekundaerknopf */
  button: string
  /** Primaerknopf */
  buttonPrimary: string
  /**
   * Fokusring fuer jedes bedienbare Element.
   *
   * Enthaelt bewusst auch `focus-visible:outline-none`: sonst zeichnet der
   * Browser seinen eigenen Umriss zusaetzlich zum Ring, und die Anwendung
   * haette zwei verschiedene Fokusdarstellungen nebeneinander - je nachdem,
   * ob eine Komponente dieses Token benutzt oder ihren Ring selbst schreibt.
   * Wer hier etwas entfernt, muss den Ersatz mitliefern: ein Element ohne
   * sichtbaren Fokus ist mit der Tastatur nicht bedienbar.
   */
  ring: string
  /**
   * Fokusring fuer ein sichtbares Ersatzelement, dessen echtes Eingabefeld
   * unsichtbar darueber liegt (Kontrollkaestchen, Schalter). Der Fokus sitzt
   * dort auf dem `peer`, nicht auf dem gezeichneten Kaestchen.
   */
  ringPeer: string
}

export const DARK: Skin = {
  app: 'bg-panel-900 text-panel-200',
  chrome: 'bg-panel-850',
  panel: 'bg-panel-850',
  surface: 'bg-panel-800',
  well: 'bg-panel-900',
  border: 'border-panel-700',
  divider: 'bg-panel-700',
  text: 'text-panel-100',
  muted: 'text-panel-400',
  dim: 'text-panel-500',
  hover: 'hover:bg-panel-800',
  selected: 'bg-accent-600/25 text-panel-50',
  input: 'bg-panel-900 border-panel-700 text-panel-100 placeholder:text-panel-500',
  floating: 'bg-panel-800 border-panel-700 text-panel-100',
  shadow: 'shadow-float',
  scrim: 'bg-panel-950/70',
  iconBtn: 'text-panel-300 hover:bg-panel-700 hover:text-panel-100',
  iconBtnActive: 'bg-accent-600 text-white hover:bg-accent-600',
  button: 'bg-panel-700 text-panel-100 hover:bg-panel-600 border-panel-600',
  buttonPrimary: 'bg-accent-500 text-white hover:bg-accent-400 border-accent-500',
  ring: 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-400 focus-visible:ring-offset-0',
  ringPeer: 'peer-focus-visible:ring-1 peer-focus-visible:ring-accent-400',
}

export const LIGHT: Skin = {
  app: 'bg-panel-100 text-panel-800',
  chrome: 'bg-panel-50',
  panel: 'bg-panel-50',
  surface: 'bg-panel-100',
  well: 'bg-white',
  border: 'border-panel-300',
  divider: 'bg-panel-300',
  text: 'text-panel-900',
  muted: 'text-panel-500',
  dim: 'text-panel-400',
  hover: 'hover:bg-panel-200',
  selected: 'bg-accent-500/20 text-panel-900',
  input: 'bg-white border-panel-300 text-panel-900 placeholder:text-panel-400',
  floating: 'bg-white border-panel-300 text-panel-900',
  shadow: 'shadow-float',
  scrim: 'bg-panel-600/40',
  iconBtn: 'text-panel-600 hover:bg-panel-200 hover:text-panel-900',
  iconBtnActive: 'bg-accent-500 text-white hover:bg-accent-500',
  button: 'bg-panel-200 text-panel-800 hover:bg-panel-300 border-panel-300',
  buttonPrimary: 'bg-accent-500 text-white hover:bg-accent-400 border-accent-500',
  ring: 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-500 focus-visible:ring-offset-0',
  ringPeer: 'peer-focus-visible:ring-1 peer-focus-visible:ring-accent-500',
}

export const SkinContext = createContext<Skin>(DARK)

export function useSkin(): Skin {
  return useContext(SkinContext)
}

export function skinFor(theme: 'dark' | 'light'): Skin {
  return theme === 'light' ? LIGHT : DARK
}
