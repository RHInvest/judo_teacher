/** Kleine, wiederverwendbare React-Helfer. */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Fensterbreite in CSS-Pixeln, fuer das responsive Verhalten des Trays. */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** Ruft `handler`, sobald ausserhalb des Elements geklickt wird. */
export function useOutsideClick<T extends HTMLElement>(
  active: boolean,
  handler: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!active) return
    const onDown = (event: MouseEvent) => {
      const node = ref.current
      if (node && event.target instanceof Node && !node.contains(event.target)) handlerRef.current()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [active])
  return ref
}

/** Escape-Taste abfangen, solange `active`. */
export function useEscape(active: boolean, handler: () => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        handlerRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])
}

/** Zustandswert, der nach `ms` automatisch zurueckgesetzt wird. */
export function useTransientFlag(ms = 1200): [boolean, () => void] {
  const [flag, setFlag] = useState(false)
  const timer = useRef<number | null>(null)
  const trigger = useCallback(() => {
    setFlag(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFlag(false), ms)
  }, [ms])
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  return [flag, trigger]
}

/** Fokussiert den Viewport-Canvas, z.B. nachdem ein Eingabefeld verlassen wurde. */
export function focusViewport(): void {
  const canvas = document.querySelector('canvas')
  if (canvas instanceof HTMLCanvasElement) canvas.focus()
}

/** Loest einen Datei-Download aus. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Oeffnet einen Dateiauswahldialog und liefert die gewaehlten Dateien. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.position = 'fixed'
    input.style.left = '-10000px'
    document.body.appendChild(input)
    const cleanup = () => {
      window.setTimeout(() => input.remove(), 0)
    }
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []))
      cleanup()
    })
    input.addEventListener('cancel', () => {
      resolve([])
      cleanup()
    })
    input.click()
  })
}

/** Liest eine Datei als Data-URL (fuer Texturen). */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Datei konnte nicht gelesen werden'))
    reader.readAsDataURL(file)
  })
}

/** Ermittelt die Pixelgroesse eines Bildes aus einer Data-URL. */
export function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = dataUrl
  })
}
