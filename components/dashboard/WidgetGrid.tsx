'use client'

import React, { useState, useEffect, useCallback, forwardRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { AlertCard } from './AlertCard'
import { ActivityFeed } from './ActivityFeed'
import { KpiChart } from './KpiChart'
import type { AlertCardProps } from './AlertCard'
import type { ActivityItem } from '@/types'

// ─── Types ──────────────────────────────────────────────────────
type WidgetType = 'alerts' | 'activity' | 'gri' | 'metrics' | 'chart' | 'quick-links' | 'clients-stats'
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
  'clients-stats':{ label: 'Статистика клиентов', description: 'Обзор клиентской базы',         icon: 'groups',           span: 'third'      },
}

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

const STORAGE_KEY = 'aistart360_dashboard_widgets_v2'

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
  const links = [
    { label: 'Рынок',    icon: 'public',      href: '/market'    },
    { label: 'Клиенты',  icon: 'group',       href: '/clients'   },
    { label: 'Метрики',  icon: 'monitoring',  href: '/metrics'   },
    { label: 'GRI',      icon: 'radar',       href: '/gri'       },
    { label: 'Инсайты',  icon: 'lightbulb',   href: '/insights'  },
    { label: 'AI Скан',  icon: 'biotech',     href: '/ai-scanner'},
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

function ClientsStatsWidget({ data }: { data: WidgetData }) {
  const stats = [
    { label: 'Всего клиентов', value: data.activity.length > 0 ? '48' : '0', icon: 'groups', color: 'text-primary' },
    { label: 'Активных',       value: '38', icon: 'check_circle', color: 'text-primary' },
    { label: 'Под риском',     value: '6',  icon: 'warning',      color: 'text-error'   },
    { label: 'Ср. GRI',        value: '7.6',icon: 'radar',        color: 'text-secondary'},
  ]
  return (
    <Link href="/clients" className="block group">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Клиенты</p>
        <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-primary/60 transition-colors">arrow_forward</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {stats.map(s => (
          <div key={s.label} className="bg-surface-container-high rounded-xl p-3 border border-white/[0.03]">
            <span className={`material-symbols-outlined text-sm ${s.color} opacity-60 mb-1 block`}>{s.icon}</span>
            <p className={`text-xl font-mono font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-on-surface-variant mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
    </Link>
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
    case 'clients-stats': return <ClientsStatsWidget data={data} />
    default:              return null
  }
}

// ─── Widget Wrapper ───────────────────────────────────────────────
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

const WidgetCard = forwardRef(function WidgetCard(
  { widget, editMode, onRemove, onMoveUp, onMoveDown, isFirst, isLast, data }: WidgetCardProps,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const meta = CATALOG[widget.type]
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.2 }}
      className={`${SPAN_CLASS[meta.span]} relative`}
    >
      <div className={`
        bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 h-full
        transition-all duration-200
        ${editMode ? 'border-primary/10 shadow-primary-sm ring-1 ring-primary/5' : ''}
      `}>
        {/* Edit mode controls */}
        {editMode && (
          <div className="absolute -top-2.5 right-3 flex items-center gap-1 z-10">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className="w-6 h-6 rounded-lg bg-surface-container-highest border border-white/10 flex items-center justify-center text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors"
            >
              <span className="material-symbols-outlined text-xs">arrow_upward</span>
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className="w-6 h-6 rounded-lg bg-surface-container-highest border border-white/10 flex items-center justify-center text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors"
            >
              <span className="material-symbols-outlined text-xs">arrow_downward</span>
            </button>
            <button
              onClick={onRemove}
              className="w-6 h-6 rounded-lg bg-error/15 border border-error/30 flex items-center justify-center text-error hover:bg-error/25 transition-colors"
            >
              <span className="material-symbols-outlined text-xs">close</span>
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
    </motion.div>
  )
})

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
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.04]">
            <div>
              <Dialog.Title className="font-headline font-bold text-on-surface text-lg">Виджеты</Dialog.Title>
              <p className="text-xs text-on-surface-variant mt-0.5">Добавьте на дэшборд</p>
            </div>
            <Dialog.Close className="w-8 h-8 rounded-xl bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-sm">close</span>
            </Dialog.Close>
          </div>

          {/* Widget list */}
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
}

export function WidgetGrid({ alerts, activity, gri, metrics, criticalCount, userId }: WidgetGridProps) {
  const storageKey = userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY

  const [widgets, setWidgets] = useState<WidgetInstance[]>(DEFAULT_WIDGETS)
  const [editMode, setEditMode] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) setWidgets(parsed)
      }
    } catch {}
  }, [storageKey])

  useEffect(() => {
    if (mounted) {
      localStorage.setItem(storageKey, JSON.stringify(widgets))
    }
  }, [widgets, storageKey, mounted])

  const addWidget = useCallback((type: WidgetType) => {
    setWidgets(prev => [...prev, { id: `widget-${Date.now()}`, type }])
    setAddOpen(false)
  }, [])

  const removeWidget = useCallback((id: string) => {
    setWidgets(prev => prev.filter(w => w.id !== id))
  }, [])

  const moveWidget = useCallback((id: string, dir: 'up' | 'down') => {
    setWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id)
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      const next = [...prev]
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next
    })
  }, [])

  const resetWidgets = useCallback(() => {
    setWidgets(DEFAULT_WIDGETS)
  }, [])

  const existingTypes = widgets.map(w => w.type)
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
            onClick={() => setEditMode(e => !e)}
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

      {/* Widget grid — 3-column CSS grid */}
      <div className="grid grid-cols-3 gap-4 auto-rows-auto">
        <AnimatePresence mode="popLayout">
          {widgets.map((widget, idx) => (
            <WidgetCard
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
        </AnimatePresence>

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

      <AddWidgetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingTypes={existingTypes}
        onAdd={addWidget}
      />
    </div>
  )
}
