/**
 * SICHTBARE TEXTE TRAGEN ECHTE UMLAUTE.
 *
 * Die Werkzeugschicht schreibt Statushinweise, Massfeld-Beschriftungen,
 * Kurzmeldungen, Operationsnamen (Rueckgaengig-Liste) und Inferenzlabels -
 * alles steht in derselben Statuszeile wie die Texte der Oberflaeche. Stuenden
 * hier Ersatzschreibungen ("Laenge", "Flaeche"), saehe der Nutzer beide
 * Schreibweisen nebeneinander.
 *
 * Bezeichner, Kommentare und Konsolenmeldungen bleiben ausdruecklich
 * umlautfrei - geprueft werden nur Zeichenketten im Quelltext, und
 * `console.*`-Aufrufe werden vorher entfernt.
 *
 * Die Wortliste kommt UNVERAENDERT von `ui-dev` (`src/ui/__tests__/spelling.ts`).
 * Sie wird bewusst importiert statt kopiert: zwei Listen laufen auseinander,
 * eine nicht. Es ist ein reiner Testbezug - der Auslieferungsstand der
 * Werkzeugschicht kennt `@/ui` nicht.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSubstituteSpellings, spellingHint } from '@/ui/__tests__/spelling'
import { INFERENCE_LABELS } from '../inference'
import { TOOL_FACTORIES, TOOL_NAMES } from '../toolManager'
import type { ToolId } from '@/shared/types'

const TOOLS_DIR = new URL('..', import.meta.url).pathname

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/**
 * Zeichenketten aus dem Quelltext - ohne Kommentare und ohne
 * `console.*`-Aufrufe, denn beides ist Entwicklertext.
 */
function stringLiterals(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/console\.\w+\([\s\S]*?\)\n/g, '')
  return code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []
}

describe('Sichtbare Texte der Werkzeugschicht', () => {
  it('nutzt in jeder Zeichenkette echte Umlaute und Eszett', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(TOOLS_DIR)) {
      for (const literal of stringLiterals(readFileSync(file, 'utf8'))) {
        const hint = spellingHint(literal)
        if (hint) offenders.push(`${file.split('/src/')[1]}: ${literal.trim()} (${hint})`)
      }
    }
    expect(offenders).toEqual([])
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
