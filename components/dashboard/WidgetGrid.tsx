'use client'

import React, { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AlertCard } from './AlertCard'
import { ActivityFeed } from './ActivityFeed'
import type { AlertCardProps } from './AlertCard'
import type { ActivityItem } from '@/types'
import { sanitizeWidgetLayout } from '@/lib/dashboard/layout'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// recharts is heavy (~150–400 КБ gz). Load the chart only when the optional
// 'chart' widget is actually rendered, so it never lands in the dashboard's
// first-load JS. Pattern mirrors gri/page.tsx.
const KpiChart = dynamic(() => import('./KpiChart').then((m) => m.KpiChart), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse bg-surface-container-high rounded-xl" />,
})

// ─── Types ──────────────────────────────────────────────────────
type WidgetType = 'alerts' | 'activity' | 'gri' | 'metrics' | 'chart' | 'quick-links'
type GridSpan = 'full' | 'two-thirds' | 'third'

interface WidgetInstance { id: string; type: WidgetType }

interface WidgetData {
  alerts: AlertCardProps[]
  activity: ActivityItem[]
  gri: { label: string; pct: number; color: string }[]
  metrics: { name: string; value: string; up: boolean | null }[]
  criticalCount: number
}

// ─── Widget Catalog ─────────────────────────────────────────────
const CATALOG: Record<WidgetType, {
  label: string
  description: string
  icon: string
  span: GridSpan
}> = {
  alerts:        { label: 'Критические сигналы', description: 'Алерты и сигналы по клиентам',   icon: 'warning',          span: 'full'       },
  activity:      { label: 'Последние события',    description: 'Лента активности команды',        icon: 'history',          span: 'two-thirds' },
  gri:           { label: 'Прогресс по GRI',      description: 'GRI скоринг по факторам',        icon: 'radar',            span: 'third'      },
  metrics:       { label: 'Ключевые метрики',     description: 'Основные бизнес-показатели',     icon: 'monitoring',       span: 'third'      },
  chart:         { label: 'График динамики',      description: 'Интерактивный график метрик',    icon: 'show_chart',       span: 'two-thirds' },
  'quick-links': { label: 'Быстрый доступ',       description: 'Ссылки на разделы платформы',   icon: 'grid_view',        span: 'third'      },
}

const CATALOG_TYPES = Object.keys(CATALOG) as WidgetType[]

const SPAN_CLASS: Record<GridSpan, string> = {
  full:       'col-span-3',
  'two-thirds': 'col-span-3 lg:col-span-2',
  third:      'col-span-3 lg:col-span-1',
}

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: 'default-alerts',   type: 'alerts'   },
  { id: 'default-activity', type: 'activity' },
  { id: 'default-gri',      type: 'gri'      },
]

// ─── Individual Widget Contents ──────────────────────────────────

function AlertsWidget({ data }: { data: WidgetData }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Требуют внимания</p>
        <span className="font-mono text-[10px] text-error bg-error/10 px-2.5 py-0.5 rounded-full border border-error/20">
          {data.criticalCount} алерта
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {data.alerts.map((alert) => (
          <AlertCard key={alert.id} {...alert} />
        ))}
      </div>
    </div>
  )
}

function ActivityWidget({ data }: { data: WidgetData }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Лента событий</p>
        <Link href="/clients" className="text-[11px] font-mono text-primary/60 hover:text-primary flex items-center gap-0.5 transition-colors">
          Все <span className="material-symbols-outlined text-sm">chevron_right</span>
        </Link>
      </div>
      <ActivityFeed items={data.activity} />
    </div>
  )
}

function GriWidget({ data }: { data: WidgetData }) {
  return (
    <Link href="/gri" className="block group">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">GRI Скоринг</p>
        <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">arrow_forward</span>
      </div>
      <div className="space-y-3">
        {data.gri.map((item) => (
          <div key={item.label}>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-on-surface-variant">{item.label}</span>
              <span className="font-mono font-bold text-on-surface">{item.pct}/100</span>
            </div>
            <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${item.pct}%`, background: item.color }} />
            </div>
          </div>
        ))}
      </div>
    </Link>
  )
}

function MetricsWidget({ data }: { data: WidgetData }) {
  return (
    <Link href="/metrics" className="block group">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Ключевые метрики</p>
        <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">arrow_forward</span>
      </div>
      <div className="space-y-2">
        {data.metrics.map((item) => (
          <div key={item.name} className="flex justify-between items-center py-1 border-b border-white/[0.03] last:border-0">
            <span className="text-xs text-on-surface-variant">{item.name}</span>
            <span className={`font-mono text-sm font-bold ${
              item.up === true ? 'text-primary' : item.up === false ? 'text-error' : 'text-on-surface'
            }`}>{item.value}</span>
          </div>
        ))}
      </div>
    </Link>
  )
}

function ChartWidget() {
  return (
    <div>
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">График динамики</p>
      <KpiChart />
    </div>
  )
}

function QuickLinksWidget() {
  // Client-reachable destinations only (mirror middleware CLIENT_DASHBOARD_PATHS).
  const links = [
    { label: 'GRI',      icon: 'radar',       href: '/gri'       },
    { label: 'Точка А',  icon: 'my_location', href: '/point-a'   },
    { label: 'Точка Б',  icon: 'flag',        href: '/point-b'   },
    { label: 'Метрики',  icon: 'monitoring',  href: '/metrics'   },
    { label: 'Рынок',    icon: 'public',      href: '/market'    },
    { label: 'Уведомления', icon: 'notifications', href: '/notifications' },
  ]
  return (
    <div>
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">Быстрый доступ</p>
      <div className="grid grid-cols-3 gap-2">
        {links.map(l => (
          <Link key={l.label} href={l.href}
            className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest border border-white/[0.03] hover:border-primary/20 transition-all group">
            <span className="material-symbols-outlined text-lg text-on-surface-variant/50 group-hover:text-primary transition-colors">{l.icon}</span>
            <span className="text-[10px] font-mono text-on-surface-variant group-hover:text-on-surface transition-colors">{l.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function WidgetContent({ type, data }: { type: WidgetType; data: WidgetData }) {
  switch (type) {
    case 'alerts':        return <AlertsWidget data={data} />
    case 'activity':      return <ActivityWidget data={data} />
    case 'gri':           return <GriWidget data={data} />
    case 'metrics':       return <MetricsWidget data={data} />
    case 'chart':         return <ChartWidget />
    case 'quick-links':   return <QuickLinksWidget />
    default:              return null
  }
}

// ─── Sortable Widget Card ─────────────────────────────────────────
interface WidgetCardProps {
  widget: WidgetInstance
  editMode: boolean
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
  data: WidgetData
}

function SortableWidgetCard({
  widget, editMode, onRemove, onMoveUp, onMoveDown, isFirst, isLast, data,
}: WidgetCardProps) {
  const meta = CATALOG[widget.type]
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editMode,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className={`${SPAN_CLASS[meta.span]} relative`}>
      <div className={`
        bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 h-full
        transition-colors duration-200
        ${editMode ? 'border-primary/10 shadow-primary-sm ring-1 ring-primary/5' : ''}
      `}>
        {/* Edit-mode controls */}
        {editMode && (
          <div className="absolute -top-2.5 right-3 flex items-center gap-1 z-10">
            {/* Drag handle (touch-friendly); move up/down are the a11y fallback */}
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label="Перетащить виджет"
              className="w-8 h-8 rounded-lg bg-surface-container-highest border border-white/10 flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-grab active:cursor-grabbing touch-none"
            >
              <span className="material-symbols-outlined text-sm">drag_indicator</span>
            </button>
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              aria-label="Выше"
              className="w-8 h-8 rounded-lg bg-surface-container-highest border border-white/10 flex items-center justify-center text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">arrow_upward</span>
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              aria-label="Ниже"
              className="w-8 h-8 rounded-lg bg-surface-container-highest border border-white/10 flex items-center justify-center text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">arrow_downward</span>
            </button>
            <button
              onClick={onRemove}
              aria-label="Удалить виджет"
              className="w-8 h-8 rounded-lg bg-error/15 border border-error/30 flex items-center justify-center text-error hover:bg-error/25 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        {editMode && (
          <div className="absolute top-2 left-4 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-xs text-primary/40">{meta.icon}</span>
            <span className="text-[10px] font-mono text-primary/40 uppercase tracking-wider">{meta.label}</span>
          </div>
        )}

        <div className={editMode ? 'pt-5 pointer-events-none opacity-60 select-none' : ''}>
          <WidgetContent type={widget.type} data={data} />
        </div>
      </div>
    </div>
  )
}

// ─── Add Widget Dialog ────────────────────────────────────────────
function AddWidgetDialog({
  open, onClose, existingTypes, onAdd,
}: {
  open: boolean
  onClose: () => void
  existingTypes: WidgetType[]
  onAdd: (type: WidgetType) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-surface border-l border-white/[0.06] z-50 shadow-modal flex flex-col">
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.04]">
            <div>
              <Dialog.Title className="font-headline font-bold text-on-surface text-lg">Виджеты</Dialog.Title>
              <p className="text-xs text-on-surface-variant mt-0.5">Добавьте на дэшборд</p>
            </div>
            <Dialog.Close className="w-8 h-8 rounded-xl bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-sm">close</span>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {(Object.entries(CATALOG) as [WidgetType, typeof CATALOG[WidgetType]][]).map(([type, meta]) => {
              const alreadyAdded = existingTypes.includes(type)
              return (
                <button
                  key={type}
                  onClick={() => !alreadyAdded && onAdd(type)}
                  disabled={alreadyAdded}
                  className={`
                    w-full flex items-start gap-4 p-4 rounded-2xl border text-left transition-all
                    ${alreadyAdded
                      ? 'border-white/[0.03] opacity-40 cursor-not-allowed'
                      : 'border-white/[0.04] hover:border-primary/25 hover:bg-surface-container-low cursor-pointer group'
                    }
                  `}
                >
                  <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center flex-shrink-0">
                    <span className={`material-symbols-outlined text-lg ${alreadyAdded ? 'text-on-surface-variant/30' : 'text-primary/60 group-hover:text-primary'} transition-colors`}>
                      {meta.icon}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-on-surface">{meta.label}</p>
                      {alreadyAdded
                        ? <span className="text-[10px] font-mono text-on-surface-variant/40 bg-surface-container-high px-2 py-0.5 rounded-full">Добавлен</span>
                        : <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">add</span>
                      }
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5">{meta.description}</p>
                    <span className="text-[10px] font-mono text-on-surface-variant/40 mt-1 inline-block">
                      {meta.span === 'full' ? '▬▬▬ Полная ширина' : meta.span === 'two-thirds' ? '▬▬ 2/3 ширины' : '▬ 1/3 ширины'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="px-6 py-4 border-t border-white/[0.04]">
            <p className="text-[10px] text-on-surface-variant/50 font-mono text-center">
              Настройки сохраняются автоматически
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── Main WidgetGrid Component ────────────────────────────────────
export interface WidgetGridProps {
  alerts: AlertCardProps[]
  activity: ActivityItem[]
  gri: { label: string; pct: number; color: string }[]
  metrics: { name: string; value: string; up: boolean | null }[]
  criticalCount: number
  userId?: string
  /** Which dashboard this layout belongs to (client / admin / medical…). */
  surface?: string
}

export function WidgetGrid({ alerts, activity, gri, metrics, criticalCount, surface = 'client' }: WidgetGridProps) {
  const [widgets, setWidgets] = useState<WidgetInstance[]>(DEFAULT_WIDGETS)
  const [editMode, setEditMode] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // DASH-01: load the saved layout from the DB (was localStorage-only, so it
  // never followed the user across devices). Sanitize against the catalog.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/dashboard/layout?surface=${encodeURIComponent(surface)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const clean = sanitizeWidgetLayout(j?.layout, CATALOG_TYPES, DEFAULT_WIDGETS)
        setWidgets(clean as WidgetInstance[])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [surface])

  // Persist (debounced) after the initial load has completed.
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      fetch('/api/v1/dashboard/layout', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface, layout: widgets }),
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [widgets, surface, loaded])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setWidgets((prev) => {
      const from = prev.findIndex((w) => w.id === active.id)
      const to = prev.findIndex((w) => w.id === over.id)
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }, [])

  const addWidget = useCallback((type: WidgetType) => {
    setWidgets((prev) => [...prev, { id: `${type}-${crypto.randomUUID().slice(0, 8)}`, type }])
    setAddOpen(false)
  }, [])

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const moveWidget = useCallback((id: string, dir: 'up' | 'down') => {
    setWidgets((prev) => {
      const idx = prev.findIndex((w) => w.id === id)
      if (dir === 'up' && idx <= 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      return arrayMove(prev, idx, dir === 'up' ? idx - 1 : idx + 1)
    })
  }, [])

  const resetWidgets = useCallback(() => {
    setWidgets(DEFAULT_WIDGETS)
  }, [])

  const existingTypes = widgets.map((w) => w.type)
  const data: WidgetData = { alerts, activity, gri, metrics, criticalCount }

  return (
    <div>
      {/* Section toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-headline text-base font-bold text-on-surface">Мой дэшборд</h2>
          <p className="text-[11px] text-on-surface-variant mt-0.5">
            {widgets.length} виджет{widgets.length === 1 ? '' : widgets.length < 5 ? 'а' : 'ов'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editMode && (
            <>
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Добавить
              </button>
              <button
                onClick={resetWidgets}
                className="text-xs font-mono px-3 py-1.5 rounded-xl bg-surface-container border border-white/[0.06] text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Сбросить
              </button>
            </>
          )}
          <button
            onClick={() => setEditMode((e) => !e)}
            className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl border transition-all
              ${editMode
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface-container-low border-white/[0.06] text-on-surface-variant hover:text-on-surface hover:border-white/10'
              }`}
          >
            <span className="material-symbols-outlined text-sm">{editMode ? 'check' : 'dashboard_customize'}</span>
            {editMode ? 'Готово' : 'Настроить'}
          </button>
        </div>
      </div>

      {/* Widget grid — 3-column CSS grid, drag-sortable in edit mode */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-3 gap-4 auto-rows-auto">
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            {widgets.map((widget, idx) => (
              <SortableWidgetCard
                key={widget.id}
                widget={widget}
                editMode={editMode}
                onRemove={() => removeWidget(widget.id)}
                onMoveUp={() => moveWidget(widget.id, 'up')}
                onMoveDown={() => moveWidget(widget.id, 'down')}
                isFirst={idx === 0}
                isLast={idx === widgets.length - 1}
                data={data}
              />
            ))}
          </SortableContext>

          {/* Empty state */}
          {widgets.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-3 flex flex-col items-center justify-center py-16 bg-surface-container-low rounded-2xl border border-dashed border-white/10"
            >
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-3">dashboard_customize</span>
              <p className="text-sm text-on-surface-variant mb-4">Дэшборд пуст. Добавьте виджеты.</p>
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 text-sm font-mono px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Добавить виджет
              </button>
            </motion.div>
          )}
        </div>
      </DndContext>

      <AddWidgetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingTypes={existingTypes}
        onAdd={addWidget}
      />
    </div>
  )
}
