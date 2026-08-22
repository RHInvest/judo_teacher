/**
 * SICHTBARE TEXTE TRAGEN ECHTE UMLAUTE.
 *
 * Die Werkzeugschicht schreibt Statushinweise, Beschriftungen des Massfelds,
 * Kurzmeldungen, Operationsnamen (Rueckgaengig-Liste) und die Inferenzlabels.
 * Alles davon steht in derselben Statuszeile wie die Texte der Oberflaeche -
 * stuenden hier Ersatzschreibungen ("Laenge", "Flaeche"), saehe der Nutzer
 * beide Schreibweisen nebeneinander.
 *
 * Bezeichner und Kommentare bleiben laut ARCHITECTURE.md umlautfrei und
 * werden deshalb ausgenommen.
 *
 * Zwei Dinge sind bewusst von `ui-dev` uebernommen, damit die beiden
 * Pruefungen nicht auseinanderlaufen:
 *  - die Wortliste (`src/ui/__tests__/spelling.ts`) wird IMPORTIERT, nicht
 *    kopiert. Es ist ein reiner Testbezug; der Auslieferungsstand der
 *    Werkzeugschicht kennt `@/ui` nicht.
 *  - der Weg zu den Quelldateien: `import.meta.glob` statt `node:fs`, weil
 *    das Projekt bewusst keine Node-Typen einbindet.
 */

import { describe, expect, it } from 'vitest'
import { findSubstituteSpellings, spellingHint } from '@/ui/__tests__/spelling'
import { INFERENCE_LABELS } from '../inference'
import { TOOL_FACTORIES, TOOL_NAMES } from '../toolManager'
import type { ToolId } from '@/shared/types'

/** Signatur von `import.meta.glob`; die `vite/client`-Typen sind nicht eingebunden. */
type GlobFn = (
  pattern: string,
  options: { query: string; import: string; eager: true },
) => Record<string, string>

const SOURCES = (import.meta as unknown as { glob: GlobFn }).glob('../**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * Ersetzt Kommentare durch Leerzeichen und laesst Zeichenketten stehen.
 *
 * Ein blosses Streichen per regulaerem Ausdruck scheitert an Zeichenketten,
 * die selbst eine Kommentarklammer enthalten ("https://..."), deshalb der
 * kleine Zustandsautomat - derselbe wie in `src/ui/__tests__/spelling.test.ts`.
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

/** Alle Zeichenketten einer Datei. */
function visibleTexts(source: string): string[] {
  const code = stripComments(source)
  const texts: string[] = []
  for (const pattern of [/"([^"\n]*)"/g, /'([^'\n]*)'/g, /`([^`]*)`/g]) {
    for (const match of code.matchAll(pattern)) texts.push(match[1])
  }
  return texts
}

/* Geschwister im Testverzeichnis erscheinen als "./name.ts" - geprueft wird
 * die Anwendung, nicht ihre Tests. */
const FILES = Object.entries(SOURCES)
  .filter(([path]) => !path.startsWith('./') && !path.includes('/__tests__/'))
  .sort(([a], [b]) => a.localeCompare(b))

describe('Rechtschreibung der Werkzeugschicht', () => {
  it('findet überhaupt Dateien', () => {
    // Ohne diese Zusicherung waere ein leeres Ergebnis stillschweigend gruen.
    expect(FILES.length).toBeGreaterThan(25)
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

  it('beschriftet jede Inferenz richtig', () => {
    for (const label of Object.values(INFERENCE_LABELS)) {
      expect(findSubstituteSpellings(label), spellingHint(label)).toEqual([])
    }
  })

  it('benennt jedes Werkzeug richtig - Name und Statushinweis', () => {
    for (const [id, name] of Object.entries(TOOL_NAMES)) {
      expect(findSubstituteSpellings(name), `${id}: ${spellingHint(name)}`).toEqual([])
      const tool = TOOL_FACTORIES[id as ToolId]?.()
      if (!tool) continue
      expect(findSubstituteSpellings(tool.name), `${id}: ${spellingHint(tool.name)}`).toEqual([])
      expect(findSubstituteSpellings(tool.hint), `${id}: ${spellingHint(tool.hint)}`).toEqual([])
    }
  })
})
