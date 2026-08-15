/** Stile: Flaechenmodus, Kantenoptionen, Hintergrund, Achsen und Raster. */

import clsx from 'clsx'
import { Box, Boxes, Contrast, Grid3x3, Layers, PencilLine, ScanLine } from 'lucide-react'
import type { FaceStyle, StyleSettings } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { fmtLength, useUnits } from '@/ui/lib/format'
import {
  Checkbox,
  ColorField,
  Divider,
  GroupTitle,
  IconRow,
  NumberInput,
  Row,
  Select,
  Slider,
} from '@/ui/components/controls'
import { act, useApp } from '@/ui/state/store'
import { DEFAULT_STYLE } from '@/ui/state/fallback'

const FACE_STYLE_OPTIONS: { value: FaceStyle; label: string; icon: typeof Box }[] = [
  { value: 'shadedWithTextures', label: 'Schattiert mit Texturen', icon: Layers },
  { value: 'shaded', label: 'Schattiert', icon: Box },
  { value: 'hiddenLine', label: 'Verdeckte Linien', icon: PencilLine },
  { value: 'wireframe', label: 'Drahtgitter', icon: Boxes },
  { value: 'monochrome', label: 'Monochrom', icon: Contrast },
  { value: 'xray', label: 'Roentgen', icon: ScanLine },
]

const EDGE_COLOR_MODES: { value: StyleSettings['edgeColorMode']; label: string }[] = [
  { value: 'all', label: 'Einheitlich' },
  { value: 'byMaterial', label: 'Nach Material' },
  { value: 'byTag', label: 'Nach Tag' },
]

export function StylesPanel() {
  const skin = useSkin()
  const state = useApp()
  const units = useUnits()

  const doc = state.doc
  const style: StyleSettings = doc?.styles?.[doc?.activeStyleId ?? ''] ?? DEFAULT_STYLE

  const patch = (next: Partial<StyleSettings>) => act((s) => s.updateStyle(next))

  return (
    <div className="flex flex-col">
      <GroupTitle>Flaechen</GroupTitle>
      <div className="px-2 pb-1">
        <IconRow
          ariaLabel="Flaechenstil"
          value={style.faceStyle}
          options={FACE_STYLE_OPTIONS}
          onChange={(value) => patch({ faceStyle: value })}
        />
        <div className={clsx('pt-1 text-[10px]', skin.dim)}>
          {FACE_STYLE_OPTIONS.find((option) => option.value === style.faceStyle)?.label ?? ''}
        </div>
      </div>

      <Row label="Vorderseite">
        <ColorField value={style.frontColor} ariaLabel="Farbe der Vorderseiten" onChange={(hex) => patch({ frontColor: hex })} />
      </Row>
      <Row label="Rueckseite">
        <ColorField value={style.backColor} ariaLabel="Farbe der Rueckseiten" onChange={(hex) => patch({ backColor: hex })} />
      </Row>
      <Row label="Roentgen">
        <Slider
          min={0.05}
          max={1}
          step={0.05}
          value={style.xrayOpacity}
          ariaLabel="Deckkraft im Roentgenmodus"
          display={`${Math.round(style.xrayOpacity * 100)} %`}
          onChange={(value) => patch({ xrayOpacity: value })}
        />
      </Row>

      <Divider />
      <GroupTitle>Kanten</GroupTitle>
      <div className="px-2">
        <Checkbox checked={style.displayEdges} label="Kanten anzeigen" onChange={(checked) => patch({ displayEdges: checked })} />
        <Checkbox checked={style.displayProfiles} label="Profile" onChange={(checked) => patch({ displayProfiles: checked })} />
        <Checkbox
          checked={style.displayExtensions}
          label="Verlaengerungen"
          onChange={(checked) => patch({ displayExtensions: checked })}
        />
        <Checkbox checked={style.displayEndpoints} label="Endpunkte" onChange={(checked) => patch({ displayEndpoints: checked })} />
        <Checkbox checked={style.displayDepthCue} label="Tiefenhinweis" onChange={(checked) => patch({ displayDepthCue: checked })} />
        <Checkbox checked={style.jitterEdges} label="Handskizzen-Jitter" onChange={(checked) => patch({ jitterEdges: checked })} />
      </div>

      <Row label="Profilbreite">
        <NumberInput
          value={style.profileWidth}
          min={1}
          max={12}
          step={1}
          suffix="px"
          ariaLabel="Profilbreite in Pixeln"
          onChange={(value) => patch({ profileWidth: value })}
        />
      </Row>
      <Row label="Verlaengerung">
        <NumberInput
          value={style.extensionLength}
          min={0}
          max={40}
          step={1}
          suffix="px"
          ariaLabel="Laenge der Kantenverlaengerung"
          onChange={(value) => patch({ extensionLength: value })}
        />
      </Row>
      <Row label="Endpunkte">
        <NumberInput
          value={style.endpointSize}
          min={0}
          max={20}
          step={1}
          suffix="px"
          ariaLabel="Groesse der Endpunkte"
          onChange={(value) => patch({ endpointSize: value })}
        />
      </Row>
      <Row label="Tiefenhinweis">
        <NumberInput
          value={style.depthCueWidth}
          min={1}
          max={12}
          step={1}
          suffix="px"
          ariaLabel="Breite des Tiefenhinweises"
          onChange={(value) => patch({ depthCueWidth: value })}
        />
      </Row>
      <Row label="Kantenfarbe">
        <ColorField value={style.edgeColor} ariaLabel="Kantenfarbe" onChange={(hex) => patch({ edgeColor: hex })} />
      </Row>
      <Row label="Farbmodus">
        <Select
          ariaLabel="Kantenfarbmodus"
          value={style.edgeColorMode}
          options={EDGE_COLOR_MODES}
          onChange={(value) => patch({ edgeColorMode: value })}
        />
      </Row>

      <Divider />
      <GroupTitle>Hintergrund</GroupTitle>
      <Row label="Hintergrund">
        <ColorField value={style.backgroundColor} ariaLabel="Hintergrundfarbe" onChange={(hex) => patch({ backgroundColor: hex })} />
      </Row>
      <div className="px-2">
        <Checkbox checked={style.displaySky} label="Himmel anzeigen" onChange={(checked) => patch({ displaySky: checked })} />
      </div>
      <Row label="Himmel">
        <ColorField value={style.skyColor} ariaLabel="Himmelfarbe" onChange={(hex) => patch({ skyColor: hex })} />
      </Row>
      <div className="px-2">
        <Checkbox checked={style.displayGround} label="Boden anzeigen" onChange={(checked) => patch({ displayGround: checked })} />
      </div>
      <Row label="Boden">
        <ColorField value={style.groundColor} ariaLabel="Bodenfarbe" onChange={(hex) => patch({ groundColor: hex })} />
      </Row>
      <Row label="Transparenz">
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={style.groundTransparency}
          ariaLabel="Transparenz des Bodens"
          display={`${Math.round(style.groundTransparency * 100)} %`}
          onChange={(value) => patch({ groundTransparency: value })}
        />
      </Row>

      <Divider />
      <GroupTitle>Hilfsgeometrie</GroupTitle>
      <div className="px-2">
        <Checkbox checked={style.showAxes} label="Zeichenachsen" onChange={(checked) => patch({ showAxes: checked })} />
        <Checkbox checked={style.showGrid} label="Raster" onChange={(checked) => patch({ showGrid: checked })} />
        <Checkbox
          checked={style.showHiddenGeometry}
          label="Verdeckte Geometrie"
          onChange={(checked) => patch({ showHiddenGeometry: checked })}
        />
        <Checkbox
          checked={style.showSectionPlanes}
          label="Schnittebenen anzeigen"
          onChange={(checked) => patch({ showSectionPlanes: checked })}
        />
        <Checkbox
          checked={style.showSectionCuts}
          label="Schnitte aktiv"
          onChange={(checked) => patch({ showSectionCuts: checked })}
        />
      </div>
      <Row label="Rasterweite" hint={`Entspricht ${fmtLength(style.gridSpacing, units)}`}>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Grid3x3 size={13} className={clsx('shrink-0', skin.dim)} aria-hidden />
          <NumberInput
            value={style.gridSpacing}
            min={0.01}
            step={0.1}
            suffix="m"
            ariaLabel="Rasterweite in Metern"
            onChange={(value) => patch({ gridSpacing: value })}
          />
        </div>
      </Row>
      <Row label="Schnittfuellung">
        <ColorField value={style.sectionCutFill} ariaLabel="Fuellfarbe der Schnittflaechen" onChange={(hex) => patch({ sectionCutFill: hex })} />
      </Row>
      <Row label="Schnittlinie">
        <NumberInput
          value={style.sectionLineWidth}
          min={1}
          max={12}
          step={1}
          suffix="px"
          ariaLabel="Breite der Schnittlinie"
          onChange={(value) => patch({ sectionLineWidth: value })}
        />
      </Row>
    </div>
  )
}
