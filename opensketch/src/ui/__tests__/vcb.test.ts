/**
 * Eingabelogik des Massfelds.
 *
 * Die zweite Haelfte dieser Datei prueft die Schnittstelle zur
 * Werkzeugschicht: Das Massfeld gibt Text weiter, ohne ihn zu verstehen -
 * also muss der Text, den es durchlaesst, von `@/tools/vcbInput` auch
 * angenommen werden. Trimmt oder normalisiert das Feld zu viel, scheitert
 * das Parsen erst im Werkzeug, wo es niemand mehr zuordnen kann.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_UNITS } from '@/shared/units'
import type { UnitSettings } from '@/shared/types'
import { parseAngleInput, parseLengthInput, parseLengthPair, parseSegmentsInput } from '@/tools'
import { vcbAction, vcbInitialValue, vcbLabelText, vcbShownValue, vcbSubmitText } from '@/ui/lib/vcb'

const METRIC: UnitSettings = { ...DEFAULT_UNITS }

/* ------------------------------------------------------------------ */
/* Tastaturentscheidung                                                */
/* ------------------------------------------------------------------ */

describe('vcbAction', () => {
  it('bestaetigt mit Enter', () => {
    expect(vcbAction('Enter')).toBe('submit')
    expect(vcbAction('NumpadEnter')).toBe('submit')
  })

  it('verwirft mit Escape', () => {
    expect(vcbAction('Escape')).toBe('cancel')
  })

  it('lässt normale Zeichen durch', () => {
    expect(vcbAction('3')).toBe('edit')
    expect(vcbAction(',')).toBe('edit')
    expect(vcbAction('Backspace')).toBe('edit')
    expect(vcbAction('ArrowLeft')).toBe('edit')
    expect(vcbAction('Tab')).toBe('edit')
  })

  it('bestaetigt nicht waehrend einer zusammengesetzten Eingabe', () => {
    expect(vcbAction('Enter', true)).toBe('edit')
    expect(vcbAction('Escape', true)).toBe('edit')
  })
})

/* ------------------------------------------------------------------ */
/* Anzeige und Uebergabe                                               */
/* ------------------------------------------------------------------ */

describe('vcbShownValue', () => {
  it('zeigt den Store, solange kein Entwurf offen ist', () => {
    expect(vcbShownValue(null, '4,20')).toBe('4,20')
  })

  it('gibt dem Entwurf den Vorrang', () => {
    expect(vcbShownValue('12', '4,20')).toBe('12')
  })

  it('hält einen bewusst geleerten Entwurf leer', () => {
    // Wichtig: '' ist ein Entwurf, kein "kein Entwurf". Sonst springt der
    // alte Store-Wert zurueck, sobald der Nutzer das Feld leert.
    expect(vcbShownValue('', '4,20')).toBe('')
  })
})

describe('vcbSubmitText', () => {
  it('liefert den getrimmten Text', () => {
    expect(vcbSubmitText('  3;2  ', '')).toBe('3;2')
  })

  it('faellt auf den Store zurueck', () => {
    expect(vcbSubmitText(null, '2,5')).toBe('2,5')
  })

  it('sendet bei leerer Eingabe nichts', () => {
    expect(vcbSubmitText('', '')).toBeNull()
    expect(vcbSubmitText('   ', '')).toBeNull()
    expect(vcbSubmitText(null, '')).toBeNull()
  })

  it('hält Zeichen im Inneren fest', () => {
    expect(vcbSubmitText('3 ; 2', '')).toBe('3 ; 2')
  })
})

describe('vcbInitialValue', () => {
  it('uebernimmt druckbare Einzelzeichen', () => {
    for (const key of ['0', '5', '.', ',', '-', "'", '"']) {
      expect(vcbInitialValue(key), `Zeichen "${key}"`).toBe(key)
    }
  })

  it('ignoriert Steuertasten', () => {
    for (const key of ['Shift', 'ArrowUp', 'Enter', 'Backspace', 'F1']) {
      expect(vcbInitialValue(key), `Taste "${key}"`).toBe('')
    }
  })

  it('vertraegt eine fehlende Vorgabe', () => {
    expect(vcbInitialValue(undefined)).toBe('')
    expect(vcbInitialValue('')).toBe('')
  })
})

describe('vcbLabelText', () => {
  it('nimmt die Vorgabe des Werkzeugs', () => {
    expect(vcbLabelText('Länge')).toBe('Länge')
    expect(vcbLabelText('Maße')).toBe('Maße')
  })

  it('faellt auf "Maß" zurueck', () => {
    expect(vcbLabelText('')).toBe('Maß')
    expect(vcbLabelText('   ')).toBe('Maß')
    expect(vcbLabelText(undefined)).toBe('Maß')
  })
})

/* ------------------------------------------------------------------ */
/* Zusammenspiel mit der Werkzeugschicht                               */
/* ------------------------------------------------------------------ */

describe('Uebergabe an die Werkzeugschicht', () => {
  it('reicht Laengen so durch, dass sie geparst werden koennen', () => {
    for (const input of ['2', '2,5', '  4  ', '0,25']) {
      const text = vcbSubmitText(input, '')
      expect(text, `Eingabe "${input}"`).not.toBeNull()
      expect(parseLengthInput(text!, METRIC), `Eingabe "${input}"`).not.toBeNull()
    }
  })

  it('reicht das Kantenpaar des Rechteckwerkzeugs durch', () => {
    const text = vcbSubmitText(' 4;3 ', '')
    expect(text).toBe('4;3')
    const pair = parseLengthPair(text!, METRIC)
    expect(pair).not.toBeNull()
    expect(pair).toHaveLength(2)
    expect(pair![0]).toBeCloseTo(4, 6)
    expect(pair![1]).toBeCloseTo(3, 6)
  })

  it('reicht Winkel und Segmentzahlen durch', () => {
    expect(parseAngleInput(vcbSubmitText('45', '')!, METRIC)).not.toBeNull()
    expect(parseSegmentsInput(vcbSubmitText('24s', '')!)).toBe(24)
  })

  it('hält das Komma als Dezimaltrennzeichen fest', () => {
    // Das Feld darf "2,5" nicht in "2.5" umschreiben - das Parsen der
    // Landeseinstellung ist Sache der Werkzeugschicht.
    expect(vcbSubmitText('2,5', '')).toBe('2,5')
    expect(parseLengthInput('2,5', METRIC)).toBeCloseTo(2.5, 6)
  })

  it('erzeugt für eine leere Eingabe gar keinen Parseraufruf', () => {
    // Ein blankes Enter darf kein `vcb:submit` ausloesen: das Werkzeug
    // quittierte es sonst mit einem Parserfehler, den der Nutzer nicht
    // verursacht hat.
    expect(vcbSubmitText('   ', '   ')).toBeNull()
  })
})
