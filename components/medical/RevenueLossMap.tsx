'use client'

/**
 * RevenueLossMap — 9 revenue leak points with severity, linked bundle,
 * and source-data transparency.
 */

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

interface LossRow {
  id: string
  loss_key: string
  estimated_loss_kzt: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  source_data: string | null
  linked_bundle_key: string | null
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-error/40 bg-error/5',
  high:     'border-error/30 bg-error/5',
  medium:   'border-tertiary-container/30 bg-tertiary-container/5',
  low:      'border-outline-variant bg-surface-container',
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'критично',
  high:     'высокий',
  medium:   'средний',
  low:      'низкий',
}

const LOSS_LABELS: Record<string, string> = {
  no_shows:                'No-show (неявки)',
  missed_calls:            'Потерянные входящие звонки',
  missing_follow_up:       'Нет follow-up после диагностики',
  missing_upsell:          'Нет upsell при подтверждении',
  missing_reactivation:    'Не реактивируется спящая база',
  missing_chronic_control: 'Провал с контролем хроников',
  weak_nps:                'Слабый NPS / рефералы',
  missing_seasonal:        'Нет сезонных кампаний',
  post_diagnostic_drop:    'Пост-диагностический провал',
}

export function RevenueLossMap() {
  const [losses, setLosses] = useState<LossRow[] | null>(null)
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await fetch('/api/v1/medical/losses', { cache: 'no-store' })
      const json = await res.json()
      if (!active) return
      if (json?.data) setLosses(json.data)
      if (typeof json?.total_loss_kzt === 'number') setTotal(json.total_loss_kzt)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant p-6 text-sm text-on-surface-variant font-mono">
        Загрузка карты потерь...
      </div>
    )
  }
  if (!losses || losses.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant p-6">
        <p className="text-sm text-on-surface-variant">
          Аудит потерь выручки ещё не рассчитан. Загрузите базу пациентов.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-on-surface">Карта потерь выручки</h3>
        <span className="text-[11px] font-mono text-error">
          − {(total / 1_000_000).toFixed(1)} M ₸/мес
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {losses.map((l) => (
          <div
            key={l.id}
            className={cn(
              'rounded-xl border p-3 space-y-2',
              SEVERITY_STYLE[l.severity] ?? 'border-outline-variant bg-surface-container'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-on-surface leading-tight">
                {LOSS_LABELS[l.loss_key] ?? l.loss_key}
              </p>
              <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider bg-surface border border-outline-variant">
                {SEVERITY_LABEL[l.severity]}
              </span>
            </div>
            <p className="font-mono font-bold text-error tabular-nums">
              −{(l.estimated_loss_kzt / 1000).toFixed(0)}к ₸
            </p>
            {l.source_data && (
              <p className="text-[10px] font-mono text-on-surface-variant opacity-75 leading-relaxed">
                {l.source_data}
              </p>
            )}
            {l.linked_bundle_key && (
              <p className="text-[10px] font-mono text-primary pt-1 border-t border-current/10">
                → связка: {l.linked_bundle_key.replace(/_/g, ' ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
