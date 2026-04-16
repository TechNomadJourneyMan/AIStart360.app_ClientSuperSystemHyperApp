'use client'

// Pulse tab: client-specific pulse metrics as commentable cards.

import { useEffect, useState } from 'react'
import { Commentable } from '@/components/expert/Commentable'

interface PulseMetrics {
  avgCheck: number | null
  volumeChange: number | null
  riskScore: number | null
  churnProb: number | null
  daysSince: number | null
  lastOrderAt: string | null
  orderCycle: number | null
  action: string | null
}

interface Props {
  clientId: string
}

type NumericKey = 'avgCheck' | 'volumeChange' | 'riskScore' | 'churnProb' | 'daysSince'

const METRICS: Array<{
  targetId: string
  label: string
  key: NumericKey
  icon: string
  suffix?: string
  format?: (v: number) => string
}> = [
  { targetId: 'pulse:avgCheck',     label: 'Средний чек',              key: 'avgCheck',     icon: 'payments',      suffix: '₸' },
  { targetId: 'pulse:volumeChange', label: 'Изменение объёма',         key: 'volumeChange', icon: 'trending_up',   suffix: '%' },
  { targetId: 'pulse:riskScore',    label: 'Risk Score',               key: 'riskScore',    icon: 'warning',       format: (v) => `${Math.round(v)}` },
  { targetId: 'pulse:churnProb',    label: 'Churn Probability',        key: 'churnProb',    icon: 'person_off',    suffix: '%' },
  { targetId: 'pulse:daysSince',    label: 'Дней с последнего заказа', key: 'daysSince',    icon: 'calendar_today' },
]

function formatMetric(
  value: number | null,
  format?: (v: number) => string,
  suffix?: string,
): string {
  if (value === null || value === undefined) return '—'
  const base = format ? format(value) : value.toFixed(1)
  return suffix ? `${base} ${suffix}` : base
}

export function PulseTab({ clientId }: Props) {
  const [metrics, setMetrics] = useState<PulseMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/expert/clients/${clientId}/pulse`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: PulseMetrics }
        if (!cancelled) setMetrics(json.data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-surface-container animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-error">Не удалось загрузить Pulse: {error}</p>
  }

  const hasData = metrics && Object.values(metrics).some((v) => v !== null)

  return (
    <div className="space-y-6">
      {!hasData && (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/50">
            query_stats
          </span>
          <div>
            <p className="text-sm font-medium text-on-surface">Нет данных Pulse</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Метрики появятся после расчёта первой диагностики. Вы всё равно можете оставлять комментарии.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {METRICS.map((m) => (
          <Commentable key={m.targetId} targetId={m.targetId}>
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4">
              <div className="flex items-start justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
                  {m.label}
                </span>
                <span className="material-symbols-outlined text-base text-primary/60">
                  {m.icon}
                </span>
              </div>
              <p className="text-xl font-mono font-bold text-on-surface">
                {formatMetric(metrics?.[m.key] ?? null, m.format, m.suffix)}
              </p>
            </div>
          </Commentable>
        ))}
      </div>

      {/* Recommended action */}
      <Commentable targetId="pulse:action">
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-primary/70 text-lg">assistant</span>
            <h3 className="font-headline text-sm font-bold text-on-surface">
              Рекомендованное действие
            </h3>
          </div>
          <p className="text-sm text-on-surface">
            {metrics?.action ?? (
              <span className="text-on-surface-variant italic">
                Система ещё не предложила действие
              </span>
            )}
          </p>
        </div>
      </Commentable>
    </div>
  )
}
