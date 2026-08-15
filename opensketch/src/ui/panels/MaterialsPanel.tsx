/** Materialbrowser mit Bibliothek, Modellansicht und Editor. */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Pipette, Plus, Trash2, Upload } from 'lucide-react'
import { getLibraryMaterials } from '@/io'
import type { Id, Material } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { Button, ColorField, Divider, EmptyHint, GroupTitle, IconButton, NumberInput, Row, Select, Slider, TextInput } from '@/ui/components/controls'
import { Swatch } from '@/ui/components/Swatch'
import { imageSize, pickFiles, readAsDataUrl } from '@/ui/lib/hooks'
import { setTool } from '@/ui/lib/commands'
import { act, edit, toast, useApp } from '@/ui/state/store'

function libraryMaterials(): Material[] {
  try {
    return getLibraryMaterials() ?? []
  } catch {
    return []
  }
}

export function MaterialsPanel() {
  const skin = useSkin()
  const state = useApp()
  const doc = state.doc
  const [view, setView] = useState<'library' | 'model'>('model')
  const [category, setCategory] = useState('*')
  const [search, setSearch] = useState('')

  const modelMaterials = useMemo(() => Object.values(doc?.materials ?? {}), [doc?.materials])
  const library = useMemo(() => libraryMaterials(), [])

  const source = view === 'model' ? modelMaterials : library
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const material of source) if (material.category) set.add(material.category)
    return ['*', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'de'))]
  }, [source])

  const visible = source.filter(
    (material) =>
      (category === '*' || material.category === category) &&
      (search.trim() === '' || material.name.toLowerCase().includes(search.trim().toLowerCase())),
  )

  const activeId = doc?.activeMaterialId ?? null
  const active = activeId ? doc?.materials?.[activeId] : undefined
  const activeTexture = active?.textureId ? doc?.textures?.[active.textureId] : null

  const useMaterial = (material: Material, fromLibrary: boolean) => {
    if (!fromLibrary) {
      act((s) => s.setActiveMaterial(material.id))
      setTool('paint')
      return
    }
    const existing = modelMaterials.find((entry) => entry.name === material.name)
    if (existing) {
      act((s) => s.setActiveMaterial(existing.id))
      setTool('paint')
      return
    }
    edit('Material hinzufuegen', (s) => {
      const { id: _ignored, ...rest } = material
      const newId = s.addMaterial(rest)
      s.setActiveMaterial(newId || material.id)
    })
    setTool('paint')
  }

  const patchActive = (patch: Partial<Material>) => {
    if (!activeId) return
    edit('Material aendern', (s) => s.updateMaterial(activeId, patch))
  }

  const createMaterial = () => {
    edit('Neues Material', (s) => {
      const id = s.addMaterial({
        name: `Material ${modelMaterials.length + 1}`,
        color: '#c8c8c8',
        opacity: 1,
        textureId: null,
        textureWidth: 1,
        textureHeight: 1,
        roughness: 0.8,
        metalness: 0,
        category: 'Eigene',
        colorize: false,
      })
      if (id) s.setActiveMaterial(id)
    })
    setView('model')
  }

  const uploadTexture = async () => {
    const files = await pickFiles('image/*')
    const file = files[0]
    if (!file || !activeId) return
    try {
      const dataUrl = await readAsDataUrl(file)
      const size = await imageSize(dataUrl)
      edit('Textur laden', (s) => {
        const textureId = s.addTexture({ name: file.name, dataUrl, width: size.width, height: size.height })
        s.updateMaterial(activeId, { textureId: textureId as Id })
      })
    } catch (err) {
      console.warn('[ui] Textur konnte nicht geladen werden', err)
      toast('Die Textur konnte nicht geladen werden.', 'error')
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 pb-1 pt-1.5">
        <div className={clsx('flex overflow-hidden rounded border', skin.border)}>
          {(['model', 'library'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setView(mode)
                setCategory('*')
              }}
              aria-pressed={view === mode}
              className={clsx(
                'h-6 px-2 text-[11px] transition-colors',
                view === mode ? skin.iconBtnActive : skin.iconBtn,
                skin.ring,
              )}
            >
              {mode === 'model' ? 'Im Modell' : 'Bibliothek'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <IconButton icon={Plus} ariaLabel="Neues Material" onClick={createMaterial} />
        <IconButton icon={Pipette} ariaLabel="Material aufnehmen" onClick={() => setTool('paint')} />
      </div>

      <Row label="Kategorie">
        <Select
          ariaLabel="Materialkategorie"
          value={category}
          options={categories.map((entry) => ({ value: entry, label: entry === '*' ? 'Alle Kategorien' : entry }))}
          onChange={setCategory}
        />
      </Row>
      <Row label="Suche">
        <TextInput value={search} onChange={setSearch} ariaLabel="Material suchen" placeholder="Name ..." />
      </Row>

      <div className="max-h-[190px] overflow-y-auto px-2 py-1.5">
        {visible.length === 0 ? (
          <EmptyHint>
            {view === 'model'
              ? 'Das Modell enthaelt noch keine Materialien.'
              : 'Die Materialbibliothek ist noch nicht gefuellt.'}
          </EmptyHint>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(34px,1fr))] gap-1">
            {visible.map((material) => (
              <Swatch
                key={material.id}
                material={material}
                texture={doc?.textures?.[material.textureId ?? '']}
                selected={activeId === material.id}
                onClick={() => useMaterial(material, view === 'library')}
                label={`${material.name}${material.category ? ` (${material.category})` : ''}`}
              />
            ))}
          </div>
        )}
      </div>

      <Divider />
      <GroupTitle>Editor</GroupTitle>

      {!active ? (
        <EmptyHint>Waehle ein Material aus, um es zu bearbeiten.</EmptyHint>
      ) : (
        <>
          <Row label="Name">
            <TextInput
              value={active.name}
              ariaLabel="Materialname"
              onChange={() => undefined}
              onCommit={(next) => patchActive({ name: next })}
            />
          </Row>
          <Row label="Farbe">
            <ColorField value={active.color} ariaLabel="Materialfarbe" onChange={(hex) => patchActive({ color: hex })} />
          </Row>
          <Row label="Deckkraft">
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={active.opacity}
              ariaLabel="Deckkraft"
              display={`${Math.round(active.opacity * 100)} %`}
              onChange={(value) => patchActive({ opacity: value })}
            />
          </Row>
          <Row label="Rauheit">
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={active.roughness}
              ariaLabel="Rauheit"
              display={active.roughness.toFixed(2)}
              onChange={(value) => patchActive({ roughness: value })}
            />
          </Row>
          <Row label="Metallisch">
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={active.metalness}
              ariaLabel="Metallischer Anteil"
              display={active.metalness.toFixed(2)}
              onChange={(value) => patchActive({ metalness: value })}
            />
          </Row>
          <Row label="Kategorie">
            <TextInput
              value={active.category}
              ariaLabel="Kategorie"
              onChange={() => undefined}
              onCommit={(next) => patchActive({ category: next })}
            />
          </Row>

          <Divider />
          <Row label="Textur">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {activeTexture ? (
                <span
                  className={clsx('h-8 w-8 shrink-0 rounded border', skin.border)}
                  style={{ background: `url(${activeTexture.dataUrl}) center/cover` }}
                  aria-label="Texturvorschau"
                />
              ) : null}
              <Button onClick={() => void uploadTexture()}>
                <Upload size={13} />
                {activeTexture ? 'Ersetzen' : 'Hochladen'}
              </Button>
              {activeTexture ? (
                <IconButton icon={Trash2} ariaLabel="Textur entfernen" onClick={() => patchActive({ textureId: null })} />
              ) : null}
            </div>
          </Row>
          <Row label="Breite (m)">
            <NumberInput
              value={active.textureWidth}
              min={0.001}
              step={0.05}
              ariaLabel="Texturbreite in Metern"
              onChange={(value) => patchActive({ textureWidth: value })}
            />
          </Row>
          <Row label="Hoehe (m)">
            <NumberInput
              value={active.textureHeight}
              min={0.001}
              step={0.05}
              ariaLabel="Texturhoehe in Metern"
              onChange={(value) => patchActive({ textureHeight: value })}
            />
          </Row>

          <Divider />
          <div className="flex gap-1 px-2 pb-1">
            <Button
              variant="danger"
              onClick={() => {
                if (!activeId) return
                edit('Material loeschen', (s) => {
                  s.removeMaterial(activeId)
                  s.setActiveMaterial(null)
                })
              }}
            >
              <Trash2 size={13} />
              Loeschen
            </Button>
            <Button variant="ghost" onClick={() => act((s) => s.setActiveMaterial(null))}>
              Standardmaterial
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
