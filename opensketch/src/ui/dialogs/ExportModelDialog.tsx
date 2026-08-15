/** Modell exportieren - Format und Optionen. */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { exportDocument, exportableFormats } from '@/io'
import type { ExportFormat, ExportOptions, ExportView } from '@/io'
import { useSkin } from '@/ui/lib/theme'
import { Checkbox, GroupTitle, NumberInput, Row, Select, TextInput } from '@/ui/components/controls'
import { downloadBlob } from '@/ui/lib/hooks'
import { getViewportSafe, hasSelection, currentSelection } from '@/ui/lib/commands'
import { act, read, toast } from '@/ui/state/store'
import { Dialog } from './Dialog'

const VIEWS: { value: ExportView; label: string }[] = [
  { value: 'current', label: 'Aktuelle Ansicht' },
  { value: 'top', label: 'Draufsicht' },
  { value: 'front', label: 'Vorderansicht' },
  { value: 'right', label: 'Seitenansicht' },
  { value: 'iso', label: 'Isometrisch' },
]

const UNIT_SCALES: { value: string; label: string }[] = [
  { value: '1', label: 'Meter' },
  { value: '100', label: 'Zentimeter' },
  { value: '1000', label: 'Millimeter' },
  { value: '39.3700787', label: 'Zoll' },
  { value: '3.2808399', label: 'Fuss' },
]

function formatList(): { format: ExportFormat; label: string; extension: string }[] {
  try {
    return exportableFormats() ?? []
  } catch {
    return [{ format: 'osk', label: 'OpenSketch-Modell', extension: '.osk' }]
  }
}

export function ExportModelDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const formats = useMemo(formatList, [])
  const [format, setFormat] = useState<ExportFormat>(formats[0]?.format ?? 'osk')
  const [filename, setFilename] = useState(() => read((s) => s.doc?.meta?.name ?? 'modell', 'modell'))
  const [selectionOnly, setSelectionOnly] = useState(false)
  const [includeEdges, setIncludeEdges] = useState(true)
  const [embedTextures, setEmbedTextures] = useState(true)
  const [triangulate, setTriangulate] = useState(false)
  const [keepHierarchy, setKeepHierarchy] = useState(true)
  const [view, setView] = useState<ExportView>('current')
  const [unitScale, setUnitScale] = useState('1')
  const [strokeWidth, setStrokeWidth] = useState(0.25)
  const [running, setRunning] = useState(false)

  const isVector = format === 'svg'
  const isImage = format === 'png'
  const isMesh = !isVector && !isImage && format !== 'osk'

  const run = async () => {
    const doc = read((s) => s.exportDocument(), null)
    if (!doc) {
      toast('Das Dokument konnte nicht gelesen werden.', 'error')
      return
    }
    setRunning(true)
    act((s) => s.setBusy(`Exportiere ${filename} ...`))
    try {
      const options: ExportOptions = {
        selectionOnly,
        selectedEntityIds: selectionOnly ? currentSelection().entityIds : undefined,
        includeEdges,
        embedTextures,
        triangulate,
        keepHierarchy,
        unitScale: Number.parseFloat(unitScale) || 1,
        view,
        strokeWidth,
        filename: filename.trim() || 'modell',
      }
      if (isImage) {
        const dataUrl = await getViewportSafe()?.captureImage({ transparent: false })
        if (dataUrl) {
          const response = await fetch(dataUrl)
          options.image = await response.blob()
        }
      }
      const result = await exportDocument(doc, format, options)
      downloadBlob(result.blob, result.filename)
      for (const extra of result.files ?? []) downloadBlob(extra.blob, extra.filename)
      toast(`${result.filename} exportiert.`, 'success')
      onClose()
    } catch (err) {
      console.warn('[ui] Export fehlgeschlagen', err)
      toast(`Export fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`, 'error')
    } finally {
      setRunning(false)
      act((s) => s.setBusy(null))
    }
  }

  const extension = formats.find((entry) => entry.format === format)?.extension ?? ''

  return (
    <Dialog
      title="Modell exportieren"
      width={470}
      onClose={onClose}
      footerNote={`${filename.trim() || 'modell'}${extension}`}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: running ? 'Exportiere ...' : 'Exportieren', variant: 'primary', disabled: running, onClick: () => void run() },
      ]}
    >
      <Row label="Format">
        <Select
          ariaLabel="Exportformat"
          value={format}
          options={formats.map((entry) => ({ value: entry.format, label: `${entry.label} (${entry.extension})` }))}
          onChange={(value) => setFormat(value)}
        />
      </Row>
      <Row label="Dateiname">
        <TextInput value={filename} onChange={setFilename} ariaLabel="Dateiname ohne Endung" />
      </Row>
      <Row label="Einheit">
        <Select ariaLabel="Zieleinheit" value={unitScale} options={UNIT_SCALES} onChange={setUnitScale} />
      </Row>

      <GroupTitle>Umfang</GroupTitle>
      <div className="px-2">
        <Checkbox
          checked={selectionOnly}
          label="Nur die Auswahl exportieren"
          disabled={!hasSelection()}
          onChange={setSelectionOnly}
        />
        {isMesh || isVector ? (
          <Checkbox checked={includeEdges} label="Kanten mit exportieren" onChange={setIncludeEdges} />
        ) : null}
        {isMesh ? (
          <>
            <Checkbox checked={embedTextures} label="Texturen einbetten" onChange={setEmbedTextures} />
            <Checkbox checked={triangulate} label="In Dreiecke zerlegen" onChange={setTriangulate} />
            <Checkbox checked={keepHierarchy} label="Gruppenhierarchie erhalten" onChange={setKeepHierarchy} />
          </>
        ) : null}
      </div>

      {isVector ? (
        <>
          <GroupTitle>Zeichnung</GroupTitle>
          <Row label="Projektion">
            <Select ariaLabel="Projektionsrichtung" value={view} options={VIEWS} onChange={setView} />
          </Row>
          <Row label="Strichstaerke">
            <NumberInput
              value={strokeWidth}
              min={0.05}
              max={5}
              step={0.05}
              suffix="mm"
              ariaLabel="Strichstaerke in Millimetern"
              onChange={setStrokeWidth}
            />
          </Row>
        </>
      ) : null}

      {isImage ? (
        <p className={clsx('px-3 pb-2 pt-1 text-[11px] leading-relaxed', skin.dim)}>
          Das Bild wird aus der aktuellen Ansicht des Viewports erzeugt.
        </p>
      ) : null}
    </Dialog>
  )
}
