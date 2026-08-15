/** Tags (Ebenen): Sichtbarkeit, Farbe, Strichart, Ordner. */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Eye, EyeOff, FolderPlus, Lock, LockOpen, Plus, Trash2 } from 'lucide-react'
import type { Id, Tag, TagFolder } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { Divider, EmptyHint, IconButton, InlineEdit, Select, TextInput } from '@/ui/components/controls'
import { act, edit, useApp } from '@/ui/state/store'

const DASH_OPTIONS: { value: Tag['dashes']; label: string }[] = [
  { value: 'solid', label: 'Durchgezogen' },
  { value: 'dash', label: 'Gestrichelt' },
  { value: 'dot', label: 'Gepunktet' },
  { value: 'dashdot', label: 'Strichpunkt' },
]

const DASH_PREVIEW: Record<Tag['dashes'], string> = {
  solid: '––––––',
  dash: '– – –',
  dot: '· · · ·',
  dashdot: '–·–·–',
}

function TagRow({
  tag,
  active,
  folders,
  editing,
  onEditingChange,
}: {
  tag: Tag
  active: boolean
  folders: TagFolder[]
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const skin = useSkin()

  return (
    <div
      className={clsx('group flex h-7 items-center gap-1.5 rounded px-1', active ? skin.selected : skin.hover)}
      onClick={() => act((s) => s.setActiveTag(tag.id))}
    >
      <IconButton
        icon={tag.visible ? Eye : EyeOff}
        size={13}
        ariaLabel={tag.visible ? `${tag.name} ausblenden` : `${tag.name} einblenden`}
        onClick={(event) => {
          event.stopPropagation()
          edit('Tag-Sichtbarkeit', (s) => s.updateTag(tag.id, { visible: !tag.visible }))
        }}
        className={tag.visible ? '' : 'opacity-50'}
      />
      <IconButton
        icon={tag.locked ? Lock : LockOpen}
        size={13}
        ariaLabel={tag.locked ? `${tag.name} entsperren` : `${tag.name} sperren`}
        onClick={(event) => {
          event.stopPropagation()
          edit('Tag sperren', (s) => s.updateTag(tag.id, { locked: !tag.locked }))
        }}
        className={tag.locked ? '' : 'opacity-40 group-hover:opacity-80'}
      />

      <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded border border-panel-600">
        <input
          type="color"
          value={tag.color || '#808080'}
          aria-label={`Farbe von ${tag.name}`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => edit('Tag-Farbe', (s) => s.updateTag(tag.id, { color: event.target.value }))}
          className="absolute -left-1 -top-1 h-7 w-7 cursor-pointer border-0 bg-transparent p-0"
        />
      </span>

      <div className={clsx('min-w-0 flex-1 text-[12px]', skin.text)} onDoubleClick={() => onEditingChange(true)}>
        <InlineEdit
          value={tag.name}
          editing={editing}
          ariaLabel={`Name von ${tag.name}`}
          onEditingChange={onEditingChange}
          onCommit={(next) => edit('Tag umbenennen', (s) => s.updateTag(tag.id, { name: next }))}
        />
      </div>

      <select
        value={tag.dashes}
        aria-label={`Strichart von ${tag.name}`}
        title={`Strichart: ${DASH_PREVIEW[tag.dashes]}`}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) =>
          edit('Strichart', (s) => s.updateTag(tag.id, { dashes: event.target.value as Tag['dashes'] }))
        }
        className={clsx('h-5 w-[74px] shrink-0 rounded border px-1 text-[10px]', skin.input)}
      >
        {DASH_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {folders.length > 0 ? (
        <select
          value={tag.folderId ?? ''}
          aria-label={`Ordner von ${tag.name}`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            edit('Tag-Ordner', (s) => s.updateTag(tag.id, { folderId: event.target.value || null }))
          }
          className={clsx('h-5 w-[70px] shrink-0 rounded border px-1 text-[10px]', skin.input)}
        >
          <option value="">Kein Ordner</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      ) : null}

      <IconButton
        icon={Trash2}
        size={13}
        ariaLabel={`${tag.name} loeschen`}
        className="opacity-0 group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation()
          edit('Tag loeschen', (s) => s.removeTag(tag.id))
        }}
      />
    </div>
  )
}

export function TagsPanel() {
  const skin = useSkin()
  const state = useApp()
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<Id | null>(null)

  const doc = state.doc
  const tags = useMemo(() => Object.values(doc?.tags ?? {}), [doc?.tags])
  const folders = useMemo(() => Object.values(doc?.tagFolders ?? {}), [doc?.tagFolders])
  const activeTagId = doc?.activeTagId ?? ''

  const query = search.trim().toLowerCase()
  const visible = tags
    .filter((tag) => query === '' || tag.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const grouped: { folder: TagFolder | null; tags: Tag[] }[] = [
    { folder: null, tags: visible.filter((tag) => !tag.folderId) },
    ...folders.map((folder) => ({ folder, tags: visible.filter((tag) => tag.folderId === folder.id) })),
  ]

  const allVisible = tags.length > 0 && tags.every((tag) => tag.visible)

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 pb-1 pt-1.5">
        <IconButton
          icon={Plus}
          ariaLabel="Neues Tag"
          onClick={() => edit('Tag anlegen', (s) => s.addTag(`Tag ${tags.length + 1}`))}
        />
        <IconButton
          icon={FolderPlus}
          ariaLabel="Neuer Ordner"
          onClick={() => edit('Ordner anlegen', (s) => s.addTagFolder(`Ordner ${folders.length + 1}`))}
        />
        <IconButton
          icon={allVisible ? EyeOff : Eye}
          ariaLabel={allVisible ? 'Alle Tags ausblenden' : 'Alle Tags einblenden'}
          onClick={() =>
            edit('Alle Tags umschalten', (s) => {
              for (const tag of tags) s.updateTag(tag.id, { visible: !allVisible })
            })
          }
        />
        <div className="min-w-0 flex-1">
          <TextInput value={search} onChange={setSearch} ariaLabel="Tags durchsuchen" placeholder="Suchen ..." />
        </div>
      </div>

      <Divider />

      <div className="max-h-[300px] overflow-y-auto px-1 pb-1">
        {visible.length === 0 ? (
          <EmptyHint>Es gibt noch keine Tags. Neue Geometrie liegt bis dahin auf dem Standard-Tag.</EmptyHint>
        ) : (
          grouped.map(({ folder, tags: groupTags }) => {
            if (groupTags.length === 0 && folder === null) return null
            return (
              <div key={folder?.id ?? '__root'} className="pb-0.5">
                {folder ? (
                  <div className={clsx('flex h-6 items-center gap-1.5 px-1', skin.dim)}>
                    <IconButton
                      icon={folder.visible ? Eye : EyeOff}
                      size={12}
                      ariaLabel={`Ordner ${folder.name} umschalten`}
                      onClick={() =>
                        edit('Ordner-Sichtbarkeit', (s) => s.updateTagFolder(folder.id, { visible: !folder.visible }))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide">
                      {folder.name}
                    </span>
                    <IconButton
                      icon={Trash2}
                      size={12}
                      ariaLabel={`Ordner ${folder.name} loeschen`}
                      onClick={() => edit('Ordner loeschen', (s) => s.removeTagFolder(folder.id))}
                    />
                  </div>
                ) : null}
                {groupTags.map((tag) => (
                  <TagRow
                    key={tag.id}
                    tag={tag}
                    active={tag.id === activeTagId}
                    folders={folders}
                    editing={renaming === tag.id}
                    onEditingChange={(editing) => setRenaming(editing ? tag.id : null)}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>

      <Divider />
      <div className={clsx('px-2 pb-1 text-[10px]', skin.dim)}>
        Aktives Tag: {doc?.tags?.[activeTagId]?.name ?? 'Standard'} · Strichart:{' '}
        {DASH_OPTIONS.find((option) => option.value === doc?.tags?.[activeTagId]?.dashes)?.label ?? 'Durchgezogen'}
      </div>
    </div>
  )
}
