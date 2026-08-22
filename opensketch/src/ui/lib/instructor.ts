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
      'Auf ein Element klicken, um es auszuwaehlen.',
      'Rechteck von links nach rechts aufziehen: nur vollstaendig umschlossene Elemente.',
      'Von rechts nach links aufziehen: alles Beruehrte.',
      'Doppelklick waehlt Flaeche samt Begrenzungskanten, Dreifachklick alles Zusammenhaengende.',
    ],
    modifiers: [
      { key: 'Umschalt', effect: 'Auswahl umschalten (ergaenzen oder entfernen)' },
      { key: 'Strg', effect: 'zur Auswahl hinzufuegen' },
      { key: 'Umschalt+Strg', effect: 'aus der Auswahl entfernen' },
    ],
  },
  lasso: {
    steps: ['Mit gedrueckter Maustaste eine freie Flaeche umfahren.', 'Beim Loslassen wird alles darin ausgewaehlt.'],
    modifiers: [{ key: 'Umschalt', effect: 'Auswahl umschalten' }],
  },
  eraser: {
    steps: ['Mit gedrueckter Maustaste ueber Kanten streichen.', 'Beim Loslassen werden sie geloescht.'],
    modifiers: [
      { key: 'Strg', effect: 'Kanten weichzeichnen statt loeschen' },
      { key: 'Umschalt', effect: 'Kanten verstecken statt loeschen' },
    ],
  },
  paint: {
    steps: [
      'Material im Materialbrowser waehlen.',
      'Auf eine Flaeche, eine Kante oder eine ganze Gruppe klicken.',
    ],
    modifiers: [
      { key: 'Alt', effect: 'Material unter dem Zeiger aufnehmen (Pipette)' },
      { key: 'Strg', effect: 'alle gleichen Materialien im Modell ersetzen' },
      { key: 'Umschalt', effect: 'alle Flaechen des Objekts einfaerben' },
    ],
  },
  line: {
    steps: ['Startpunkt klicken.', 'Endpunkt klicken - die Linie setzt sich fort.', 'Mit Esc oder Doppelklick beenden.'],
    modifiers: [
      { key: 'Pfeiltasten', effect: 'auf rote, gruene oder blaue Achse sperren' },
      { key: 'Umschalt', effect: 'aktuelle Inferenzrichtung festhalten' },
    ],
    vcb: 'Laenge, z. B. "3,5" oder "250cm"',
  },
  freehand: {
    steps: ['Maustaste gedrueckt halten und zeichnen.', 'Beim Loslassen entsteht ein Streckenzug.'],
    modifiers: [],
  },
  rectangle: {
    steps: ['Erste Ecke klicken.', 'Gegenueberliegende Ecke klicken.'],
    modifiers: [{ key: 'Umschalt', effect: 'auf die aktuelle Ebene sperren' }],
    vcb: 'Masse als "Breite;Hoehe", z. B. "3;2"',
  },
  rotatedRectangle: {
    steps: ['Startpunkt der Grundkante klicken.', 'Endpunkt der Grundkante klicken.', 'Breite aufziehen und klicken.'],
    modifiers: [],
    vcb: 'Masse als "Breite;Hoehe" oder Winkel',
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
    steps: ['Startpunkt der Sehne klicken.', 'Endpunkt der Sehne klicken.', 'Bogenhoehe aufziehen.'],
    modifiers: [],
    vcb: 'Bogenhoehe, danach Segmentzahl',
  },
  arc3: {
    steps: ['Drei Punkte auf dem Bogen nacheinander klicken.'],
    modifiers: [],
  },
  arc: {
    steps: ['Mittelpunkt klicken.', 'Startpunkt klicken.', 'Oeffnungswinkel aufziehen.'],
    modifiers: [],
    vcb: 'Radius, danach Winkel',
  },
  pie: {
    steps: ['Mittelpunkt klicken.', 'Startpunkt klicken.', 'Winkel aufziehen - es entsteht eine geschlossene Flaeche.'],
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
    vcb: 'Distanz, oder "3x" fuer eine Reihe von Kopien',
  },
  rotate: {
    steps: ['Drehmittelpunkt klicken.', 'Startpunkt des Winkels klicken.', 'Zielwinkel klicken.'],
    modifiers: [
      { key: 'Strg', effect: 'Kopie drehen' },
      { key: 'Umschalt', effect: 'Drehebene festhalten' },
    ],
    vcb: 'Winkel in Grad, oder "6x" fuer ein Rundum-Array',
  },
  scale: {
    steps: ['Objekt auswaehlen - die Griffe erscheinen.', 'Griff ziehen und klicken.'],
    modifiers: [
      { key: 'Umschalt', effect: 'Proportionen beibehalten' },
      { key: 'Strg', effect: 'um den Mittelpunkt skalieren' },
    ],
    vcb: 'Faktor (z. B. "1,5") oder Zielmass',
  },
  pushpull: {
    steps: ['Flaeche anfassen.', 'In Normalenrichtung ziehen und klicken.'],
    modifiers: [
      { key: 'Strg', effect: 'neue Startflaeche erzeugen (stapeln)' },
      { key: 'Alt', effect: 'ohne die Nachbarflaechen zu verformen' },
      { key: 'Doppelklick', effect: 'letzte Distanz wiederholen' },
    ],
    vcb: 'Distanz',
  },
  followme: {
    steps: ['Pfad vorher auswaehlen.', 'Werkzeug waehlen.', 'Profilflaeche anklicken.'],
    modifiers: [{ key: 'Alt', effect: 'Umriss der Flaeche als Pfad verwenden' }],
  },
  offset: {
    steps: ['Flaeche oder Kantenzug anfassen.', 'Nach innen oder aussen ziehen und klicken.'],
    modifiers: [{ key: 'Doppelklick', effect: 'letzten Versatz wiederholen' }],
    vcb: 'Versatzweite (negativ = nach innen)',
  },
  tape: {
    steps: ['Startpunkt klicken.', 'Endpunkt klicken - die Strecke steht im Massfeld.'],
    modifiers: [{ key: 'Strg', effect: 'nur messen, keine Hilfslinie erzeugen' }],
    vcb: 'Zielmass - skaliert das Modell auf diese Laenge',
  },
  protractor: {
    steps: ['Scheitelpunkt klicken.', 'Basisrichtung klicken.', 'Winkel aufziehen.'],
    modifiers: [{ key: 'Strg', effect: 'ohne Hilfslinie messen' }],
    vcb: 'Winkel in Grad',
  },
  axes: {
    steps: ['Neuen Ursprung klicken.', 'Richtung der roten Achse klicken.', 'Richtung der gruenen Achse klicken.'],
    modifiers: [],
  },
  dimension: {
    steps: ['Kante anklicken oder zwei Punkte waehlen.', 'Masslinie nach aussen ziehen und absetzen.'],
    modifiers: [],
  },
  text: {
    steps: ['Punkt anklicken.', 'Position der Beschriftung waehlen.', 'Text eingeben und mit Eingabe bestaetigen.'],
    modifiers: [],
  },
  text3d: {
    steps: ['Text im Dialog eingeben.', 'Hoehe und Extrusion waehlen.', 'Im Modell platzieren.'],
    modifiers: [],
  },
  sectionPlane: {
    steps: ['Flaeche anklicken, auf der die Schnittebene liegen soll.', 'Ebene bei Bedarf verschieben.'],
    modifiers: [],
  },
  orbit: {
    steps: ['Mit gedrueckter Maustaste ziehen.'],
    modifiers: [
      { key: 'Mittlere Maustaste', effect: 'Orbit aus jedem Werkzeug heraus' },
      { key: 'Umschalt', effect: 'auf Schwenken umschalten' },
    ],
  },
  pan: { steps: ['Mit gedrueckter Maustaste ziehen.'], modifiers: [] },
  zoom: {
    steps: ['Nach oben ziehen zum Heranzoomen, nach unten zum Herauszoomen.'],
    modifiers: [{ key: 'Umschalt', effect: 'Bildwinkel statt Abstand aendern' }],
    vcb: 'Bildwinkel in Grad, z. B. "45deg"',
  },
  zoomWindow: { steps: ['Rechteck ueber dem gewuenschten Ausschnitt aufziehen.'], modifiers: [] },
  position: {
    steps: ['Standpunkt klicken.', 'In die gewuenschte Blickrichtung ziehen.'],
    modifiers: [],
    vcb: 'Augenhoehe',
  },
  walk: {
    steps: ['Maustaste gedrueckt halten und in Laufrichtung ziehen.'],
    modifiers: [
      { key: 'Umschalt', effect: 'schneller laufen' },
      { key: 'Alt', effect: 'Kollision ignorieren' },
    ],
  },
  lookaround: { steps: ['Mit gedrueckter Maustaste den Kopf drehen.'], modifiers: [] },
}

export function instructionFor(tool: ToolId): ToolInstruction {
  return TOOL_INSTRUCTIONS[tool] ?? EMPTY
}
