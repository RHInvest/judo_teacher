/**
 * Rechter Tray.
 *
 * Mehrere Panels sind gleichzeitig offen und einzeln einklappbar; die
 * Reihenfolge laesst sich per Drag & Drop aendern. Unter 1100 px Fensterbreite
 * schrumpft der Tray auf einen Icon-Streifen, aus dem heraus genau ein Panel
 * als Überlagerung aufgeklappt wird.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { PanelRightClose, PanelRightOpen, Plus } from 'lucide-react'
import type { PanelId } from '@/shared/store-api'
import { useSkin } from '@/ui/lib/theme'
import { Tooltip } from '@/ui/components/Tooltip'
import { MenuList } from '@/ui/components/menu'
import { useOutsideClick } from '@/ui/lib/hooks'
import { act, useAppSelector, shallowEqualArray } from '@/ui/state/store'
import { PANEL_META, PANEL_ORDER } from './meta'
import { PANEL_COMPONENTS } from './registry'
import { PanelFrame } from './PanelFrame'

export const TRAY_COLLAPSE_WIDTH = 1100

function PanelBody({ id }: { id: PanelId }) {
  const Component = PANEL_COMPONENTS[id]
  return <Component />
}

/* ------------------------------------------------------------------ */
/* Voller Tray                                                         */
/* ------------------------------------------------------------------ */

function FullTray({
  openPanels,
  activePanel,
  collapsed,
  onToggleCollapsed,
  onReorder,
  onAdd,
}: {
  openPanels: PanelId[]
  activePanel: PanelId | null
  collapsed: Set<PanelId>
  onToggleCollapsed: (panel: PanelId) => void
  onReorder: (from: PanelId, to: PanelId) => void
  onAdd: () => void
}) {
  const skin = useSkin()
  const [dragging, setDragging] = useState<PanelId | null>(null)
  const [dropTarget, setDropTarget] = useState<PanelId | null>(null)

  return (
    <>
      {openPanels.map((id) => {
        const meta = PANEL_META[id]
        if (!meta) return null
        return (
          <PanelFrame
            key={id}
            meta={meta}
            collapsed={collapsed.has(id)}
            active={activePanel === id}
            onToggle={() => onToggleCollapsed(id)}
            onClose={() => act((s) => s.togglePanel(id))}
            onActivate={() => act((s) => s.setActivePanel(id))}
            dropIndicator={dropTarget === id && dragging !== id}
            dragHandlers={{
              draggable: true,
              onDragStart: (event) => {
                setDragging(id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', id)
              },
              onDragOver: (event) => {
                if (!dragging) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(id)
              },
              onDrop: (event) => {
                event.preventDefault()
                const from = (dragging ?? event.dataTransfer.getData('text/plain')) as PanelId
                if (from && from !== id) onReorder(from, id)
                setDragging(null)
                setDropTarget(null)
              },
              onDragEnd: () => {
                setDragging(null)
                setDropTarget(null)
              },
            }}
          >
            <PanelBody id={id} />
          </PanelFrame>
        )
      })}

      <div className="p-1.5">
        <button
          type="button"
          onClick={onAdd}
          aria-label="Weiteres Panel öffnen"
          className={clsx(
            'flex h-7 w-full items-center justify-center gap-1.5 rounded border border-dashed text-[11px] transition-colors',
            skin.border,
            skin.muted,
            skin.hover,
            skin.ring,
          )}
        >
          <Plus size={13} />
          Panel hinzufügen
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Tray                                                                */
/* ------------------------------------------------------------------ */

export function Tray({ compact }: { compact: boolean }) {
  const skin = useSkin()
  const openPanels = useAppSelector((state) => state.ui?.openPanels ?? [], shallowEqualArray)
  const activePanel = useAppSelector((state) => state.ui?.activePanel ?? null)
  const trayVisible = useAppSelector((state) => state.ui?.trayVisible !== false)

  const [collapsed, setCollapsed] = useState<Set<PanelId>>(() => new Set())
  const [order, setOrder] = useState<PanelId[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [strip, setStrip] = useState<PanelId | null>(null)
  const addRef = useOutsideClick<HTMLDivElement>(addOpen, () => setAddOpen(false))
  const stripRef = useOutsideClick<HTMLDivElement>(strip !== null, () => setStrip(null))

  const toggleCollapsed = (panel: PanelId) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(panel)) next.delete(panel)
      else next.add(panel)
      return next
    })
  }

  /**
   * Die Reihenfolge im Tray ist reine Oberflaechensache und liegt deshalb
   * lokal - der Store kennt nur die Menge der offenen Panels.
   */
  const ordered = [
    ...order.filter((id) => openPanels.includes(id)),
    ...openPanels.filter((id) => !order.includes(id)),
  ]

  const reorder = (from: PanelId, to: PanelId) => {
    const list = [...ordered]
    const fromIndex = list.indexOf(from)
    const toIndex = list.indexOf(to)
    if (fromIndex < 0 || toIndex < 0) return
    list.splice(fromIndex, 1)
    list.splice(toIndex, 0, from)
    setOrder(list)
  }

  const closedPanels = PANEL_ORDER.filter((id) => !openPanels.includes(id))

  if (!trayVisible) {
    return (
      <div className={clsx('flex w-8 shrink-0 flex-col items-center border-l py-1.5', skin.chrome, skin.border)}>
        <Tooltip label="Tray einblenden" shortcut="F2" side="left">
          <button
            type="button"
            aria-label="Tray einblenden"
            onClick={() => act((s) => s.setTrayVisible(true))}
            className={clsx('flex h-7 w-7 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <PanelRightOpen size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>
    )
  }

  if (compact) {
    return (
      <div ref={stripRef} className={clsx('relative flex w-10 shrink-0 flex-col items-center border-l py-1.5', skin.chrome, skin.border)}>
        <Tooltip label="Tray ausblenden" shortcut="F2" side="left">
          <button
            type="button"
            aria-label="Tray ausblenden"
            onClick={() => act((s) => s.setTrayVisible(false))}
            className={clsx('mb-1 flex h-7 w-7 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <PanelRightClose size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <div className={clsx('mb-1 h-px w-6', skin.divider)} />

        {PANEL_ORDER.map((id) => {
          const meta = PANEL_META[id]
          const Icon = meta.icon
          const open = openPanels.includes(id)
          return (
            <Tooltip key={id} label={meta.title} shortcut={meta.description} side="left">
              <button
                type="button"
                aria-label={meta.title}
                aria-pressed={strip === id}
                onClick={() => {
                  setStrip(strip === id ? null : id)
                  if (!open) act((s) => s.togglePanel(id))
                  act((s) => s.setActivePanel(id))
                }}
                className={clsx(
                  'mb-0.5 flex h-8 w-8 items-center justify-center rounded',
                  strip === id ? skin.iconBtnActive : open ? clsx(skin.iconBtn, 'text-accent-400') : skin.iconBtn,
                  skin.ring,
                )}
              >
                <Icon size={16} strokeWidth={1.7} />
              </button>
            </Tooltip>
          )
        })}

        {strip ? (
          <div
            className={clsx('absolute right-full top-0 z-40 mr-1 w-[288px] overflow-y-auto rounded border', skin.floating, skin.shadow)}
            style={{ maxHeight: 'calc(100vh - 120px)' }}
          >
            <PanelFrame
              meta={PANEL_META[strip]}
              collapsed={false}
              active
              onToggle={() => setStrip(null)}
              onClose={() => setStrip(null)}
              onActivate={() => undefined}
            >
              <PanelBody id={strip} />
            </PanelFrame>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <aside
      aria-label="Panels"
      className={clsx('flex w-[292px] shrink-0 flex-col overflow-y-auto border-l', skin.panel, skin.border)}
    >
      <div className={clsx('flex h-7 shrink-0 items-center gap-1 border-b px-1.5', skin.border)}>
        <span className={clsx('min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide', skin.dim)}>
          Standard-Tray
        </span>
        <div ref={addRef} className="relative">
          <button
            type="button"
            aria-label="Weiteres Panel öffnen"
            aria-expanded={addOpen}
            onClick={() => setAddOpen(!addOpen)}
            className={clsx('flex h-5 w-5 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <Plus size={13} />
          </button>
          {addOpen ? (
            <div className="absolute right-0 top-6 z-50">
              <MenuList
                minWidth={200}
                onClose={() => setAddOpen(false)}
                entries={
                  closedPanels.length === 0
                    ? [{ label: 'Alle Panels sind offen', disabled: true }]
                    : closedPanels.map((id) => ({
                        label: PANEL_META[id].title,
                        icon: PANEL_META[id].icon,
                        run: () => act((s) => s.togglePanel(id)),
                      }))
                }
              />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Tray ausblenden"
          onClick={() => act((s) => s.setTrayVisible(false))}
          className={clsx('flex h-5 w-5 items-center justify-center rounded', skin.iconBtn, skin.ring)}
        >
          <PanelRightClose size={13} />
        </button>
      </div>

      <FullTray
        openPanels={ordered}
        activePanel={activePanel}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onReorder={reorder}
        onAdd={() => setAddOpen(true)}
      />
    </aside>
  )
}
