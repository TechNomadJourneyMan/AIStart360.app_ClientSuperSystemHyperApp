'use client'

/** A real metric as Point A shows it: value, period · source, dynamics, norm, what it is. */
import { useState } from 'react'
import type { MetricView } from '@/lib/point-a/v4/metric-views'
import { CHIP, Icon, fmtValue } from './ui'
import { cn } from '@/lib/utils'

export function metricValue(m: Pick<MetricView, 'value' | 'unit' | 'flag'>): string {
  if (m.value === null) return '—'
  if (m.flag) return m.value ? 'Да' : 'Нет'
  return fmtValue(m.value, m.unit)
}

/** Whether a rise is good: lower-is-better metrics (CAC, cycle, churn) read the other way. */
function goodDirection(m: MetricView): 'up' | 'down' {
  if (m.norm) return m.norm.direction === 'lower_is_better' ? 'down' : 'up'
  // Lower is better: CAC (not LTV/CAC), cycle, churn, staff turnover, defects,
  // no-shows, missed calls, delivery / response time, receivables, costs, CPL.
  const tail = m.id.split('.').pop() ?? ''
  return /^cac$|^stoimost_privlecheniya_cac$|tsikl|churn|tekuchest|brak|neyavok|propuschennykh|vremya|debitor|raskhody|sebestoimost|cpl|time_to/i.test(tail) ? 'down' : 'up'
}

export function TrendChip({ m }: { m: MetricView }) {
  if (!m.trend || m.trend.direction === 'flat') return null
  const good = m.trend.direction === goodDirection(m)
  return (
    <span className={cn(CHIP, good ? 'bg-primary/10 text-primary' : 'bg-red-300/10 text-red-200')} title={`Было: ${fmtValue(m.trend.previous, m.unit)}`}>
      <Icon name={m.trend.direction === 'up' ? 'trending_up' : 'trending_down'} className="text-[12px]" />
      {m.trend.deltaPct === null ? '' : `${m.trend.deltaPct > 0 ? '+' : ''}${m.trend.deltaPct}%`}
    </span>
  )
}

export function MiniSpark({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const w = 80
  const h = 22
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-[22px] w-[80px]', className)} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#6effc0" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** One metric row of a section (expands into what / why / how). */
export function MetricRow({ m }: { m: MetricView }) {
  const [open, setOpen] = useState(false)
  const explained = m.what || m.why || m.how
  return (
    <li className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className={cn('text-left text-sm font-medium text-on-surface', explained && 'hover:text-primary')}
            onClick={() => explained && setOpen((v) => !v)}
            aria-expanded={explained ? open : undefined}
          >
            {m.label}
            {explained && <Icon name={open ? 'expand_less' : 'info'} className="ml-1 align-middle text-[14px] text-on-surface-variant" />}
          </button>
          <p className="text-[11px] text-on-surface-variant">
            {m.value !== null ? [m.period, m.source].filter(Boolean).join(' · ') : m.needs ?? 'Нет данных'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MiniSpark values={m.history} className="hidden sm:block" />
          <span className={cn('font-mono text-base font-semibold', m.value === null ? 'text-on-surface-variant' : 'text-on-surface')}>{metricValue(m)}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <TrendChip m={m} />
        {m.norm && (
          <span className={cn(CHIP, m.normOk === null ? 'bg-white/[0.04] text-on-surface-variant' : m.normOk ? 'bg-primary/10 text-primary' : 'bg-amber-300/10 text-amber-200')} title={m.norm.label}>
            норма {m.norm.direction === 'lower_is_better' ? '≤' : '≥'} {fmtValue(m.norm.value, m.unit)}
          </span>
        )}
        {m.confidence !== null && m.confidence < 0.7 && <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')}>достоверность {Math.round(m.confidence * 100)}%</span>}
      </div>
      {open && (
        <dl className="mt-2 space-y-1.5 border-t border-white/[0.05] pt-2 text-xs">
          {m.what && <div><dt className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Что это</dt><dd className="text-on-surface">{m.what}</dd></div>}
          {m.why && <div><dt className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Зачем следить</dt><dd className="text-on-surface">{m.why}</dd></div>}
          {m.how && <div><dt className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Как считается</dt><dd className="text-on-surface">{m.how}</dd></div>}
        </dl>
      )}
    </li>
  )
}
