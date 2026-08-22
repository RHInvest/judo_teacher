/**
 * Massfeld ("VCB") - das zentrale Bedienelement der Statusleiste.
 *
 * Verhalten:
 *  - `vcb:focus` vom Bus setzt den Fokus und uebernimmt `initial` als erstes
 *    Zeichen (der Viewport leitet Ziffern- und Kommataste hierher um).
 *  - Enter sendet `vcb:submit` und gibt den Fokus an den Viewport zurueck.
 *  - Escape leert das Feld und gibt den Fokus zurueck.
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { bus } from '@/shared/events'
import { useSkin } from '@/ui/lib/theme'
import { focusViewport } from '@/ui/lib/hooks'
import { vcbAction, vcbInitialValue, vcbLabelText, vcbShownValue, vcbSubmitText } from '@/ui/lib/vcb'
import { act, useAppSelector } from '@/ui/state/store'

export function MeasurementBox() {
  const skin = useSkin()
  const label = useAppSelector((state) => state.ui?.vcbLabel ?? '')
  const storeValue = useAppSelector((state) => state.ui?.vcbValue ?? '')
  const placeholder = useAppSelector((state) => state.ui?.vcbPlaceholder ?? '')

  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)

  const shown = vcbShownValue(draft, storeValue)

  useEffect(() => {
    const off = bus.on('vcb:focus', (payload) => {
      const input = inputRef.current
      if (!input) return
      const initial = vcbInitialValue(payload?.initial)
      setDraft(initial)
      act((state) => state.setVcb({ vcbValue: initial, vcbEditing: true }))
      input.focus()
      window.requestAnimationFrame(() => {
        try {
          input.setSelectionRange(initial.length, initial.length)
        } catch {
          /* Feld nicht mehr im DOM */
        }
      })
    })
    return off
  }, [])

  const release = () => {
    setDraft(null)
    setFocused(false)
    inputRef.current?.blur()
    focusViewport()
  }

  const submit = () => {
    const text = vcbSubmitText(draft, storeValue)
    if (text !== null) bus.emit('vcb:submit', { text })
    act((state) => state.setVcb({ vcbValue: '', vcbEditing: false }))
    release()
  }

  const cancel = () => {
    act((state) => state.setVcb({ vcbValue: '', vcbEditing: false }))
    release()
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className={clsx('select-none text-[11px]', skin.muted)} id="vcb-label">
        {vcbLabelText(label)}
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        aria-label={`Massfeld: ${vcbLabelText(label)}`}
        value={shown}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setDraft(null)
        }}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          act((state) => state.setVcb({ vcbValue: next, vcbEditing: true }))
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          const action = vcbAction(event.key, event.nativeEvent.isComposing)
          if (action === 'submit') {
            event.preventDefault()
            submit()
          } else if (action === 'cancel') {
            event.preventDefault()
            cancel()
          }
        }}
        className={clsx(
          'h-[22px] w-[132px] rounded border px-2 text-right font-mono text-[12px] tabular-nums outline-none transition-colors',
          skin.input,
          focused ? 'border-accent-500 ring-1 ring-accent-500/40' : '',
        )}
      />
    </div>
  )
}
