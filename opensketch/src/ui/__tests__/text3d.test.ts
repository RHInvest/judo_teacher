/**
 * Zeichensatz-Abbildung des 3D-Text-Dialogs.
 *
 * Der Dialog zeigt vorher an, was aus der Eingabe wird. Diese Vorschau muss
 * mit dem uebereinstimmen, was das Werkzeug `text3d` aus seinem eingebauten
 * Strichzeichensatz bauen kann - sonst verspricht der Dialog etwas, das im
 * Modell anders aussieht.
 */

import { describe, expect, it } from 'vitest'
import {
  TEXT3D_GLYPHS,
  mapText3d,
  mapText3dChar,
  text3dChanges,
  unsupportedText3dChars,
} from '@/ui/lib/text3d'

describe('mapText3dChar', () => {
  it('lässt jedes Zeichen des Vorrats unveraendert', () => {
    for (const char of TEXT3D_GLYPHS) {
      expect(mapText3dChar(char), `Zeichen "${char}"`).toBe(char)
    }
  })

  it('hebt Kleinbuchstaben in Grossbuchstaben', () => {
    expect(mapText3dChar('a')).toBe('A')
    expect(mapText3dChar('z')).toBe('Z')
  })

  it('schreibt Umlaute aus', () => {
    expect(mapText3dChar('ä')).toBe('AE')
    expect(mapText3dChar('Ö')).toBe('OE')
    expect(mapText3dChar('ü')).toBe('UE')
    expect(mapText3dChar('ß')).toBe('SS')
  })

  it('hält das Leerzeichen', () => {
    expect(mapText3dChar(' ')).toBe(' ')
    expect(mapText3dChar('\t')).toBe(' ')
  })

  it('legt Akzente auf den Grundbuchstaben', () => {
    expect(mapText3dChar('é')).toBe('E')
    expect(mapText3dChar('ç')).toBe('C')
    expect(mapText3dChar('ñ')).toBe('N')
  })

  it('bringt typografische Zeichen auf ihre ASCII-Form', () => {
    expect(mapText3dChar('„')).toBe('"')
    expect(mapText3dChar('’')).toBe("'")
    expect(mapText3dChar('–')).toBe('-')
    expect(mapText3dChar('…')).toBe('...')
  })

  it('lässt Zeichen ohne Entsprechung weg', () => {
    expect(mapText3dChar('日')).toBe('')
    expect(mapText3dChar('😀')).toBe('')
    expect(mapText3dChar('\n')).toBe('')
  })
})

describe('mapText3d', () => {
  it('lässt reine Grossbuchstaben unveraendert', () => {
    expect(mapText3d('OPENSKETCH')).toBe('OPENSKETCH')
  })

  it('bildet einen gemischten Text ab', () => {
    expect(mapText3d('OpenSketch')).toBe('OPENSKETCH')
    expect(mapText3d('Haus 12')).toBe('HAUS 12')
  })

  it('bildet deutsche Woerter lesbar ab', () => {
    expect(mapText3d('Tuer')).toBe('TUER')
    expect(mapText3d('Tür')).toBe('TUER')
    expect(mapText3d('Grösse')).toBe('GROESSE')
  })

  it('hält Ziffern und Satzzeichen', () => {
    expect(mapText3d('Raum 1.2 (OG)')).toBe('RAUM 1.2 (OG)')
    expect(mapText3d('A-Z, 0-9!')).toBe('A-Z, 0-9!')
  })

  it('lässt Unbekanntes ersatzlos weg', () => {
    expect(mapText3d('Haus 日 12')).toBe('HAUS  12')
  })

  it('vertraegt leere Eingabe', () => {
    expect(mapText3d('')).toBe('')
  })

  it('zerlegt zusammengesetzte Zeichen nicht in Bruchstuecke', () => {
    // Iteration ueber Codepunkte, nicht ueber UTF-16-Einheiten: sonst
    // entstuenden aus einem Emoji zwei halbe Zeichen.
    expect(mapText3d('😀')).toBe('')
  })
})

describe('unsupportedText3dChars', () => {
  it('meldet nichts für darstellbaren Text', () => {
    expect(unsupportedText3dChars('Haus 12 (OG)')).toEqual([])
    expect(unsupportedText3dChars('Grösse')).toEqual([])
  })

  it('meldet jedes fehlende Zeichen genau einmal', () => {
    expect(unsupportedText3dChars('日日本')).toEqual(['日', '本'])
  })

  it('behaelt die Eingabereihenfolge', () => {
    expect(unsupportedText3dChars('a 日 b 本')).toEqual(['日', '本'])
  })

  it('meldet den Zeilenumbruch, weil der Zeichensatz keinen kennt', () => {
    expect(unsupportedText3dChars('a\nb')).toEqual(['\n'])
  })
})

describe('text3dChanges', () => {
  it('meldet keine Aenderung für Text, der schon passt', () => {
    expect(text3dChanges('HAUS 12')).toBe(false)
    expect(text3dChanges('')).toBe(false)
  })

  it('meldet die Aenderung bei Kleinbuchstaben und Umlauten', () => {
    expect(text3dChanges('Haus')).toBe(true)
    expect(text3dChanges('Tür')).toBe(true)
  })

  it('meldet die Aenderung, wenn Zeichen wegfallen', () => {
    expect(text3dChanges('Haus 日')).toBe(true)
  })
})

describe('Zeichenvorrat', () => {
  it('enthält alle Grossbuchstaben und Ziffern', () => {
    for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(TEXT3D_GLYPHS, `Zeichen "${char}" fehlt`).toContain(char)
    }
  })

  it('enthält die gaengigen Satzzeichen', () => {
    for (const char of '.,:;!?()-+/') {
      expect(TEXT3D_GLYPHS, `Zeichen "${char}" fehlt`).toContain(char)
    }
  })

  it('fuehrt kein Zeichen doppelt', () => {
    expect(new Set(TEXT3D_GLYPHS.split('')).size).toBe(TEXT3D_GLYPHS.length)
  })

  it('enthält das Leerzeichen nicht als Glyphe', () => {
    // Das Leerzeichen ist ein Vorschub, kein Zeichen des Vorrats.
    expect(TEXT3D_GLYPHS).not.toContain(' ')
  })
})
