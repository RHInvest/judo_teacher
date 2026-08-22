/**
 * Eingabelogik des Massfelds ("VCB").
 *
 * Die Entscheidungen des Massfelds sind hier als reine Funktionen abgelegt,
 * damit sie ohne DOM pruefbar sind. `MeasurementBox.tsx` ist danach nur noch
 * Verdrahtung: Fokus, Tastatur, Store.
 *
 * Zustaendigkeitsgrenze: Das Massfeld *transportiert* Text, es *versteht* ihn
 * nicht. Geparst wird ausschliesslich in der Werkzeugschicht
 * (`@/tools/vcbInput`), weil nur das aktive Werkzeug weiss, ob "3;2" ein
 * Kantenpaar, "12s" eine Segmentzahl oder "45" ein Winkel ist.
 */

/** Was ein Tastendruck im Massfeld ausloest. */
export type VcbAction = 'submit' | 'cancel' | 'edit'

/**
 * Enter bestaetigt, Escape verwirft, alles andere ist normale Eingabe.
 * Zusammensetzende Eingaben (IME, `event.isComposing`) duerfen nicht
 * bestaetigen - sonst schluckt Enter die Kandidatenauswahl.
 */
export function vcbAction(key: string, composing = false): VcbAction {
  if (composing) return 'edit'
  if (key === 'Enter' || key === 'NumpadEnter') return 'submit'
  if (key === 'Escape') return 'cancel'
  return 'edit'
}

/**
 * Der angezeigte Text: der lokale Entwurf hat Vorrang vor dem Store, damit
 * das Tippen nicht von einem nachlaufenden Store-Update ueberschrieben wird.
 * `null` als Entwurf heisst "kein Entwurf offen".
 */
export function vcbShownValue(draft: string | null, storeValue: string): string {
  return draft ?? storeValue ?? ''
}

/**
 * Der Text, der als `vcb:submit` rausgeht - oder `null`, wenn nichts zu
 * senden ist. Leereingabe darf kein Ereignis ausloesen, sonst quittiert das
 * aktive Werkzeug ein blankes Enter mit einem Parserfehler.
 */
export function vcbSubmitText(draft: string | null, storeValue: string): string | null {
  const text = vcbShownValue(draft, storeValue).trim()
  return text.length > 0 ? text : null
}

/**
 * Das erste Zeichen, das der Viewport ans Massfeld weiterreicht, wenn der
 * Nutzer im 3D-Fenster zu tippen beginnt. Nicht druckbare Tasten kommen als
 * mehrzeichiger `event.key` an ("Shift", "ArrowUp") und starten keine
 * Eingabe.
 */
export function vcbInitialValue(initial: string | undefined): string {
  if (!initial) return ''
  return initial.length === 1 ? initial : ''
}

/**
 * Beschriftung des Felds. Ohne Vorgabe des Werkzeugs steht dort "Mass" -
 * ein leeres Etikett laesst das Feld wie ein Fehler aussehen.
 */
export function vcbLabelText(label: string | undefined): string {
  const text = (label ?? '').trim()
  return text === '' ? 'Maß' : text
}
