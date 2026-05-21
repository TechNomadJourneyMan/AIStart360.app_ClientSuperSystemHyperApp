'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import MetricSearchBox from './MetricSearchBox'
import DepartmentChips from './DepartmentChips'
import MetricSortToggle from './MetricSortToggle'
import NamespaceTabs from './NamespaceTabs'
import { SORT_OPTIONS, NAMESPACE_TABS, type SortMode, type Namespace } from './_utils'
import MetricHealthCard from '@/components/dashboard/MetricHealthCard'
import MetricDrillDownModalV2 from '@/components/dashboard/MetricDrillDownModalV2'
import { useRealtimeMetrics } from '@/hooks/useRealtimeMetrics'
import { getBizDescription, getKpiDescription, getGriDescription } from '@/lib/metrics/descriptions'

interface CatalogItem {
  id: string
  label: string
  namespace: 'biz' | 'kpi' | 'gri' | 'goal'
  department: string | null
  goalNumber: string | null
  unit: string
  formula: string | null
  sources: Array<{ type: string; key?: string; field?: string; doc_type?: string; system?: string }>
  value: number | string | null
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
}

interface CatalogResponse {
  ok: boolean
  data?: { total: number; page: number; pageSize: number; items: CatalogItem[] }
  error?: string
}

async function fetchCatalog(params: URLSearchParams): Promise<CatalogResponse['data'] & { ok: true }> {
  const res = await fetch(`/api/v1/metrics/catalog?${params.toString()}`, { cache: 'no-store' })
  const json = (await res.json()) as CatalogResponse
  if (!json.ok || !json.data) throw new Error(json.error ?? 'Ошибка каталога')
  return { ok: true as const, ...json.data }
}

interface Props {
  userId?: string | null
}

export default function MetricsLiveCatalog({ userId }: Props) {
  const qc = useQueryClient()
  const [namespace, setNamespace] = useState<Namespace>('all')
  const [department, setDepartment] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('label_asc')
  const [page, setPage] = useState(1)
  const pageSize = 30

  const [drillId, setDrillId] = useState<string | null>(null)
  const [drillItem, setDrillItem] = useState<CatalogItem | null>(null)

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [namespace, department, search, sort])

  const params = useMemo(() => {
    const p = new URLSearchParams()
    p.set('namespace', namespace)
    if (department) p.set('department', department)
    if (search) p.set('search', search)
    p.set('sort', sort)
    p.set('page', String(page))
    p.set('pageSize', String(pageSize))
    p.set('includeValues', 'true')
    return p
  }, [namespace, department, search, sort, page])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['metrics-catalog', namespace, department, search, sort, page] as const,
    queryFn: () => fetchCatalog(params),
    staleTime: 30_000,
    retry: 1,
  })

  // Wire realtime invalidation when user has a userId
  useRealtimeMetrics(userId ?? null)

  // ── Auto-materialize when every catalog item is null ──────────────────────
  // Single-shot per mount: if the response has items but every `value` is
  // null, kick the resolver via POST /api/v1/metrics/materialize, then
  // re-fetch the catalog. Subsequent renders never retry.
  const materializeAttempted = useRef(false)
  const [materializeStatus, setMaterializeStatus] = useState<
    'idle' | 'running' | 'error'
  >('idle')

  async function runMaterialize(force = false) {
    if (!force && materializeAttempted.current) return
    materializeAttempted.current = true
    setMaterializeStatus('running')
    try {
      const res = await fetch('/api/v1/metrics/materialize', {
        method: 'POST',
        cache: 'no-store',
      })
      const json = (await res.json()) as
        | { ok: true; data: { written: number; total: number; skipped: number } }
        | { ok: false; error: string }
      if (!json.ok) {
        // `no_company` is an expected empty state, not a hard failure.
        if ('error' in json && json.error === 'no_company') {
          setMaterializeStatus('idle')
          return
        }
        throw new Error('error' in json ? json.error : 'materialize failed')
      }
      await qc.invalidateQueries({ queryKey: ['metrics-catalog'] })
      await refetch()
      setMaterializeStatus('idle')
    } catch (err) {
      console.error('[metrics] materialize failed', err)
      setMaterializeStatus('error')
    }
  }

  useEffect(() => {
    if (materializeAttempted.current) return
    if (isLoading || isError) return
    const list = data?.items ?? []
    if (list.length === 0) return
    const allNull = list.every((it) => it.value === null)
    if (allNull) {
      void runMaterialize()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isLoading, isError])

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Derive department list from current page (will be replaced by full-catalog count when backend exposes it)
  const departments = useMemo(() => {
    const items = data?.items ?? []
    const set = new Map<string, number>()
    for (const it of items) {
      if (it.department) set.set(it.department, (set.get(it.department) ?? 0) + 1)
    }
    return Array.from(set.entries()).map(([name, count]) => ({ name, count }))
  }, [data])

  const items = data?.items ?? []

  function openDrill(item: CatalogItem) {
    setDrillId(item.id)
    setDrillItem(item)
  }

  // Pull description for drill modal
  const drillDescription = useMemo(() => {
    if (!drillItem) return undefined
    if (drillItem.namespace === 'biz' && drillItem.department) {
      const d = getBizDescription(drillItem.department, drillItem.label)
      if (d) return { what: d.what, why: d.why, how: d.how, current_state: d.current_state }
    }
    if (drillItem.namespace === 'kpi') {
      const d = getKpiDescription(drillItem.label)
      if (d) return { what: d.what, why: d.why, how: d.how, current_state: d.current_state }
    }
    if (drillItem.namespace === 'gri') {
      const d = getGriDescription(drillItem.label)
      if (d) return { what: d.what, why: d.why, how: d.how, current_state: d.current_state }
    }
    return undefined
  }, [drillItem])

  // Build provenance for drill modal from the resolver's source array
  const drillProvenance = useMemo(() => {
    if (!drillItem) return undefined
    const considered = drillItem.sources.map((s) => ({
      type: s.type,
      label:
        s.type === 'survey'
          ? `Анкета: ${s.key ?? ''}`
          : s.type === 'document'
          ? `Документ (${s.doc_type ?? '—'}) поле ${s.field ?? '—'}`
          : s.type === 'prisma'
          ? `БД`
          : s.type === 'external'
          ? `Внешний: ${s.system ?? '—'}`
          : s.type,
      status: (drillItem.source === s.type ? 'hit' : 'miss') as 'hit' | 'miss' | 'error',
      confidence: drillItem.source === s.type ? drillItem.confidence ?? undefined : undefined,
    }))
    const picked = considered.find((c) => c.status === 'hit')
    return {
      picked: picked ? { type: picked.type, label: picked.label } : null,
      considered,
      computedAt: drillItem.computedAt ?? undefined,
    }
  }, [drillItem])

  const counts: Record<Namespace, number> = useMemo(() => {
    // We only have current-page counts; show 0 for non-active namespaces until backend exposes total per ns
    const base: Record<Namespace, number> = { all: 0, biz: 0, kpi: 0, gri: 0, goal: 0 }
    base[namespace] = total
    return base
  }, [namespace, total])

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-outline-variant/10 pb-4">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
            Каталог метрик · Real-time
          </p>
          <h2 className="font-headline text-xl font-bold text-on-surface">
            Точка А: 122 показателя
          </h2>
          <p className="text-xs text-on-surface-variant mt-1 font-mono">
            Найдено: <span className="text-primary">{total}</span> · страница {page}/{totalPages}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {materializeStatus === 'running' && (
            <span className="inline-flex items-center gap-1.5 text-on-surface-variant font-mono text-[10px] px-2.5 py-1 rounded-full bg-surface-container border border-white/[0.04]">
              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
              Считаем метрики…
            </span>
          )}
          {materializeStatus === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-error font-mono text-[10px] px-2.5 py-1 rounded-full bg-error/5 border border-error/20">
              <span className="material-symbols-outlined text-[12px]">error</span>
              Не удалось рассчитать метрики
            </span>
          )}
          <MetricSortToggle value={sort} onChange={setSort} />
          <button
            onClick={() => {
              void runMaterialize(true)
            }}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-on-surface-variant border border-white/[0.04] hover:border-primary/40 hover:text-primary rounded-xl px-3 py-2 transition-colors"
            title="Пересчитать"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            Пересчитать
          </button>
        </div>
      </div>

      {/* Controls row 1 — namespace tabs */}
      <NamespaceTabs value={namespace} counts={counts} onChange={setNamespace} />

      {/* Controls row 2 — search + department chips */}
      <div className="space-y-3">
        <MetricSearchBox
          value={search}
          onChange={setSearch}
          resultsCount={total}
        />
        {namespace === 'biz' && departments.length > 0 && (
          <DepartmentChips
            departments={departments}
            selected={department}
            onSelect={setDepartment}
          />
        )}
      </div>

      {/* Status row */}
      {isError && (
        <div className="bg-error/[0.04] border border-error/30 rounded-xl p-4 text-sm text-on-surface">
          {error instanceof Error ? error.message : 'Ошибка загрузки каталога'}
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-container rounded-2xl border border-white/[0.04] p-5 h-36 animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface-container-low border border-dashed border-white/[0.06] rounded-2xl p-12 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-3 block">
            search_off
          </span>
          <p className="text-sm text-on-surface-variant">Метрик по фильтрам не найдено</p>
          <button
            onClick={() => {
              setSearch('')
              setDepartment(null)
              setNamespace('all')
            }}
            className="mt-3 text-xs font-mono text-primary hover:text-primary/80"
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((it) => (
            <MetricHealthCard
              key={it.id}
              metricId={it.id}
              label={it.label}
              value={it.value}
              unit={it.unit}
              confidence={it.confidence ?? undefined}
              source={(it.source as 'survey' | 'document' | 'prisma' | 'external' | 'manual' | null) ?? null}
              icon={
                it.namespace === 'biz'
                  ? 'analytics'
                  : it.namespace === 'kpi'
                  ? 'leaderboard'
                  : it.namespace === 'gri'
                  ? 'radar'
                  : 'flag'
              }
              onClick={() => openDrill(it)}
              highlight={
                it.value !== null && it.confidence !== null && it.confidence >= 0.8
                  ? 'strength'
                  : it.value === null
                  ? 'gap'
                  : null
              }
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs font-mono px-3 py-1.5 rounded-xl border border-white/[0.04] hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:hover:border-white/[0.04] disabled:hover:text-on-surface-variant"
          >
            ‹ Назад
          </button>
          <span className="text-xs font-mono text-on-surface-variant">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="text-xs font-mono px-3 py-1.5 rounded-xl border border-white/[0.04] hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:hover:border-white/[0.04] disabled:hover:text-on-surface-variant"
          >
            Вперёд ›
          </button>
        </div>
      )}

      {/* Drill-down modal */}
      {drillId && drillItem && (
        <MetricDrillDownModalV2
          open={drillId !== null}
          onClose={() => {
            setDrillId(null)
            setDrillItem(null)
          }}
          metricId={drillId}
          metricLabel={drillItem.label}
          unit={drillItem.unit}
          description={drillDescription}
          provenance={drillProvenance}
          liveValue={
            drillItem.value !== null
              ? { value: drillItem.value }
              : undefined
          }
        />
      )}
    </section>
  )
}
