'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { ErrorState, Panel, Skeleton, Tabs, useGigaQuery } from '@/components/giga-panel/kit'
import type { ActivityPoint, CohortRow } from '@/lib/analytics/reports'
import { ActivitySeriesChart } from './ActivitySeriesChart'
import { RetentionCohortTable } from './RetentionCohortTable'

const PERIODS = [{ key: '30', label: '30 дней' }, { key: '90', label: '90 дней' }] as const

function ExportLink({ report, days, label }: { report: 'activity' | 'cohorts' | 'funnel'; days?: string; label: string }) {
  return (
    <a
      href={`/api/giga-admin/analytics/export?report=${report}${days ? `&days=${days}` : ''}`}
      className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
      download
    >
      <Download size={12} /> {label}
    </a>
  )
}

/** «Активность» (DAU/WAU/MAU) + «Удержание» (когорты) — пакет 5, F-066. */
export function ProductAnalyticsPanels() {
  const [period, setPeriod] = useState<'30' | '90'>('30')
  const series = useGigaQuery<{ series: ActivityPoint[] | null; unavailable: string[] }>(`/api/giga-admin/analytics?parts=series&days=${period}`)
  const cohorts = useGigaQuery<{ cohorts: CohortRow[] | null; unavailable: string[] }>('/api/giga-admin/analytics?parts=cohorts&weeks=8')

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Активность"
        description="Уникальные активные клиенты: за день (DAU), 7 дней (WAU), 30 дней (MAU). Без персонала и действий «от имени»."
        actions={
          <>
            <Tabs tabs={PERIODS} value={period} onChange={setPeriod} />
            <ExportLink report="activity" days={period} label="CSV" />
          </>
        }
      >
        <ErrorState error={series.error} onRetry={series.reload} />
        {series.error ? null : !series.data ? <Skeleton className="h-44" /> : series.data.series
          ? <ActivitySeriesChart points={series.data.series} />
          : <p className="py-8 text-center text-xs text-slate-600">Отчёт недоступен: примените миграцию 090.</p>}
      </Panel>
      <Panel
        title="Удержание"
        description="Недельные когорты регистрации. D1/D7/D30 — доля вернувшихся в этот день или позже; W1–W8 — активны на этой неделе."
        actions={<ExportLink report="cohorts" label="CSV" />}
      >
        <ErrorState error={cohorts.error} onRetry={cohorts.reload} />
        {cohorts.error ? null : !cohorts.data ? <Skeleton className="h-44" /> : cohorts.data.cohorts
          ? <RetentionCohortTable cohorts={cohorts.data.cohorts} />
          : <p className="py-8 text-center text-xs text-slate-600">Отчёт недоступен: примените миграцию 090.</p>}
      </Panel>
    </div>
  )
}
