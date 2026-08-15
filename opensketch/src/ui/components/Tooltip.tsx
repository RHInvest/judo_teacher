/** Verzoegerter Tooltip mit optionaler Kuerzelanzeige. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'

export interface TooltipProps {
  label: string
  shortcut?: string
  side?: 'right' | 'bottom' | 'left' | 'top'
  delay?: number
  children: React.ReactElement
}

interface Position {
  left: number
  top: number
}

export function Tooltip({ label, shortcut, side = 'right', delay = 420, children }: TooltipProps) {
  const skin = useSkin()
  const [position, setPosition] = useState<Position | null>(null)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setPosition(null)
  }, [])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const show = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      const node = wrapperRef.current?.firstElementChild ?? wrapperRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const gap = 8
      const next: Position =
        side === 'right'
          ? { left: rect.right + gap, top: rect.top + rect.height / 2 }
          : side === 'left'
            ? { left: rect.left - gap, top: rect.top + rect.height / 2 }
            : side === 'top'
              ? { left: rect.left + rect.width / 2, top: rect.top - gap }
              : { left: rect.left + rect.width / 2, top: rect.bottom + gap }
      setPosition(next)
    }, delay)
  }, [delay, side])

  const transform =
    side === 'right'
      ? 'translate(0, -50%)'
      : side === 'left'
        ? 'translate(-100%, -50%)'
        : side === 'top'
          ? 'translate(-50%, -100%)'
          : 'translate(-50%, 0)'

  return (
    <>
      <span ref={wrapperRef} className="contents" onMouseEnter={show} onMouseLeave={clear} onMouseDown={clear}>
        {children}
      </span>
      {position
        ? createPortal(
            <div
              role="tooltip"
              className={clsx(
                'pointer-events-none fixed z-[999] whitespace-nowrap rounded border px-2 py-1 text-[11px]',
                skin.floating,
                skin.shadow,
              )}
              style={{ left: position.left, top: position.top, transform }}
            >
              <span>{label}</span>
              {shortcut ? <span className={clsx('ml-2', skin.dim)}>{shortcut}</span> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
