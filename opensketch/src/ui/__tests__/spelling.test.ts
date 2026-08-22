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
 * Typkonfiguration des Projekts bindet weder die Node- noch die
 * `vite/client`-Typen ein. Der Cast liefert deshalb die Signatur, die der
 * Bundler zur Laufzeit ohnehin erfuellt.
 */
type GlobFn = (
  pattern: string,
  options: { query: string; import: string; eager: true },
) => Record<string, string>

const SOURCES = (import.meta as unknown as { glob: GlobFn }).glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * Ersetzt Kommentare durch Leerzeichen und laesst Zeichenketten stehen.
 *
 * Ein blosses Streichen der Blockkommentare per regulaerem Ausdruck wuerde an
 * Zeichenketten scheitern, die selbst eine Kommentarklammer enthalten -
 * deshalb der kleine Zustandsautomat.
 */
function stripComments(source: string): string {
  const out: string[] = []
  let index = 0
  let mode = ''
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1] ?? ''
    if (mode === '') {
      if (char === '/' && next === '/') {
        mode = 'line'
        index += 2
        continue
      }
      if (char === '/' && next === '*') {
        mode = 'block'
        index += 2
        continue
      }
      if (char === '"' || char === "'" || char === '`') mode = char
      out.push(char)
      index += 1
      continue
    }
    if (mode === 'line') {
      if (char === '\n') {
        mode = ''
        out.push('\n')
      }
      index += 1
      continue
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = ''
        index += 2
        continue
      }
      if (char === '\n') out.push('\n')
      index += 1
      continue
    }
    if (char === '\\') {
      out.push(char, next)
      index += 2
      continue
    }
    if (char === mode) mode = ''
    out.push(char)
    index += 1
  }
  return out.join('')
}

/** Zeichenketten und JSX-Text einer Datei. */
function visibleTexts(source: string): string[] {
  const code = stripComments(source)
  const texts: string[] = []
  for (const pattern of [/"([^"\n]*)"/g, /'([^'\n]*)'/g, /`([^`]*)`/g]) {
    for (const match of code.matchAll(pattern)) texts.push(match[1])
  }
  for (const match of code.matchAll(/>([^<>{}"'`]*)</g)) texts.push(match[1])
  return texts
}

/*
 * Das Muster ist relativ zu dieser Datei: Geschwister im Testverzeichnis
 * erscheinen als "./name.ts" und muessen heraus - geprueft wird die
 * Anwendung, nicht ihre Tests.
 */
const FILES = Object.entries(SOURCES)
  .filter(([path]) => !path.startsWith('./') && !path.includes('/__tests__/'))
  .sort(([a], [b]) => a.localeCompare(b))

describe('Rechtschreibung der sichtbaren Texte', () => {
  it('findet ueberhaupt Dateien', () => {
    // Ohne diese Zusicherung waere ein leeres Ergebnis stillschweigend gruen.
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

  it('haelt die beiden Schreibweisen des Wortes Mass nicht nebeneinander', () => {
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
    expect(withEszett, 'kein einziges Maszeichen gefunden - die Umstellung hat nicht gegriffen').toBeGreaterThan(0)
    expect(withDoubleS, 'die alte Schreibweise steht noch neben der neuen').toBe(0)
  })
})
