'use client'

import { useState, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMetricsCatalog } from '@/hooks/useMetrics'
import { useMetricsStore } from '@/stores/metrics.store'
import { MAX_METRICS } from '@/types/metrics'
import type { MetricDefinition } from '@/types/metrics'
import { toast } from '@/stores/ui.store'

const CATEGORY_LABELS: Record<string, string> = {
  financial:   'Финансовые',
  operational: 'Операционные',
  customer:    'Клиентские',
  custom:      'Кастомные',
}

interface AddMetricModalProps {
  open: boolean
  onClose: () => void
}

export function AddMetricModal({ open, onClose }: AddMetricModalProps) {
  const { data: catalog = [], isLoading } = useMetricsCatalog()
  const { visibleMetricIds, hiddenMetricIds, addMetric } = useMetricsStore()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const allActiveIds = new Set([...visibleMetricIds, ...hiddenMetricIds])
  const totalCount = allActiveIds.size

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return catalog.filter(
      (m) => !allActiveIds.has(m.id) && (m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q))
    )
  }, [catalog, allActiveIds, search])

  const grouped = useMemo(() => {
    const g: Record<string, MetricDefinition[]> = {}
    for (const m of filtered) {
      if (!g[m.category]) g[m.category] = []
      g[m.category].push(m)
    }
    return g
  }, [filtered])

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleConfirm = () => {
    const canAdd = MAX_METRICS - totalCount
    const toAdd = selected.slice(0, canAdd)
    if (selected.length > canAdd) {
      toast.warning(`Добавлено ${canAdd} из ${selected.length}`, `Достигнут лимит ${MAX_METRICS} метрик`)
    }
    toAdd.forEach((id) => addMetric(id))
    setSelected([])
    onClose()
  }

  const wouldExceed = totalCount + selected.length >= MAX_METRICS
  const remaining = MAX_METRICS - totalCount

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            className="relative z-10 w-full sm:max-w-xl bg-surface-container-low rounded-t-2xl sm:rounded-2xl border border-white/[0.08] shadow-2xl flex flex-col max-h-[85vh]"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-base font-bold text-on-surface">Добавить метрику</h3>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    {totalCount} из {MAX_METRICS} · осталось {remaining}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-white/[0.06] transition-all"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск метрики..."
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 transition-all"
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
              {isLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
                  ))}
                </div>
              )}

              {!isLoading && filtered.length === 0 && (
                <div className="py-10 text-center">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant/20 mb-2 block">search_off</span>
                  <p className="text-sm text-on-surface-variant/40">Метрики не найдены</p>
                </div>
              )}

              {Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                  <p className="text-[10px] font-mono text-on-surface-variant/40 uppercase tracking-widest mb-2">
                    {CATEGORY_LABELS[category] ?? category}
                  </p>
                  <div className="space-y-1.5">
                    {items.map((m) => {
                      const isSelected = selected.includes(m.id)
                      const isDisabled = !isSelected && wouldExceed
                      return (
                        <button
                          key={m.id}
                          onClick={() => !isDisabled && toggle(m.id)}
                          disabled={isDisabled}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'border-primary/30 bg-primary/10'
                              : isDisabled
                                ? 'border-white/[0.04] opacity-40 cursor-not-allowed'
                                : 'border-white/[0.06] hover:border-primary/20 hover:bg-white/[0.02]'
                          }`}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: m.color + '18' }}
                          >
                            <span className="material-symbols-outlined text-base" style={{ color: m.color }}>
                              {m.icon}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-on-surface">{m.label}</p>
                            <p className="text-[11px] text-on-surface-variant/60 truncate">{m.description}</p>
                          </div>
                          <span className={`material-symbols-outlined text-base flex-shrink-0 transition-colors ${isSelected ? 'text-primary' : 'text-on-surface-variant/20'}`}>
                            {isSelected ? 'check_circle' : 'add_circle'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-5 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-3">
              <span className="text-xs text-on-surface-variant">
                {selected.length > 0 ? `Выбрано: ${selected.length}` : 'Выберите метрики'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-sm text-on-surface-variant hover:bg-white/[0.06] transition-all"
                >
                  Отмена
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={selected.length === 0}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-primary/20 hover:bg-primary/30 text-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Добавить {selected.length > 0 ? `(${selected.length})` : ''}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
