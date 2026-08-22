/**
 * Platzverhalten bei 1280 px Fensterbreite.
 *
 * 1280 px ist die schmalste Breite, auf der die Oberflaeche vollstaendig
 * arbeiten soll - darunter klappt der Tray auf die Symbolleiste zusammen.
 * Geprueft wird zweierlei:
 *
 *  1. die festen Breiten des Rahmens, damit dem Viewport genug bleibt;
 *  2. die Bauregeln der Statusleiste, denn dort entscheidet sich, ob eine
 *     Beschriftung abgeschnitten wird.
 *
 * Zu 2: In einer Flexzeile weicht dasjenige Element, das schrumpfen darf.
 * Genau ein Element der Statusleiste darf das sein - der Werkzeughinweis
 * links, und der traegt `truncate`, wird also sauber mit Auslassungspunkten
 * gekuerzt. Massfeld und Modellstatistik stehen auf `shrink-0` und behalten
 * ihre Breite. Faellt eines dieser Merkmale weg, quetscht die Zeile
 * stattdessen die Zahlen zusammen, und aus "1.234" wird "1.2...".
 *
 * Der Test liest die Quelltexte, weil die Oberflaechentests ohne DOM laufen.
 * Er kann damit keine echten Pixel messen, aber genau die Bauregeln
 * festhalten, aus denen sich das Verhalten ergibt.
 */

import { describe, expect, it } from 'vitest'
import { TRAY_COLLAPSE_WIDTH } from '@/ui/panels/Tray'

type GlobFn = (
  pattern: string,
  options: { query: string; import: string; eager: true },
) => Record<string, string>

const SOURCES = (import.meta as unknown as { glob: GlobFn }).glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function source(path: string): string {
  const entry = Object.entries(SOURCES).find(([key]) => key.endsWith(path))
  if (!entry) throw new Error(`Quelldatei nicht gefunden: ${path}`)
  return entry[1]
}

/** Zielbreite, ab der die Oberflaeche vollstaendig dargestellt werden soll. */
const TARGET_WIDTH = 1280

/* Feste Breiten aus den Tailwind-Klassen der Rahmenelemente. */
const TOOL_PALETTE_WIDTH = 40 // w-10
const TRAY_WIDTH = 292 // w-[292px]

describe('Rahmen bei 1280 px', () => {
  it('zeigt den Tray bei 1280 px in voller Breite', () => {
    // Unterhalb dieser Schwelle klappt der Tray zusammen. Liegt sie ueber
    // 1280, saehe der Nutzer auf einem gaengigen Notebook nur noch Symbole.
    expect(TRAY_COLLAPSE_WIDTH).toBeLessThan(TARGET_WIDTH)
  })

  it('laesst dem Viewport genug Platz', () => {
    const viewport = TARGET_WIDTH - TOOL_PALETTE_WIDTH - TRAY_WIDTH
    expect(viewport).toBeGreaterThanOrEqual(900)
  })

  it('haelt die angenommenen Breiten mit den Klassen im Quelltext zusammen', () => {
    // Aendert jemand die Klassen, muessen auch die Zahlen oben mitwandern.
    expect(source('toolbars/ToolPalette.tsx')).toContain('w-10')
    expect(source('panels/Tray.tsx')).toContain('w-[292px]')
  })
})

describe('Statusleiste bei 1280 px', () => {
  const statusBar = source('toolbars/StatusBar.tsx')
  const measurementBox = source('toolbars/MeasurementBox.tsx')

  it('laesst nur den Werkzeughinweis schrumpfen', () => {
    expect(statusBar, 'Hinweisbereich ohne min-w-0 flex-1').toContain('min-w-0 flex-1')
  })

  it('kuerzt den Werkzeughinweis mit Auslassungspunkten statt ihn zu ueberlaufen', () => {
    expect(statusBar, 'Hinweis ohne truncate').toContain("'min-w-0 truncate'")
  })

  it('haelt die Modellstatistik auf fester Breite', () => {
    // Ohne shrink-0 schrumpfen bei langem Hinweis die Zahlen statt des Textes.
    expect(statusBar).toMatch(/flex shrink-0 items-center gap-[\d.]+ border-l pl-3/)
  })

  it('haelt das Massfeld auf fester Breite', () => {
    expect(measurementBox).toContain('flex shrink-0 items-center')
    expect(measurementBox, 'Eingabefeld ohne feste Breite').toContain('w-[132px]')
  })

  it('beschriftet alle fuenf Kennwerte', () => {
    for (const label of ['Flächen', 'Kanten', 'Instanzen', 'Dreiecke', 'Bildrate']) {
      expect(statusBar, `Kennwert "${label}" fehlt`).toContain(`title="${label}"`)
    }
  })

  it('laesst dem Werkzeughinweis auch im ungünstigsten Fall Platz', () => {
    /*
     * Grobe Abschaetzung bei 11 px Schriftgroesse: rund 6 px je Zeichen,
     * Ziffern in `tabular-nums` etwas schmaler. Sie muss nicht exakt sein -
     * sie soll melden, wenn ein weiterer Kennwert die Zeile sprengt.
     */
    const charWidth = 6
    const iconWidth = 12
    const innerGap = 4 // gap-1 zwischen Symbol und Zahl
    const outerGap = 10 // gap-2.5 zwischen den Kennwerten

    // Sechsstellige Zahlen decken Modelle bis 999.999 Elemente ab.
    const values = ['999.999', '999.999', '999.999', '999.999', '999 fps']
    const stats =
      values.reduce((sum, value) => sum + iconWidth + innerGap + value.length * charWidth, 0) +
      outerGap * (values.length - 1) +
      13 // border-l + pl-3

    const vcb = 'Kantenlänge'.length * charWidth + 6 + 132 // Etikett + Abstand + Eingabefeld
    const padding = 2 * 8 // px-2
    const gaps = 2 * 12 // gap-3 zwischen den drei Bloecken

    const remaining = TARGET_WIDTH - stats - vcb - padding - gaps
    expect(remaining, `nur ${remaining} px fuer den Werkzeughinweis`).toBeGreaterThan(400)
  })
})
