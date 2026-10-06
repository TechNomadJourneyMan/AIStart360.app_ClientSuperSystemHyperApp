'use client'

/**
 * NamespaceMetricsTab — the KPI and Goals tabs of /metrics.
 *
 * Values come from GET /api/v1/metrics/catalog (namespace=kpi | goal), i.e.
 * the company's materialised public.metrics rows — the single source the
 * catalog, the dashboard heroes, Точка А and Точка Б read
 * (lib/metrics/company-metrics.ts). Nothing is computed from the
 * questionnaire here any more: the old tabs re-derived «KPI» from survey keys
 * the wizard no longer writes and disagreed with the catalog.
 *
 * A metric without a value says what would fill it (the questionnaire step,
 * the document or the calculation), never a made-up number.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  formatItemValue,
  normalizeCatalogItem,
  sourceLabel,
  GROWTH_GOAL_LABELS,
  type CatalogApiData,
  type CatalogItem,
} from '@/components/metrics/catalog-model'
import { metricSourceHint } from '@/components/metrics/source-hint'

interface Envelope {
  ok?: boolean
  data?: CatalogApiData
  error?: string
}

async function fetchNamespace(ns: 'kpi' | 'goal'): Promise<CatalogItem[]> {
  const p = new URLSearchParams({ namespace: ns, pageSize: '200', includeValues: 'true', sort: 'label_asc' })
  const res = await fetch(`/api/v1/metrics/catalog?${p.toString()}`, { cache: 'no-store', credentials: 'include' })
  const json = (await res.json().catch(() => null)) as Envelope | null
  if (!res.ok || !json?.ok || !json.data) throw new Error(json?.error ?? `Не удалось загрузить метрики (${res.status})`)
  return (Array.isArray(json.data.items) ? json.data.items : []).map(normalizeCatalogItem)
}

function MetricCard({ item }: { item: CatalogItem }) {
  const hasValue = item.value !== null && item.value !== ''
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 hover:border-primary/20 transition-colors">
      <p className="text-xs font-mono text-on-surface-variant mb-2 uppercase tracking-wider">{item.label}</p>
      {hasValue ? (
        <>
          <p className="text-lg font-mono font-bold text-on-surface break-words">{formatItemValue(item)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-on-surface-variant/70">
            <span>Источник: {sourceLabel(item.source)}</span>
            {item.confidence !== null && <span>уверенность {Math.round(item.confidence * 100)}%</span>}
            {item.target?.value !== undefined && item.target?.value !== null && (
              <span className="text-primary/80">цель: {formatItemValue(item, item.target.value)}</span>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-mono text-on-surface-variant/60">Нет данных</p>
          <p className="mt-2 text-[10px] leading-relaxed text-on-surface-variant/70">{metricSourceHint(item.sources)}</p>
        </>
      )}
      {item.formula && <p className="mt-2 text-[10px] text-on-surface-variant/50">Формула: {item.formula}</p>}
    </div>
  )
}

export default function NamespaceMetricsTab({ namespace }: { namespace: 'kpi' | 'goal' }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['metrics-catalog', 'namespace', namespace],
    queryFn: () => fetchNamespace(namespace),
    staleTime: 30_000,
  })

  const groups = useMemo(() => {
    const items = data ?? []
    if (namespace === 'kpi') return [{ key: 'kpi', title: null as string | null, items }]
    const byGoal = new Map<string, CatalogItem[]>()
    for (const it of items) {
      const g = it.goalNumber ?? '—'
      byGoal.set(g, [...(byGoal.get(g) ?? []), it])
    }
    return Array.from(byGoal.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([g, list]) => ({ key: g, title: GROWTH_GOAL_LABELS[Number(g)] ?? `Цель ${g}`, items: list }))
  }, [data, namespace])

  if (isLoading) {
    return <p className="text-sm text-on-surface-variant">Загружаем метрики…</p>
  }
  if (isError) {
    return (
      <p className="text-sm text-error" role="alert">
        {error instanceof Error ? error.message : 'Не удалось загрузить метрики'}
      </p>
    )
  }
  const withValue = (data ?? []).filter((i) => i.value !== null && i.value !== '').length
  return (
    <div className="space-y-6">
      <p className="text-xs text-on-surface-variant">
        С данными: {withValue} из {(data ?? []).length} · значения те же, что в каталоге, на дашборде, в Точке А и Точке Б
      </p>
      {groups.map((g) => (
        <section key={g.key} className="space-y-3">
          {g.title && <h3 className="font-headline text-base font-bold text-on-surface">{g.title}</h3>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {g.items.map((it) => (
              <MetricCard key={it.id} item={it} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
