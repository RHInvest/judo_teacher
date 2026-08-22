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

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSubstituteSpellings, spellingHint } from './spelling'

const ROOT = new URL('..', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__') continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(path)
    }
  }
  return out
}

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

const FILES = sourceFiles(ROOT)

describe('Rechtschreibung der sichtbaren Texte', () => {
  it('findet ueberhaupt Dateien', () => {
    // Ohne diese Zusicherung waere ein leeres Verzeichnis stillschweigend gruen.
    expect(FILES.length).toBeGreaterThan(30)
  })

  it('schreibt jeden sichtbaren Text mit echten Umlauten', () => {
    const problems: string[] = []
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8')
      for (const text of visibleTexts(source)) {
        const found = findSubstituteSpellings(text)
        if (found.length === 0) continue
        problems.push(`${file.slice(ROOT.length)}: ${spellingHint(text)} in "${text.trim().slice(0, 70)}"`)
      }
    }
    expect(problems, `Ersatzschreibungen gefunden:\n${problems.join('\n')}`).toEqual([])
  })

  it('haelt "Maß" und "Mass" nicht nebeneinander', () => {
    // Der haeufigste Rueckfall: eine Datei wird umgestellt, eine zweite nicht,
    // und der Nutzer sieht beide Schreibweisen im selben Fenster.
    let withEszett = 0
    let withDoubleS = 0
    for (const file of FILES) {
      for (const text of visibleTexts(readFileSync(file, 'utf8'))) {
        if (/(?<![A-Za-zÄÖÜäöüß])Maß/.test(text)) withEszett += 1
        if (/(?<![A-Za-zÄÖÜäöüß])Mass(?![A-Za-zÄÖÜäöüß])/.test(text)) withDoubleS += 1
      }
    }
    expect(withEszett, 'kein einziges "Maß" gefunden - der Sweep hat nicht gegriffen').toBeGreaterThan(0)
    expect(withDoubleS, '"Mass" steht noch neben "Maß"').toBe(0)
  })
})
