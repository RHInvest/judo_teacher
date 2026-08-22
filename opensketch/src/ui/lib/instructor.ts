/**
 * Texte des Instructors - Schritt-fuer-Schritt-Hilfe zum aktiven Werkzeug.
 * Reine Daten, damit der Panel-Code frei von langen Zeichenketten bleibt.
 */

import type { ToolId } from '@/shared/types'

export interface ToolInstruction {
  /** Arbeitsschritte in der Reihenfolge der Bedienung */
  steps: string[]
  /** Sondertasten: Taste -> Wirkung */
  modifiers: { key: string; effect: string }[]
  /** was im Massfeld eingegeben werden kann */
  vcb?: string
}

const EMPTY: ToolInstruction = { steps: [], modifiers: [] }

/**
 * Vollstaendiger `Record`, nicht `Partial`: jedes Werkzeug braucht eine
 * Anleitung. Als `Partial` waere ein neues Werkzeug ohne Text durchgerutscht
 * und der Instructor haette dazu wortlos eine leere Flaeche gezeigt.
 */
export const TOOL_INSTRUCTIONS: Record<ToolId, ToolInstruction> = {
  select: {
    steps: [
      'Auf ein Element klicken, um es auszuwählen.',
      'Rechteck von links nach rechts aufziehen: nur vollständig umschlossene Elemente.',
      'Von rechts nach links aufziehen: alles Berührte.',
      'Doppelklick wählt Fläche samt Begrenzungskanten, Dreifachklick alles Zusammenhängende.',
    ],
    modifiers: [
      { key: 'Umschalt', effect: 'Auswahl umschalten (ergänzen oder entfernen)' },
      { key: 'Strg', effect: 'zur Auswahl hinzufügen' },
      { key: 'Umschalt+Strg', effect: 'aus der Auswahl entfernen' },
    ],
  },
  lasso: {
    steps: ['Mit gedrückter Maustaste eine freie Fläche umfahren.', 'Beim Loslassen wird alles darin ausgewählt.'],
    modifiers: [{ key: 'Umschalt', effect: 'Auswahl umschalten' }],
  },
  eraser: {
    steps: ['Mit gedrückter Maustaste über Kanten streichen.', 'Beim Loslassen werden sie gelöscht.'],
    modifiers: [
      { key: 'Strg', effect: 'Kanten weichzeichnen statt löschen' },
      { key: 'Umschalt', effect: 'Kanten verstecken statt löschen' },
    ],
  },
  paint: {
    steps: [
      'Material im Materialbrowser wählen.',
      'Auf eine Fläche, eine Kante oder eine ganze Gruppe klicken.',
    ],
    modifiers: [
      { key: 'Alt', effect: 'Material unter dem Zeiger aufnehmen (Pipette)' },
      { key: 'Strg', effect: 'alle gleichen Materialien im Modell ersetzen' },
      { key: 'Umschalt', effect: 'alle Flächen des Objekts einfärben' },
    ],
  },
  line: {
    steps: ['Startpunkt klicken.', 'Endpunkt klicken - die Linie setzt sich fort.', 'Mit Esc oder Doppelklick beenden.'],
    modifiers: [
      { key: 'Pfeiltasten', effect: 'auf rote, grüne oder blaue Achse sperren' },
      { key: 'Umschalt', effect: 'aktuelle Inferenzrichtung festhalten' },
    ],
    vcb: 'Länge, z. B. "3,5" oder "250cm"',
  },
  freehand: {
    steps: ['Maustaste gedrückt halten und zeichnen.', 'Beim Loslassen entsteht ein Streckenzug.'],
    modifiers: [],
  },
  rectangle: {
    steps: ['Erste Ecke klicken.', 'Gegenüberliegende Ecke klicken.'],
    modifiers: [{ key: 'Umschalt', effect: 'auf die aktuelle Ebene sperren' }],
    vcb: 'Maße als "Breite;Höhe", z. B. "3;2"',
  },
  rotatedRectangle: {
    steps: ['Startpunkt der Grundkante klicken.', 'Endpunkt der Grundkante klicken.', 'Breite aufziehen und klicken.'],
    modifiers: [],
    vcb: 'Maße als "Breite;Höhe" oder Winkel',
  },
  circle: {
    steps: ['Mittelpunkt klicken.', 'Radius aufziehen und klicken.'],
    modifiers: [{ key: 'Pfeiltasten', effect: 'Kreisebene auf eine Achse sperren' }],
    vcb: 'Vorab Segmentzahl (z. B. "24s"), danach Radius',
  },
  polygon: {
    steps: ['Mittelpunkt klicken.', 'Umkreisradius aufziehen und klicken.'],
    modifiers: [],
    vcb: 'Vorab Seitenzahl (z. B. "6s"), danach Radius',
  },
  arc2: {
    steps: ['Startpunkt der Sehne klicken.', 'Endpunkt der Sehne klicken.', 'Bogenhöhe aufziehen.'],
    modifiers: [],
    vcb: 'Bogenhöhe, danach Segmentzahl',
  },
  arc3: {
    steps: ['Drei Punkte auf dem Bogen nacheinander klicken.'],
    modifiers: [],
  },
  arc: {
    steps: ['Mittelpunkt klicken.', 'Startpunkt klicken.', 'Öffnungswinkel aufziehen.'],
    modifiers: [],
    vcb: 'Radius, danach Winkel',
  },
  pie: {
    steps: ['Mittelpunkt klicken.', 'Startpunkt klicken.', 'Winkel aufziehen - es entsteht eine geschlossene Fläche.'],
    modifiers: [],
    vcb: 'Radius, danach Winkel',
  },
  bezier: {
    steps: ['Startpunkt klicken.', 'Endpunkt klicken.', 'Die beiden Griffe nacheinander setzen.'],
    modifiers: [],
  },
  move: {
    steps: ['Element anfassen (Griffpunkt bestimmt den Bezug).', 'Ziel klicken.'],
    modifiers: [
      { key: 'Strg', effect: 'Kopie statt Verschieben' },
      { key: 'Pfeiltasten', effect: 'auf eine Achse sperren' },
      { key: 'Alt', effect: 'Autofalten erlauben' },
    ],
    vcb: 'Distanz, oder "3x" für eine Reihe von Kopien',
  },
  rotate: {
    steps: ['Drehmittelpunkt klicken.', 'Startpunkt des Winkels klicken.', 'Zielwinkel klicken.'],
    modifiers: [
      { key: 'Strg', effect: 'Kopie drehen' },
      { key: 'Umschalt', effect: 'Drehebene festhalten' },
    ],
    vcb: 'Winkel in Grad, oder "6x" für ein Rundum-Array',
  },
  scale: {
    steps: ['Objekt auswählen - die Griffe erscheinen.', 'Griff ziehen und klicken.'],
    modifiers: [
      { key: 'Umschalt', effect: 'Proportionen beibehalten' },
      { key: 'Strg', effect: 'um den Mittelpunkt skalieren' },
    ],
    vcb: 'Faktor (z. B. "1,5") oder Zielmaß',
  },
  pushpull: {
    steps: ['Fläche anfassen.', 'In Normalenrichtung ziehen und klicken.'],
    modifiers: [
      { key: 'Strg', effect: 'neue Startfläche erzeugen (stapeln)' },
      { key: 'Alt', effect: 'ohne die Nachbarflächen zu verformen' },
      { key: 'Doppelklick', effect: 'letzte Distanz wiederholen' },
    ],
    vcb: 'Distanz',
  },
  followme: {
    steps: ['Pfad vorher auswählen.', 'Werkzeug wählen.', 'Profilfläche anklicken.'],
    modifiers: [{ key: 'Alt', effect: 'Umriss der Fläche als Pfad verwenden' }],
  },
  offset: {
    steps: ['Fläche oder Kantenzug anfassen.', 'Nach innen oder außen ziehen und klicken.'],
    modifiers: [{ key: 'Doppelklick', effect: 'letzten Versatz wiederholen' }],
    vcb: 'Versatzweite (negativ = nach innen)',
  },
  tape: {
    steps: ['Startpunkt klicken.', 'Endpunkt klicken - die Strecke steht im Maßfeld.'],
    modifiers: [{ key: 'Strg', effect: 'nur messen, keine Hilfslinie erzeugen' }],
    vcb: 'Zielmaß - skaliert das Modell auf diese Länge',
  },
  protractor: {
    steps: ['Scheitelpunkt klicken.', 'Basisrichtung klicken.', 'Winkel aufziehen.'],
    modifiers: [{ key: 'Strg', effect: 'ohne Hilfslinie messen' }],
    vcb: 'Winkel in Grad',
  },
  axes: {
    steps: ['Neuen Ursprung klicken.', 'Richtung der roten Achse klicken.', 'Richtung der grünen Achse klicken.'],
    modifiers: [],
  },
  dimension: {
    steps: ['Kante anklicken oder zwei Punkte wählen.', 'Maßlinie nach außen ziehen und absetzen.'],
    modifiers: [],
  },
  text: {
    steps: ['Punkt anklicken.', 'Position der Beschriftung wählen.', 'Text eingeben und mit Eingabe bestätigen.'],
    modifiers: [],
  },
  text3d: {
    steps: ['Text im Dialog eingeben.', 'Höhe und Extrusion wählen.', 'Im Modell platzieren.'],
    modifiers: [],
  },
  sectionPlane: {
    steps: ['Fläche anklicken, auf der die Schnittebene liegen soll.', 'Ebene bei Bedarf verschieben.'],
    modifiers: [],
  },
  orbit: {
    steps: ['Mit gedrückter Maustaste ziehen.'],
    modifiers: [
      { key: 'Mittlere Maustaste', effect: 'Orbit aus jedem Werkzeug heraus' },
      { key: 'Umschalt', effect: 'auf Schwenken umschalten' },
    ],
  },
  pan: { steps: ['Mit gedrückter Maustaste ziehen.'], modifiers: [] },
  zoom: {
    steps: ['Nach oben ziehen zum Heranzoomen, nach unten zum Herauszoomen.'],
    modifiers: [{ key: 'Umschalt', effect: 'Bildwinkel statt Abstand ändern' }],
    vcb: 'Bildwinkel in Grad, z. B. "45deg"',
  },
  zoomWindow: { steps: ['Rechteck über dem gewünschten Ausschnitt aufziehen.'], modifiers: [] },
  position: {
    steps: ['Standpunkt klicken.', 'In die gewünschte Blickrichtung ziehen.'],
    modifiers: [],
    vcb: 'Augenhöhe',
  },
  walk: {
    steps: ['Maustaste gedrückt halten und in Laufrichtung ziehen.'],
    modifiers: [
      { key: 'Umschalt', effect: 'schneller laufen' },
      { key: 'Alt', effect: 'Kollision ignorieren' },
    ],
  },
  lookaround: { steps: ['Mit gedrückter Maustaste den Kopf drehen.'], modifiers: [] },
}

export function instructionFor(tool: ToolId): ToolInstruction {
  return TOOL_INSTRUCTIONS[tool] ?? EMPTY
}
