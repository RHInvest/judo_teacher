/**
 * Rechtschreibung aller sichtbaren Texte der Oberflaeche.
 *
 * Der Test liest die Quelldateien und prueft jeden sichtbaren Text auf
 * Ersatzschreibungen. Er ergaenzt die Pruefungen in `registries.test.ts`, die
 * nur die Registries kennen: Toasts, Dialogtexte, Menuebeschriftungen und
 * `aria-label` stehen in keiner Tabelle und wuerden sonst durchrutschen.
 *
 * Bewusst quelltextbasiert und nicht ueber gerenderte Komponenten: die
 * Oberflaechentests laufen ohne DOM, und ein Text, den niemand rendert, ist
 * trotzdem falsch geschrieben.
 *
 * Ausgenommen sind Kommentare und Bezeichner - die bleiben laut
 * ARCHITECTURE.md umlautfrei.
 */

import { describe, expect, it } from 'vitest'
import { findSubstituteSpellings, spellingHint } from './spelling'

/**
 * Alle Quelldateien der Oberflaeche als Rohtext.
 *
 * Bewusst ueber `import.meta.glob` und nicht ueber `node:fs`: die
 * Typkonfiguration des Projekts kennt die Node-Typen nicht, und der Weg ueber
 * den Bundler laeuft ausserdem mit denselben Pfadregeln wie die Anwendung.
 */
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FILES = Object.entries(SOURCES)
  .filter(([path]) => !path.includes('/__tests__/'))
  .sort(([a], [b]) => a.localeCompare(b))

describe('Rechtschreibung der sichtbaren Texte', () => {
  it('findet ueberhaupt Dateien', () => {
    // Ohne diese Zusicherung waere ein leeres Verzeichnis stillschweigend gruen.
    expect(FILES.length).toBeGreaterThan(30)
  })

  it('schreibt jeden sichtbaren Text mit echten Umlauten', () => {
    const problems: string[] = []
    for (const [file, source] of FILES) {
      for (const text of visibleTexts(source)) {
        if (findSubstituteSpellings(text).length === 0) continue
        problems.push(`${file}: ${spellingHint(text)} in "${text.trim().slice(0, 70)}"`)
      }
    }
    expect(problems, `Ersatzschreibungen gefunden:\n${problems.join('\n')}`).toEqual([])
  })

  it('haelt "Maß" und "Mass" nicht nebeneinander', () => {
    // Der haeufigste Rueckfall: eine Datei wird umgestellt, eine zweite nicht,
    // und der Nutzer sieht beide Schreibweisen im selben Fenster.
    let withEszett = 0
    let withDoubleS = 0
    for (const [, source] of FILES) {
      for (const text of visibleTexts(source)) {
        if (/(?<![A-Za-zÄÖÜäöüß])Maß/.test(text)) withEszett += 1
        if (/(?<![A-Za-zÄÖÜäöüß])Mass(?![A-Za-zÄÖÜäöüß])/.test(text)) withDoubleS += 1
      }
    }
    expect(withEszett, 'kein einziges "Maß" gefunden - der Sweep hat nicht gegriffen').toBeGreaterThan(0)
    expect(withDoubleS, '"Mass" steht noch neben "Maß"').toBe(0)
  })
})
