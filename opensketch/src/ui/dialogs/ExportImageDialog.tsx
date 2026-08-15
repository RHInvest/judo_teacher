/** Bild der aktuellen Ansicht exportieren. */

import { useState } from 'react'
import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { Checkbox, NumberInput, Row, TextInput } from '@/ui/components/controls'
import { downloadBlob } from '@/ui/lib/hooks'
import { getViewportSafe } from '@/ui/lib/commands'
import { act, read, toast } from '@/ui/state/store'
import { Dialog } from './Dialog'

export function ExportImageDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const size = getViewportSafe()?.getSize() ?? { width: 1600, height: 900 }
  const [width, setWidth] = useState(Math.max(320, Math.round(size.width * 2)))
  const [height, setHeight] = useState(Math.max(240, Math.round(size.height * 2)))
  const [transparent, setTransparent] = useState(false)
  const [filename, setFilename] = useState(() => read((s) => s.doc?.meta?.name ?? 'ansicht', 'ansicht'))
  const [running, setRunning] = useState(false)

  const run = async () => {
    const viewport = getViewportSafe()
    if (!viewport) {
      toast('Der Viewport ist noch nicht bereit.', 'warn')
      return
    }
    setRunning(true)
    act((s) => s.setBusy('Bild wird erzeugt ...'))
    try {
      const dataUrl = await viewport.captureImage({ width, height, transparent })
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      downloadBlob(blob, `${filename.trim() || 'ansicht'}.png`)
      toast('Bild exportiert.', 'success')
      onClose()
    } catch (err) {
      console.warn('[ui] Bildexport fehlgeschlagen', err)
      toast('Das Bild konnte nicht erzeugt werden.', 'error')
    } finally {
      setRunning(false)
      act((s) => s.setBusy(null))
    }
  }

  const megapixel = (width * height) / 1_000_000

  return (
    <Dialog
      title="Bild exportieren"
      width={420}
      onClose={onClose}
      footerNote={`${width} × ${height} px · ${megapixel.toFixed(1)} MP`}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: running ? 'Erzeuge ...' : 'Exportieren', variant: 'primary', disabled: running, onClick: () => void run() },
      ]}
    >
      <Row label="Dateiname">
        <TextInput value={filename} onChange={setFilename} ariaLabel="Dateiname ohne Endung" />
      </Row>
      <Row label="Breite">
        <NumberInput value={width} min={64} max={8192} step={10} suffix="px" ariaLabel="Bildbreite" onChange={(value) => setWidth(Math.round(value))} />
      </Row>
      <Row label="Hoehe">
        <NumberInput value={height} min={64} max={8192} step={10} suffix="px" ariaLabel="Bildhoehe" onChange={(value) => setHeight(Math.round(value))} />
      </Row>
      <div className="px-2 pb-1">
        <Checkbox checked={transparent} label="Transparenter Hintergrund" onChange={setTransparent} />
      </div>
      <p className={clsx('px-3 pb-2 text-[11px] leading-relaxed', skin.dim)}>
        Aufgenommen wird genau der sichtbare Bildausschnitt, in der gewaehlten Aufloesung neu gerendert.
      </p>
    </Dialog>
  )
}
