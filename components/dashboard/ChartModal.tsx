'use client'

/**
 * ChartModal — legacy wrapper kept for WidgetGrid compatibility.
 * New metric detail modal is MetricModal (opened via metricsStore).
 */

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KpiChart } from './KpiChart'

const METRIC_LABELS: Record<string, string> = {
  revenue:   'Доход (₸М)',
  margin:    'Маржа (%)',
  clients:   'Клиенты',
  avg_check: 'Средний чек',
}

interface ChartModalProps {
  metric: string | null
  onClose: () => void
}

export function ChartModal({ metric, onClose }: ChartModalProps) {
  useEffect(() => {
    if (!metric) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [metric, onClose])

  return (
    <AnimatePresence>
      {metric && (
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
            className="relative z-10 w-full sm:max-w-3xl bg-surface-container-low rounded-t-2xl sm:rounded-2xl border border-white/[0.08] shadow-2xl p-5"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-0.5">Динамика</p>
                <h3 className="text-base font-bold text-on-surface">{METRIC_LABELS[metric] ?? metric}</h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Закрыть"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-white/[0.06] transition-all"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            <KpiChart initialMetric={metric} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
