/**
 * Weiterleitung auf die geteilte Zeichentabelle.
 *
 * Die Abbildung liegt in `@/shared/text3d`, weil `@/tools` sie ebenfalls
 * braucht und die Schichtregel `tools -> ui` verbietet. Zwei Kopien waeren
 * zwei Wahrheiten: die Dialogvorschau wuerde etwas anderes zeigen als das
 * Werkzeug baut, sobald jemand ein Zeichen ergaenzt.
 *
 * Diese Datei bleibt als Importpfad bestehen, damit die Oberflaeche nicht an
 * jeder Stelle umgehaengt werden muss.
 */

export {
  TEXT3D_GLYPHS,
  mapText3dChar,
  mapText3d,
  unsupportedText3dChars,
  text3dChanges,
} from '@/shared/text3d'
