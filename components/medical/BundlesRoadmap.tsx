'use client'

/**
 * BundlesRoadmap — 9 growth bundles ranked by expected revenue uplift.
 *
 * Each card shows bundle label, revenue potential, target patient count,
 * conversion %, complexity, effect timeline. Click expands the trigger +
 * script preview.
 */

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

interface BundleRow {
  id: string
  bundle_key: string
  target_segments: string[]
  target_patient_count: number
  estimated_conversion: number
  estimated_revenue_kzt: number
  priority: number
  complexity: 'easy' | 'medium' | 'hard'
  effect_timeline: string | null
  trigger_description: string | null
  script_preview: string | null
}

const COMPLEXITY_COLOR: Record<string, string> = {
  easy:   'bg-primary/10 text-primary border-primary/20',
  medium: 'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20',
  hard:   'bg-error/10 text-error border-error/20',
}

export function BundlesRoadmap() {
  const [bundles, setBundles] = useState<BundleRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await fetch('/api/v1/medical/bundles', { cache: 'no-store' })
      const json = await res.json()
      if (!active) return
      if (json?.data) setBundles(json.data)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant p-6 text-sm text-on-surface-variant font-mono">
        Загрузка связок роста...
      </div>
    )
  }
  if (!bundles || bundles.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant p-6">
        <p className="text-sm text-on-surface-variant">
          9 связок роста ещё не рассчитаны. Загрузите базу пациентов.
        </p>
      </div>
    )
  }

  const totalUplift = bundles.reduce((s, b) => s + b.estimated_revenue_kzt, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-on-surface">9 связок роста</h3>
        <span className="text-[11px] font-mono text-primary">
          + {(totalUplift / 1_000_000).toFixed(1)} M ₸/мес потенциал
        </span>
      </div>
      <div className="space-y-2">
        {bundles.map((b) => {
          const isOpen = expanded === b.id
          return (
            <div
              key={b.id}
              className="rounded-xl border border-outline-variant bg-surface-container overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : b.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-surface-container-high text-left"
              >
                <span className="flex-none w-7 h-7 rounded-full bg-primary/10 text-primary font-mono font-semibold text-xs flex items-center justify-center">
                  {b.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">
                    {humanizeBundleKey(b.bundle_key)}
                  </p>
                  <p className="text-[11px] text-on-surface-variant font-mono">
                    {b.target_patient_count.toLocaleString('ru-RU')} пациентов ·{' '}
                    {b.estimated_conversion}% конверсия · {b.effect_timeline ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-none">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider',
                      COMPLEXITY_COLOR[b.complexity] ?? 'bg-surface border-outline-variant'
                    )}
                  >
                    {b.complexity}
                  </span>
                  <span className="font-mono font-semibold text-primary text-sm tabular-nums">
                    +{(b.estimated_revenue_kzt / 1000).toFixed(0)}к ₸
                  </span>
                  <ChevronDown
                    size={16}
                    className={cn('text-on-surface-variant transition-transform', isOpen && 'rotate-180')}
                  />
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-outline-variant px-3 py-3 space-y-2 text-xs text-on-surface-variant">
                  {b.trigger_description && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider opacity-70 mb-1">Триггер</p>
                      <p>{b.trigger_description}</p>
                    </div>
                  )}
                  {b.script_preview && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider opacity-70 mb-1">Скрипт</p>
                      <blockquote className="border-l-2 border-outline-variant pl-2 italic">
                        {b.script_preview}
                      </blockquote>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {b.target_segments.map((s) => (
                      <span
                        key={s}
                        className="px-2 py-0.5 rounded-full bg-surface-container-high text-[10px] font-mono"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function humanizeBundleKey(k: string): string {
  const LABELS: Record<string, string> = {
    no_show:               'Подтверждение записи (no-show защита)',
    cross_sell_after_ekg:  'Cross-sell после диагностики',
    follow_up_diagnostics: 'Follow-up после диагностики',
    reactivation:          'Реактивация спящих',
    nps_referral:          'NPS + реферальная программа',
    instant_callback:      'Мгновенный обратный звонок',
    upsell_at_booking:     'Upsell при подтверждении',
    seasonal_campaigns:    'Сезонные кампании',
    chronic_control:       'Контроль хроников',
  }
  return LABELS[k] ?? k.replace(/_/g, ' ')
}
