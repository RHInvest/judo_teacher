/** Komponenten: Bibliothekskacheln und Definitionen im Modell. */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Box, EllipsisVertical, Package } from 'lucide-react'
import { getLibraryCategories, getLibraryComponents } from '@/io'
import type { LibraryEntry } from '@/io'
import { bus } from '@/shared/events'
import type { Definition, Id } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { EmptyHint, GroupTitle, IconButton, Row, Select, TextInput } from '@/ui/components/controls'
import { MenuList } from '@/ui/components/menu'
import { useOutsideClick } from '@/ui/lib/hooks'
import { act, edit, toast, useApp } from '@/ui/state/store'

function safeCategories(): string[] {
  try {
    return getLibraryCategories() ?? []
  } catch {
    return []
  }
}

function safeComponents(category?: string): LibraryEntry[] {
  try {
    return getLibraryComponents(category) ?? []
  } catch {
    return []
  }
}

function placeLibraryEntry(entry: LibraryEntry): void {
  try {
    const built = entry.build()
    edit(`${entry.name} einfügen`, (s) => {
      for (const definition of built.definitions) s.upsertDefinition(definition)
    })
    bus.emit('component:place', { definitionId: built.rootId })
  } catch (err) {
    console.warn('[ui] Komponente konnte nicht erzeugt werden', err)
    toast('Diese Komponente ist noch nicht verfügbar.', 'warn')
  }
}

export function ComponentsPanel() {
  const skin = useSkin()
  const state = useApp()
  const [category, setCategory] = useState('*')
  const [search, setSearch] = useState('')
  const [menuFor, setMenuFor] = useState<Id | null>(null)
  const menuRef = useOutsideClick<HTMLDivElement>(menuFor !== null, () => setMenuFor(null))

  const categories = useMemo(() => safeCategories(), [])
  const entries = useMemo(
    () => safeComponents(category === '*' ? undefined : category),
    [category],
  )

  const filtered = entries.filter(
    (entry) => search.trim() === '' || entry.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const definitions: Definition[] = Object.values(state.doc?.definitions ?? {}).filter(
    (definition) => definition.kind !== 'model' && !definition.isLibrary,
  )

  return (
    <div className="flex flex-col">
      <GroupTitle>Bibliothek</GroupTitle>
      <Row label="Kategorie">
        <Select
          ariaLabel="Komponentenkategorie"
          value={category}
          options={[{ value: '*', label: 'Alle Kategorien' }, ...categories.map((entry) => ({ value: entry, label: entry }))]}
          onChange={setCategory}
        />
      </Row>
      <Row label="Suche">
        <TextInput value={search} onChange={setSearch} ariaLabel="Komponente suchen" placeholder="Name ..." />
      </Row>

      <div className="max-h-[220px] overflow-y-auto px-2 py-1.5">
        {filtered.length === 0 ? (
          <EmptyHint>Die Komponentenbibliothek ist noch nicht gefüllt.</EmptyHint>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(78px,1fr))] gap-1.5">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => placeLibraryEntry(entry)}
                title={entry.description}
                aria-label={`${entry.name} einfügen`}
                className={clsx(
                  'flex flex-col items-center gap-1 rounded border p-1.5 text-center transition-colors',
                  skin.border,
                  skin.hover,
                  skin.ring,
                )}
              >
                <span className={clsx('flex h-11 w-full items-center justify-center rounded', skin.well, skin.dim)}>
                  <Package size={22} strokeWidth={1.4} />
                </span>
                <span className={clsx('w-full truncate text-[11px]', skin.text)}>{entry.name}</span>
                {entry.size ? <span className={clsx('w-full truncate text-[10px]', skin.dim)}>{entry.size}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <GroupTitle>Im Modell</GroupTitle>
      <div className="max-h-[200px] overflow-y-auto px-1 pb-1">
        {definitions.length === 0 ? (
          <EmptyHint>Noch keine Gruppen oder Komponenten angelegt.</EmptyHint>
        ) : (
          definitions.map((definition) => (
            <div
              key={definition.id}
              className={clsx('group relative flex h-7 items-center gap-2 rounded px-1.5', skin.hover)}
            >
              <Box size={13} className={clsx('shrink-0', skin.muted)} />
              <span className={clsx('min-w-0 flex-1 truncate text-[12px]', skin.text)}>{definition.name}</span>
              <span className={clsx('shrink-0 text-[11px] tabular-nums', skin.dim)}>
                {definition.instanceCount ?? 0}x
              </span>
              <IconButton
                icon={EllipsisVertical}
                ariaLabel={`Aktionen für ${definition.name}`}
                onClick={() => setMenuFor(menuFor === definition.id ? null : definition.id)}
              />
              {menuFor === definition.id ? (
                <div ref={menuRef} className="absolute right-1 top-7 z-40">
                  <MenuList
                    minWidth={186}
                    onClose={() => setMenuFor(null)}
                    entries={[
                      {
                        label: 'Bearbeiten',
                        run: () => {
                          const instance = Object.values(state.doc?.entities ?? {}).find(
                            (entity) => entity.type === 'instance' && entity.definitionId === definition.id,
                          )
                          if (instance) act((s) => s.enterContext(instance.id))
                          else toast('Es gibt noch keine Instanz dieser Definition.', 'warn')
                        },
                      },
                      {
                        label: 'Instanz einfügen',
                        run: () => bus.emit('component:place', { definitionId: definition.id }),
                      },
                      {
                        label: 'Eindeutig machen',
                        run: () => {
                          const ids = Object.values(state.doc?.entities ?? {})
                            .filter((entity) => entity.type === 'instance' && entity.definitionId === definition.id)
                            .map((entity) => entity.id)
                          if (ids.length === 0) return
                          edit('Eindeutig machen', (s) => s.makeUnique(ids))
                        },
                      },
                      { kind: 'separator' },
                      {
                        label: 'Löschen',
                        run: () => edit('Definition löschen', (s) => s.removeDefinition(definition.id)),
                      },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
