/**
 * Zeichenvorrat des eingebauten Strichzeichensatzes fuer 3D-Text.
 *
 * Das Werkzeug `text3d` baut die Buchstaben aus einem eingebauten
 * Strichzeichensatz statt aus einer echten Schriftdatei. Dessen Vorrat ist
 * bewusst klein: Grossbuchstaben A-Z, Ziffern 0-9 und gaengige Satzzeichen.
 * Kleinbuchstaben werden auf Grossbuchstaben abgebildet, deutsche Umlaute
 * und Eszett auf ihre Ersatzschreibweise (AE, OE, UE, SS), gaengige Akzente
 * auf den Grundbuchstaben.
 *
 * WARUM DIESE TABELLE IN `shared` LIEGT
 *
 * Zwei Module brauchen sie: `@/ui` zeigt im Dialog vorher an, was aus der
 * Eingabe wird, und `@/tools` baut daraus die Geometrie. Die Schichtregel
 * verbietet `tools -> ui`, eine Kopie waere also der naheliegende Ausweg
 * gewesen - und damit zwei Wahrheiten, die auseinanderlaufen, sobald jemand
 * ein Zeichen ergaenzt. Der Nutzer saehe dann eine Vorschau, die nicht zum
 * Ergebnis passt.
 *
 * Als geteilte Datentabelle ohne Verhalten gehoert sie nach `shared` - genau
 * wie die Typen und die Einheitenumrechnung.
 *
 * OWNERSHIP: Lead. Wer den Vorrat aendert, aendert ihn hier.
 */

/** Zeichen, die der Zeichensatz unveraendert kennt (ohne Leerzeichen). */
export const TEXT3D_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?\'"()[]{}<>+-*/=_#%&@$'

/** Ersatzschreibweisen fuer Zeichen ausserhalb des Vorrats. */
const SUBSTITUTIONS: Record<string, string> = {
  Ä: 'AE',
  Ö: 'OE',
  Ü: 'UE',
  ß: 'SS',
  À: 'A',
  Á: 'A',
  Â: 'A',
  Ã: 'A',
  Å: 'A',
  Æ: 'AE',
  Ç: 'C',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ë: 'E',
  Ì: 'I',
  Í: 'I',
  Î: 'I',
  Ï: 'I',
  Ñ: 'N',
  Ò: 'O',
  Ó: 'O',
  Ô: 'O',
  Õ: 'O',
  Ø: 'O',
  Ù: 'U',
  Ú: 'U',
  Û: 'U',
  Ý: 'Y',
  '„': '"',
  '“': '"',
  '”': '"',
  '‚': "'",
  '‘': "'",
  '’': "'",
  '–': '-',
  '—': '-',
  '…': '...',
  '·': '.',
  '×': '*',
  '°': 'O',
}

const GLYPH_SET = new Set(TEXT3D_GLYPHS.split(''))

/**
 * Bildet ein einzelnes Zeichen auf den Zeichensatz ab.
 * Liefert `''`, wenn es kein Gegenstueck gibt - dann faellt es weg.
 */
export function mapText3dChar(char: string): string {
  if (char === ' ' || char === '\t') return ' '
  const substitute = SUBSTITUTIONS[char] ?? SUBSTITUTIONS[char.toUpperCase()]
  if (substitute) return substitute
  /*
   * Grossschreibung darf mehrere Zeichen ergeben - "ß" wird zu "SS". Deshalb
   * wird die ganze Grossform gegen den Vorrat geprueft und nicht nur ihr
   * erstes Zeichen.
   */
  const upper = char.toUpperCase()
  if (upper.length > 0 && [...upper].every((part) => GLYPH_SET.has(part))) return upper
  return ''
}

/** Vorschau darauf, was das Werkzeug tatsaechlich baut. */
export function mapText3d(text: string): string {
  let out = ''
  for (const char of text) out += mapText3dChar(char)
  return out
}

/**
 * Zeichen der Eingabe, die ersatzlos wegfallen - in Eingabereihenfolge,
 * jedes nur einmal. Genau diese meldet der Dialog dem Nutzer.
 */
export function unsupportedText3dChars(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const char of text) {
    if (mapText3dChar(char) !== '') continue
    if (seen.has(char)) continue
    seen.add(char)
    out.push(char)
  }
  return out
}

/** true, wenn die Abbildung die Eingabe veraendert (Vorschau lohnt sich). */
export function text3dChanges(text: string): boolean {
  return mapText3d(text) !== text
}
