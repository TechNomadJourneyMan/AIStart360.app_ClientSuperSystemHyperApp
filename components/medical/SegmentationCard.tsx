'use client'

/**
 * SegmentationCard — 8 RFM segments for a clinic, priority-ordered.
 *
 * Fetches from /api/v1/medical/segments on mount. Each tile shows segment
 * label, patient count, avg LTV, avg recency. Color-coded by priority.
 */

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

interface SegmentRow {
  segment: string
  label: string
  count: number
  total_ltv_kzt: number
  avg_ltv_kzt: number
  avg_recency_days: number
  priority: number
}

const PRIORITY_COLOR: Record<number, string> = {
  1: 'bg-primary/10 border-primary/30 text-primary',
  2: 'bg-primary/10 border-primary/30 text-primary',
  3: 'bg-tertiary-container/10 border-tertiary-container/30 text-tertiary-container',
  4: 'bg-error/10 border-error/30 text-error',
  5: 'bg-error/20 border-error/40 text-error',
  6: 'bg-surface-container border-outline-variant text-on-surface-variant',
  7: 'bg-secondary/10 border-secondary/30 text-secondary',
  8: 'bg-surface-container border-outline-variant text-on-surface-variant',
}

export function SegmentationCard() {
  const [segments, setSegments] = useState<SegmentRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await fetch('/api/v1/medical/segments', { cache: 'no-store' })
      const json = await res.json()
      if (!active) return
      if (json?.data) setSegments(json.data)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant p-6 text-sm text-on-surface-variant font-mono">
        Загрузка RFM-сегментов...
      </div>
    )
  }
  if (!segments || segments.every((s) => s.count === 0)) {
    return (
      <div className="rounded-xl border border-outline-variant p-6">
        <p className="text-sm text-on-surface-variant">
          RFM-сегментация ещё не запущена. Загрузите базу пациентов.
        </p>
      </div>
    )
  }

  const total = segments.reduce((s, x) => s + x.count, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-on-surface">RFM-сегментация</h3>
        <span className="text-[11px] font-mono text-on-surface-variant">
          {total.toLocaleString('ru-RU')} пациентов
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {segments.map((s) => (
          <div
            key={s.segment}
            className={cn(
              'rounded-xl border p-3 space-y-1.5',
              PRIORITY_COLOR[s.priority] ?? 'bg-surface-container border-outline-variant'
            )}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider opacity-80">
                S{s.priority}
              </span>
              <span className="text-xl font-mono font-bold tabular-nums">
                {s.count.toLocaleString('ru-RU')}
              </span>
            </div>
            <p className="text-xs font-medium leading-tight">{s.label}</p>
            {s.count > 0 && (
              <div className="pt-1.5 border-t border-current/10 text-[10px] font-mono opacity-75 space-y-0.5">
                <div>≈ {(s.avg_ltv_kzt / 1000).toFixed(0)}к ₸ / пациент</div>
                <div>{s.avg_recency_days} дн. с визита</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
