'use client'

import { useState } from 'react'
import { Cpu } from 'lucide-react'
import { BarList, ErrorState, Panel, Select, Skeleton, useGigaQuery } from '@/components/giga-panel/kit'
import type { AiUsageFeature } from '@/lib/ai/usage-summary'

/**
 * AiCostTile — AI spend by feature for the last 7 / 30 days (F-070).
 * Self-contained: fetches GET /api/giga-admin/ai/usage (permission
 * analytics.view). Mount it only for staff who have that permission, e.g.
 *   {can('analytics.view') && <AiCostTile />}
 */

interface UsageResponse {
  data: {
    days: number
    total_cost_usd: number
    total_calls: number
    cache_hits: number
    features: AiUsageFeature[]
  }
}

const PERIODS = [
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
] as const

const fmtUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: n > 0 && n < 1 ? 3 : 2, maximumFractionDigits: n > 0 && n < 1 ? 3 : 2 })}`

export function AiCostTile({ className }: { className?: string }) {
  const [days, setDays] = useState<'7' | '30'>('7')
  const { data, error, loading, reload } = useGigaQuery<UsageResponse>(`/api/giga-admin/ai/usage?days=${days}`)
  const u = data?.data

  return (
    <Panel
      className={className}
      title={<span className="flex items-center gap-1.5"><Cpu size={14} /> Расходы на ИИ</span>}
      description={u ? `${u.total_calls.toLocaleString('ru-RU')} вызовов · из кэша ${u.cache_hits.toLocaleString('ru-RU')}` : 'по функциям платформы'}
      actions={<Select label="Период расходов ИИ" value={days} onChange={setDays} options={PERIODS} />}
    >
      <ErrorState error={error} onRetry={reload} />
      {loading && !u ? (
        <Skeleton className="h-32" />
      ) : u ? (
        <>
          <p className="mb-3 text-2xl font-bold tabular-nums text-slate-100">{fmtUsd(u.total_cost_usd)}</p>
          <BarList
            emptyText="Вызовов ИИ за период не было"
            format={fmtUsd}
            items={u.features
              .filter((f) => f.calls > 0 || f.cache_hits > 0)
              .slice(0, 8)
              .map((f) => ({
                key: f.feature,
                label: f.label,
                value: f.cost_usd,
                hint: f.failed_calls > 0 ? `· ошибок ${f.failed_calls}` : f.cache_hits > 0 ? `· кэш ${f.cache_hits}` : undefined,
              }))}
          />
        </>
      ) : null}
    </Panel>
  )
}

export default AiCostTile
