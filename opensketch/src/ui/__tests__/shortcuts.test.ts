/**
 * Kuerzel-Parser und Abgleich der Kuerzeltabellen.
 *
 * Verbindlich ist `TOOL_SHORTCUTS` aus `@/tools`; die Oberflaeche haelt in
 * `DEFAULT_TOOL_SHORTCUTS` nur eine Rueckfallbelegung fuer den Fall, dass die
 * Werkzeugschicht noch nicht antwortet. Laufen die beiden auseinander, zeigt
 * das Menue ein anderes Kuerzel an, als die Tastatur ausloest - das faengt
 * dieser Test.
 */

import { describe, expect, it } from 'vitest'
import type { ToolId } from '@/shared/types'
import { TOOL_SHORTCUTS } from '@/tools'
import {
  DEFAULT_TOOL_SHORTCUTS,
  MENU_SHORTCUTS,
  allToolShortcuts,
  findToolForEvent,
  matchesCombo,
  parseCombo,
  toolShortcut,
} from '@/ui/lib/shortcuts'
import { TOOL_META } from '@/ui/lib/tools'

/** Minimaler Ersatz fuer ein KeyboardEvent - der Vergleich liest nur diese Felder. */
function keyEvent(init: {
  key: string
  code?: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? (init.key === ' ' ? 'Space' : `Key${init.key.toUpperCase()}`),
    ctrlKey: init.ctrl ?? false,
    shiftKey: init.shift ?? false,
    altKey: init.alt ?? false,
    metaKey: init.meta ?? false,
  } as KeyboardEvent
}

/* ------------------------------------------------------------------ */
/* parseCombo                                                          */
/* ------------------------------------------------------------------ */

describe('parseCombo', () => {
  it('liest einzelne Buchstaben', () => {
    expect(parseCombo('L')).toEqual({ key: 'L', ctrl: false, shift: false, alt: false })
  })

  it('normalisiert Kleinschreibung', () => {
    expect(parseCombo('l')?.key).toBe('L')
  })

  it('liest die deutschen Modifikatornamen', () => {
    expect(parseCombo('Strg+S')).toEqual({ key: 'S', ctrl: true, shift: false, alt: false })
    expect(parseCombo('Umschalt+R')).toEqual({ key: 'R', ctrl: false, shift: true, alt: false })
    expect(parseCombo('Alt+A')).toEqual({ key: 'A', ctrl: false, shift: false, alt: true })
  })

  it('liest die englischen Modifikatornamen mit', () => {
    expect(parseCombo('Ctrl+Shift+S')).toEqual({ key: 'S', ctrl: true, shift: true, alt: false })
  })

  it('kombiniert mehrere Modifikatoren', () => {
    expect(parseCombo('Alt+Umschalt+A')).toEqual({ key: 'A', ctrl: false, shift: true, alt: true })
    expect(parseCombo('Strg+Umschalt+S')).toEqual({ key: 'S', ctrl: true, shift: true, alt: false })
  })

  it('uebersetzt benannte Tasten', () => {
    expect(parseCombo('Leertaste')?.key).toBe(' ')
    expect(parseCombo('Entf')?.key).toBe('DELETE')
    expect(parseCombo('Esc')?.key).toBe('ESCAPE')
    expect(parseCombo('Eingabe')?.key).toBe('ENTER')
    expect(parseCombo('Pos1')?.key).toBe('HOME')
  })

  it('hält Funktionstasten unveraendert', () => {
    expect(parseCombo('F1')?.key).toBe('F1')
    expect(parseCombo('F2')?.key).toBe('F2')
  })

  it('vertraegt Leerzeichen um die Teile', () => {
    expect(parseCombo(' Strg + S ')).toEqual({ key: 'S', ctrl: true, shift: false, alt: false })
  })

  it('liefert null ohne Taste', () => {
    expect(parseCombo('')).toBeNull()
    expect(parseCombo('Strg')).toBeNull()
    expect(parseCombo('Strg+Umschalt')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* matchesCombo                                                        */
/* ------------------------------------------------------------------ */

describe('matchesCombo', () => {
  it('trifft den einfachen Buchstaben', () => {
    const combo = parseCombo('R')!
    expect(matchesCombo(keyEvent({ key: 'r' }), combo)).toBe(true)
    expect(matchesCombo(keyEvent({ key: 'R', shift: true }), combo)).toBe(false)
  })

  it('unterscheidet Umschalt-Varianten', () => {
    const plain = parseCombo('R')!
    const shifted = parseCombo('Umschalt+R')!
    const event = keyEvent({ key: 'R', shift: true })
    expect(matchesCombo(event, plain)).toBe(false)
    expect(matchesCombo(event, shifted)).toBe(true)
  })

  it('behandelt die Meta-Taste wie Strg', () => {
    const combo = parseCombo('Strg+S')!
    expect(matchesCombo(keyEvent({ key: 's', meta: true }), combo)).toBe(true)
    expect(matchesCombo(keyEvent({ key: 's', ctrl: true }), combo)).toBe(true)
  })

  it('trifft die Leertaste über den Code', () => {
    const combo = parseCombo('Leertaste')!
    expect(matchesCombo(keyEvent({ key: ' ', code: 'Space' }), combo)).toBe(true)
  })

  it('verlangt fehlende Modifikatoren ausdruecklich', () => {
    const combo = parseCombo('E')!
    expect(matchesCombo(keyEvent({ key: 'e', ctrl: true }), combo)).toBe(false)
    expect(matchesCombo(keyEvent({ key: 'e', alt: true }), combo)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* findToolForEvent                                                    */
/* ------------------------------------------------------------------ */

describe('findToolForEvent', () => {
  it('findet die Werkzeuge der Grundbelegung', () => {
    expect(findToolForEvent(keyEvent({ key: 'l' }))).toBe('line')
    expect(findToolForEvent(keyEvent({ key: 'r' }))).toBe('rectangle')
    expect(findToolForEvent(keyEvent({ key: 'p' }))).toBe('pushpull')
    expect(findToolForEvent(keyEvent({ key: 'm' }))).toBe('move')
  })

  it('unterscheidet Kürzel mit und ohne Umschalt', () => {
    expect(findToolForEvent(keyEvent({ key: 'R', shift: true }))).toBe('rotatedRectangle')
    expect(findToolForEvent(keyEvent({ key: 'C', shift: true }))).toBe('polygon')
    expect(findToolForEvent(keyEvent({ key: 'c' }))).toBe('circle')
  })

  it('unterscheidet die vier Bogenwerkzeuge', () => {
    expect(findToolForEvent(keyEvent({ key: 'a' }))).toBe('arc2')
    expect(findToolForEvent(keyEvent({ key: 'A', shift: true }))).toBe('arc3')
    expect(findToolForEvent(keyEvent({ key: 'a', alt: true }))).toBe('arc')
    expect(findToolForEvent(keyEvent({ key: 'A', shift: true, alt: true }))).toBe('pie')
  })

  it('findet die Leertaste als Auswahlwerkzeug', () => {
    expect(findToolForEvent(keyEvent({ key: ' ', code: 'Space' }))).toBe('select')
    expect(findToolForEvent(keyEvent({ key: ' ', code: 'Space', shift: true }))).toBe('lasso')
  })

  it('greift bei Strg-Kombinationen nicht zu', () => {
    // Strg+S ist "Speichern" und darf nie das Skalierwerkzeug aktivieren.
    expect(findToolForEvent(keyEvent({ key: 's', ctrl: true }))).toBeNull()
    expect(findToolForEvent(keyEvent({ key: 'z', ctrl: true }))).toBeNull()
    expect(findToolForEvent(keyEvent({ key: 'a', ctrl: true }))).toBeNull()
  })

  it('liefert null für unbelegte Tasten', () => {
    expect(findToolForEvent(keyEvent({ key: 'F9', code: 'F9' }))).toBeNull()
    expect(findToolForEvent(keyEvent({ key: 'ArrowUp', code: 'ArrowUp' }))).toBeNull()
  })

  it('findet zu jedem Kürzel aus TOOL_SHORTCUTS das richtige Werkzeug', () => {
    for (const [display, expected] of Object.entries(TOOL_SHORTCUTS)) {
      const combo = parseCombo(display)
      expect(combo, `"${display}" ist nicht lesbar`).not.toBeNull()
      const event = keyEvent({
        key: combo!.key === ' ' ? ' ' : combo!.key,
        code: combo!.key === ' ' ? 'Space' : `Key${combo!.key}`,
        ctrl: combo!.ctrl,
        shift: combo!.shift,
        alt: combo!.alt,
      })
      expect(findToolForEvent(event), `Kürzel "${display}"`).toBe(expected)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Abgleich der Tabellen                                               */
/* ------------------------------------------------------------------ */

describe('Kuerzeltabellen', () => {
  it('deckt jede ToolId mit einer Rueckfallbelegung ab', () => {
    for (const id of Object.keys(TOOL_META) as ToolId[]) {
      expect(DEFAULT_TOOL_SHORTCUTS[id], `Rueckfallkuerzel für "${id}"`).toBeTruthy()
    }
    expect(Object.keys(DEFAULT_TOOL_SHORTCUTS).sort()).toEqual(Object.keys(TOOL_META).sort())
  })

  it('stimmt in jedem Eintrag mit der Werkzeugschicht ueberein', () => {
    const fromTools = new Map<ToolId, string>()
    for (const [display, id] of Object.entries(TOOL_SHORTCUTS)) fromTools.set(id, display)
    for (const [id, display] of Object.entries(DEFAULT_TOOL_SHORTCUTS) as [ToolId, string][]) {
      const authoritative = fromTools.get(id)
      expect(authoritative, `Werkzeugschicht kennt kein Kürzel für "${id}"`).toBeDefined()
      expect(authoritative, `Kürzel für "${id}" läuft auseinander`).toBe(display)
    }
  })

  it('vergibt kein Werkzeugkuerzel doppelt', () => {
    const combos = Object.values(DEFAULT_TOOL_SHORTCUTS)
    expect(new Set(combos).size, `Doppelte Belegung in ${combos.join(', ')}`).toBe(combos.length)
  })

  it('liefert toolShortcut das Kürzel der Werkzeugschicht', () => {
    for (const [display, id] of Object.entries(TOOL_SHORTCUTS)) {
      expect(toolShortcut(id), `toolShortcut("${id}")`).toBe(display)
    }
  })

  it('listet in der Übersicht jedes Werkzeug mit Name und Kürzel', () => {
    const list = allToolShortcuts()
    expect(list).toHaveLength(Object.keys(TOOL_META).length)
    for (const entry of list) {
      expect(entry.name, `Name für "${entry.id}"`).toBe(TOOL_META[entry.id].name)
      expect(entry.combo.length, `Kürzel für "${entry.id}"`).toBeGreaterThan(0)
      expect(parseCombo(entry.combo), `Kürzel "${entry.combo}" ist nicht lesbar`).not.toBeNull()
    }
  })

  it('hält jedes Menuekuerzel lesbar', () => {
    for (const [id, display] of Object.entries(MENU_SHORTCUTS)) {
      expect(parseCombo(display), `Menuekuerzel "${id}" = "${display}"`).not.toBeNull()
    }
  })

  it('vergibt kein Menuekuerzel doppelt', () => {
    const combos = Object.values(MENU_SHORTCUTS)
    expect(new Set(combos).size, `Doppelte Belegung in ${combos.join(', ')}`).toBe(combos.length)
  })

  it('kollidiert nicht mit den Werkzeugkuerzeln', () => {
    // Menuekuerzel tragen Strg oder sind Funktionstasten; Werkzeugkuerzel nie.
    // Sonst wuerde dieselbe Tastenfolge zwei Dinge ausloesen.
    const toolCombos = Object.values(DEFAULT_TOOL_SHORTCUTS).map((display) => parseCombo(display)!)
    for (const [id, display] of Object.entries(MENU_SHORTCUTS)) {
      const menu = parseCombo(display)!
      const clash = toolCombos.find(
        (tool) =>
          tool.key === menu.key && tool.ctrl === menu.ctrl && tool.shift === menu.shift && tool.alt === menu.alt,
      )
      expect(clash, `Menuekuerzel "${id}" (${display}) kollidiert mit einem Werkzeugkuerzel`).toBeUndefined()
    }
  })

  it('schreibt Werkzeugkuerzel ohne Strg', () => {
    for (const [id, display] of Object.entries(DEFAULT_TOOL_SHORTCUTS)) {
      expect(parseCombo(display)!.ctrl, `"${id}" belegt Strg`).toBe(false)
    }
  })
})
