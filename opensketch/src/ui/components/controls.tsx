/**
 * Kompakte Eingabeelemente (28-32 px hoch, 11-13 px Schrift), die in allen
 * Panels und Dialogen wiederverwendet werden.
 */

import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { normalizeHex } from '@/ui/lib/format'

/* ------------------------------------------------------------------ */
/* Grundbausteine                                                      */
/* ------------------------------------------------------------------ */

export function Row({ label, hint, children, className }: { label?: string; hint?: string; children: React.ReactNode; className?: string }) {
  const skin = useSkin()
  return (
    <div className={clsx('flex min-h-[26px] items-center gap-2 px-2 py-[3px]', className)}>
      {label !== undefined ? (
        <span className={clsx('w-[104px] shrink-0 truncate text-[11px]', skin.muted)} title={hint ?? label}>
          {label}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  )
}

export function GroupTitle({ children }: { children: React.ReactNode }) {
  const skin = useSkin()
  return (
    <div className={clsx('px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em]', skin.dim)}>{children}</div>
  )
}

export function Divider({ className }: { className?: string }) {
  const skin = useSkin()
  return <div className={clsx('my-1 h-px', skin.divider, className)} />
}

/* ------------------------------------------------------------------ */
/* Text / Zahl                                                         */
/* ------------------------------------------------------------------ */

export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  className,
  onCommit,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
  onCommit?: (value: string) => void
  autoFocus?: boolean
}) {
  const skin = useSkin()
  return (
    <input
      type="text"
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onCommit?.(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          onCommit?.((event.target as HTMLInputElement).value)
          ;(event.target as HTMLInputElement).blur()
        }
      }}
      className={clsx(
        'h-7 min-w-0 flex-1 rounded border px-2 text-[12px] outline-none transition-colors',
        'focus:border-accent-500 disabled:opacity-50',
        skin.input,
        className,
      )}
    />
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  ariaLabel,
  disabled,
  className,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
}) {
  const skin = useSkin()
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0)

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw.replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(parsed)) return
    let next = parsed
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    onChange(next)
  }

  return (
    <div className={clsx('flex min-w-0 items-center gap-1', className)}>
      <input
        type="number"
        value={shown}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') commit((event.target as HTMLInputElement).value)
        }}
        className={clsx(
          'h-7 w-full min-w-0 rounded border px-2 text-[12px] tabular-nums outline-none transition-colors',
          'focus:border-accent-500 disabled:opacity-50',
          skin.input,
        )}
      />
      {suffix ? <span className={clsx('shrink-0 text-[11px]', skin.dim)}>{suffix}</span> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Schalter                                                            */
/* ------------------------------------------------------------------ */

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  const skin = useSkin()
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={clsx(
        'flex cursor-pointer select-none items-center gap-2 rounded px-1 py-[3px] text-[12px]',
        disabled ? 'cursor-not-allowed opacity-50' : skin.hover,
        className,
      )}
    >
      <span className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          className={clsx(
            'pointer-events-none flex h-[14px] w-[14px] items-center justify-center rounded-[3px] border transition-colors',
            checked ? 'border-accent-500 bg-accent-500 text-white' : clsx(skin.input, 'border'),
            'peer-focus-visible:ring-1 peer-focus-visible:ring-accent-400',
          )}
        >
          {checked ? <Check size={11} strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) {
  const skin = useSkin()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-[16px] w-[30px] shrink-0 rounded-full border transition-colors',
        checked ? 'border-accent-500 bg-accent-500' : clsx(skin.input, 'border'),
        disabled && 'opacity-50',
        skin.ring,
      )}
    >
      <span
        className={clsx(
          'absolute top-[1px] h-[12px] w-[12px] rounded-full bg-white transition-all',
          checked ? 'left-[15px]' : 'left-[2px]',
        )}
      />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Schieberegler                                                       */
/* ------------------------------------------------------------------ */

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  ariaLabel,
  display,
  disabled,
  className,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  ariaLabel: string
  display?: string
  disabled?: boolean
  className?: string
}) {
  const skin = useSkin()
  return (
    <div className={clsx('flex min-w-0 flex-1 items-center gap-2', className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        onKeyDown={(event) => event.stopPropagation()}
        className={clsx('h-4 min-w-0 flex-1 cursor-pointer accent-accent-500', disabled && 'opacity-50')}
      />
      {display !== undefined ? (
        <span className={clsx('w-[62px] shrink-0 text-right text-[11px] tabular-nums', skin.muted)}>{display}</span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Farbe                                                               */
/* ------------------------------------------------------------------ */

export function ColorField({
  value,
  onChange,
  ariaLabel,
  showHex = true,
  disabled,
}: {
  value: string
  onChange: (hex: string) => void
  ariaLabel: string
  showHex?: boolean
  disabled?: boolean
}) {
  const skin = useSkin()
  const hex = normalizeHex(value, '#808080')
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={clsx('relative h-6 w-8 shrink-0 overflow-hidden rounded border', skin.border)}>
        <input
          type="color"
          value={hex}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          className="absolute -left-1 -top-1 h-8 w-10 cursor-pointer border-0 bg-transparent p-0"
        />
      </span>
      {showHex ? (
        <input
          type="text"
          value={draft ?? hex}
          disabled={disabled}
          aria-label={`${ariaLabel} als Hexwert`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              onChange(normalizeHex(draft ?? hex, hex))
              setDraft(null)
            }
          }}
          onBlur={() => {
            if (draft !== null) onChange(normalizeHex(draft, hex))
            setDraft(null)
          }}
          className={clsx(
            'h-7 w-[86px] min-w-0 rounded border px-2 font-mono text-[11px] uppercase outline-none focus:border-accent-500',
            skin.input,
          )}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Auswahl                                                             */
/* ------------------------------------------------------------------ */

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  className,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}) {
  const skin = useSkin()
  return (
    <div className={clsx('relative min-w-0 flex-1', className)}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
        onKeyDown={(event) => event.stopPropagation()}
        className={clsx(
          'h-7 w-full min-w-0 appearance-none rounded border pl-2 pr-6 text-[12px] outline-none transition-colors',
          'focus:border-accent-500 disabled:opacity-50',
          skin.input,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className={clsx('pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2', skin.dim)} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Knoepfe                                                             */
/* ------------------------------------------------------------------ */

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  className,
  type = 'button',
  ariaLabel,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
  ariaLabel?: string
  title?: string
}) {
  const skin = useSkin()
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={clsx(
        'flex h-7 items-center justify-center gap-1.5 rounded border px-2.5 text-[12px] transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary' && skin.buttonPrimary,
        variant === 'secondary' && skin.button,
        variant === 'ghost' && clsx('border-transparent bg-transparent', skin.muted, skin.hover),
        variant === 'danger' && 'border-red-500/60 bg-red-500/15 text-red-300 hover:bg-red-500/25',
        skin.ring,
        className,
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  onClick,
  ariaLabel,
  active,
  disabled,
  size = 15,
  className,
  title,
}: {
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>
  onClick?: (event: React.MouseEvent) => void
  ariaLabel: string
  active?: boolean
  disabled?: boolean
  size?: number
  className?: string
  title?: string
}) {
  const skin = useSkin()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      className={clsx(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-40',
        active ? skin.iconBtnActive : skin.iconBtn,
        skin.ring,
        className,
      )}
    >
      <Icon size={size} strokeWidth={1.8} />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Segmentierte Icon-Reihe                                             */
/* ------------------------------------------------------------------ */

export function IconRow<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string; icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }> }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  const skin = useSkin()
  return (
    <div role="group" aria-label={ariaLabel} className={clsx('flex overflow-hidden rounded border', skin.border)}>
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={selected}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={clsx(
              'flex h-7 flex-1 items-center justify-center border-r last:border-r-0 transition-colors',
              skin.border,
              selected ? skin.iconBtnActive : skin.iconBtn,
              skin.ring,
            )}
          >
            <Icon size={15} strokeWidth={1.8} />
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Inline-Umbenennen                                                   */
/* ------------------------------------------------------------------ */

export function InlineEdit({
  value,
  onCommit,
  editing,
  onEditingChange,
  className,
  ariaLabel,
}: {
  value: string
  onCommit: (next: string) => void
  editing: boolean
  onEditingChange: (editing: boolean) => void
  className?: string
  ariaLabel: string
}) {
  const skin = useSkin()
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(value)
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [editing, value])

  if (!editing) {
    return (
      <span className={clsx('min-w-0 truncate', className)} onDoubleClick={() => onEditingChange(true)}>
        {value}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        onCommit(draft.trim() || value)
        onEditingChange(false)
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          onCommit(draft.trim() || value)
          onEditingChange(false)
        } else if (event.key === 'Escape') {
          onEditingChange(false)
        }
      }}
      className={clsx('h-6 min-w-0 flex-1 rounded border px-1 text-[12px] outline-none focus:border-accent-500', skin.input, className)}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Leerzustand                                                         */
/* ------------------------------------------------------------------ */

export function EmptyHint({ children }: { children: React.ReactNode }) {
  const skin = useSkin()
  return <div className={clsx('px-3 py-4 text-center text-[11px] leading-relaxed', skin.dim)}>{children}</div>
}
