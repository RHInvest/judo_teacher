/**
 * Outliner: Baum aller Instanzen und Annotationen des Modells.
 *
 * Bedienung (bewusst so aufgeteilt, weil beide Doppelklick-Gesten gefordert sind):
 *  - Einfacher Klick auf die Zeile waehlt die Entitaet aus.
 *  - Doppelklick auf den NAMEN benennt um.
 *  - Doppelklick auf die uebrige Zeile betritt den Kontext der Gruppe/Komponente.
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Box,
  ChevronDown,
  ChevronRight,
  Component,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Ruler,
  Scissors,
  Spline,
  Type,
} from 'lucide-react'
import type { Entity, Id } from '@/shared/types'
import type { LucideIcon } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { EmptyHint, IconButton, InlineEdit, TextInput } from '@/ui/components/controls'
import { act, edit, useApp } from '@/ui/state/store'

const ENTITY_ICONS: Record<Entity['type'], LucideIcon> = {
  instance: Box,
  dimension: Ruler,
  text: Type,
  sectionPlane: Scissors,
  guidePoint: Spline,
  guideLine: Spline,
  image: ImageIcon,
}

const ENTITY_LABELS: Record<Entity['type'], string> = {
  instance: 'Instanz',
  dimension: 'Bemassung',
  text: 'Text',
  sectionPlane: 'Schnittebene',
  guidePoint: 'Hilfspunkt',
  guideLine: 'Hilfslinie',
  image: 'Bild',
}

interface Node {
  entity: Entity
  depth: number
  children: Node[]
  definitionName: string | null
  isComponent: boolean
}

export function OutlinerPanel() {
  const skin = useSkin()
  const state = useApp()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<Id>>(() => new Set())
  const [renaming, setRenaming] = useState<Id | null>(null)

  const doc = state.doc
  const selectedIds = state.selection?.entityIds ?? []
  const contextPath = state.context?.instancePath ?? []

  const tree = useMemo<Node[]>(() => {
    if (!doc) return []
    const build = (definitionId: Id, depth: number, guard: Set<Id>): Node[] => {
      if (depth > 24 || guard.has(definitionId)) return []
      const definition = doc.definitions?.[definitionId]
      if (!definition) return []
      const nextGuard = new Set(guard)
      nextGuard.add(definitionId)
      const nodes: Node[] = []
      for (const childId of definition.children ?? []) {
        const entity = doc.entities?.[childId]
        if (!entity) continue
        const childDefinition = entity.type === 'instance' ? doc.definitions?.[entity.definitionId] : undefined
        nodes.push({
          entity,
          depth,
          children: entity.type === 'instance' ? build(entity.definitionId, depth + 1, nextGuard) : [],
          definitionName: childDefinition?.name ?? null,
          isComponent: childDefinition?.kind === 'component',
        })
      }
      return nodes
    }
    return build(doc.rootId, 0, new Set())
  }, [doc])

  const query = search.trim().toLowerCase()

  const matches = (node: Node): boolean => {
    if (query === '') return true
    const label = `${node.entity.name} ${node.definitionName ?? ''}`.toLowerCase()
    return label.includes(query) || node.children.some(matches)
  }

  const rows: Node[] = []
  const flatten = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!matches(node)) continue
      rows.push(node)
      const isCollapsed = collapsed.has(node.entity.id) && query === ''
      if (!isCollapsed) flatten(node.children)
    }
  }
  flatten(tree)

  const toggleCollapsed = (id: Id) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col">
      <div className="px-2 pb-1 pt-1.5">
        <TextInput value={search} onChange={setSearch} ariaLabel="Outliner durchsuchen" placeholder="Suchen ..." />
      </div>

      <div className="max-h-[340px] overflow-y-auto px-1 pb-1" role="tree" aria-label="Modellstruktur">
        {rows.length === 0 ? (
          <EmptyHint>
            {tree.length === 0
              ? 'Das Modell enthaelt noch keine Gruppen, Komponenten oder Annotationen.'
              : 'Kein Eintrag passt zur Suche.'}
          </EmptyHint>
        ) : (
          rows.map((node) => {
            const entity = node.entity
            const Icon = node.isComponent ? Component : ENTITY_ICONS[entity.type]
            const selected = selectedIds.includes(entity.id)
            const inPath = contextPath.includes(entity.id)
            const hasChildren = node.children.length > 0
            const isCollapsed = collapsed.has(entity.id)
            const label = entity.name || node.definitionName || ENTITY_LABELS[entity.type]

            return (
              <div
                key={entity.id}
                role="treeitem"
                aria-selected={selected}
                aria-expanded={hasChildren ? !isCollapsed : undefined}
                tabIndex={0}
                onClick={() =>
                  act((s) => s.setSelection({ edgeIds: [], faceIds: [], vertexIds: [], entityIds: [entity.id] }))
                }
                onDoubleClick={() => {
                  if (entity.type === 'instance') act((s) => s.enterContext(entity.id))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') act((s) => s.enterContext(entity.id))
                  if (event.key === 'F2') setRenaming(entity.id)
                }}
                className={clsx(
                  'group flex h-7 cursor-default items-center gap-1 rounded pr-1',
                  selected ? skin.selected : skin.hover,
                  inPath && !selected && 'text-accent-400',
                  skin.ring,
                )}
                style={{ paddingLeft: 2 + node.depth * 12 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    aria-label={isCollapsed ? `${label} ausklappen` : `${label} einklappen`}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleCollapsed(entity.id)
                    }}
                    className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded', skin.iconBtn)}
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                ) : (
                  <span className="h-4 w-4 shrink-0" />
                )}

                <Icon size={13} strokeWidth={1.8} className={clsx('shrink-0', selected ? '' : skin.muted)} />

                <span
                  className="min-w-0 flex-1"
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    setRenaming(entity.id)
                  }}
                >
                  <InlineEdit
                    value={label}
                    editing={renaming === entity.id}
                    ariaLabel={`Name von ${label}`}
                    className="text-[12px]"
                    onEditingChange={(editing) => setRenaming(editing ? entity.id : null)}
                    onCommit={(next) => edit('Umbenennen', (s) => s.setEntityName(entity.id, next))}
                  />
                </span>

                {node.definitionName && node.definitionName !== label ? (
                  <span className={clsx('shrink-0 truncate text-[10px]', skin.dim)}>{node.definitionName}</span>
                ) : null}

                <IconButton
                  icon={entity.locked ? Lock : LockOpen}
                  size={12}
                  ariaLabel={entity.locked ? `${label} entsperren` : `${label} sperren`}
                  className={entity.locked ? '' : 'opacity-0 group-hover:opacity-100'}
                  onClick={(event) => {
                    event.stopPropagation()
                    edit(entity.locked ? 'Entsperren' : 'Sperren', (s) => s.setEntityLocked([entity.id], !entity.locked))
                  }}
                />
                <IconButton
                  icon={entity.hidden ? EyeOff : Eye}
                  size={12}
                  ariaLabel={entity.hidden ? `${label} einblenden` : `${label} verstecken`}
                  className={entity.hidden ? 'opacity-60' : 'opacity-0 group-hover:opacity-100'}
                  onClick={(event) => {
                    event.stopPropagation()
                    edit(entity.hidden ? 'Einblenden' : 'Verstecken', (s) =>
                      s.setEntityHidden([entity.id], !entity.hidden),
                    )
                  }}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
