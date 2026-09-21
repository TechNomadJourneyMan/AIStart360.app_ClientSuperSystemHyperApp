'use client'

import { useMemo } from 'react'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge, BarList, Panel, Skeleton, cx, fmtDate, useGigaQuery } from '../kit'
import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import type { SectionId } from '@/lib/gri-assessment/sections'

/**
 * Динамика GRI и сравнение с отраслью.
 *
 * Десять прохождений с одинаковым индексом выглядят как работа, но означают
 * застой — увидеть это по списку дат невозможно. Здесь: изменение к прошлому
 * разу, линия по всем прохождениям и разрыв со средним по отрасли в разрезе
 * блоков, чтобы было о чём говорить с клиентом.
 */

interface Assessment { id: string; gri_index: number; created_at: string; is_current: boolean; section_avgs: Record<string, number> | null }
interface Benchmark {
  overall: { label: string; sample: number; avg: number; blocks: Array<{ id: string; avg: number | null }> } | null
  industries: Array<{ key: string; label: string; sample: number; avg: number; blocks: Array<{ id: string; avg: number | null }> }>
  minSample: number
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points
    .map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - min) / span) * 24}`)
    .join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" role="img" aria-label="Изменение индекса GRI по прохождениям">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-400" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function GriDynamicsPanel({ userId, industry }: { userId: string; industry: string | null }) {
  const gri = useGigaQuery<{ data: { assessments: Assessment[] } }>(`/api/giga-admin/users/${userId}/gri`)
  const bench = useGigaQuery<{ data: Benchmark }>('/api/giga-admin/gri/benchmark')

  const history = useMemo(
    () => [...(gri.data?.data.assessments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [gri.data],
  )

  if (gri.loading && !gri.data) return <Skeleton className="mb-4 h-32" />
  if (history.length === 0) return null

  const current = history[history.length - 1]
  const previous = history.length > 1 ? history[history.length - 2] : null
  const delta = previous ? Number((current.gri_index - previous.gri_index).toFixed(2)) : null
  const first = history[0]
  const total = Number((current.gri_index - first.gri_index).toFixed(2))

  const norm = (industry ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const b = bench.data?.data
  const peer = b?.industries.find((i) => i.key === norm) ?? null
  const reference = peer ?? b?.overall ?? null
  const gap = reference ? Number((current.gri_index - reference.avg).toFixed(2)) : null

  const Trend = delta === null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown
  const trendCls = delta === null || delta === 0 ? 'text-slate-400' : delta > 0 ? 'text-emerald-400' : 'text-red-400'

  const blockGaps = reference
    ? (reference.blocks
        .map((rb) => {
          const mine = current.section_avgs?.[rb.id]
          if (typeof mine !== 'number' || rb.avg === null) return null
          return { id: rb.id, label: GRI_BLOCK_RU[rb.id as SectionId] ?? rb.id, gap: Number((mine - rb.avg).toFixed(2)) }
        })
        .filter((x): x is { id: string; label: string; gap: number } => !!x)
        .sort((x, y) => x.gap - y.gap))
    : []

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      <Panel title="Динамика" description={`Прохождений: ${history.length}. Первое — ${fmtDate(first.created_at)}.`}>
        <div className="flex items-end gap-4">
          <div>
            <p className="font-mono text-3xl font-bold text-slate-100">{current.gri_index.toFixed(1)}</p>
            <p className="mt-1 flex items-center gap-1 text-xs">
              <Trend size={13} className={trendCls} />
              <span className={trendCls}>
                {delta === null ? 'первое прохождение' : delta === 0 ? 'без изменений' : `${delta > 0 ? '+' : ''}${delta} к прошлому`}
              </span>
            </p>
          </div>
          <div className="min-w-0 flex-1"><Spark points={history.map((h) => h.gri_index)} /></div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {history.length > 1
            ? total === 0
              ? `За ${history.length} прохождений индекс не сдвинулся — данные обновляются, а работа по итогам не идёт.`
              : `С первого прохождения: ${total > 0 ? '+' : ''}${total}.`
            : 'Для динамики нужно хотя бы два прохождения.'}
        </p>
      </Panel>

      <Panel
        title="Сравнение"
        description={reference
          ? `${reference.label} · выборка ${reference.sample}`
          : 'Не с чем сравнивать: результатов пока мало.'}
      >
        {bench.loading && !bench.data ? <Skeleton className="h-24" /> : reference && (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-2xl font-bold text-slate-100">{reference.avg.toFixed(2)}</span>
              <Badge tone={gap === null ? 'neutral' : gap >= 0 ? 'green' : 'amber'}>
                {gap === null ? '—' : gap >= 0 ? `клиент выше на ${gap.toFixed(2)}` : `клиент ниже на ${Math.abs(gap).toFixed(2)}`}
              </Badge>
            </div>
            {!peer && (
              <p className="mt-1 text-[11px] text-slate-500">
                По отрасли клиента данных мало (нужно от {b?.minSample ?? 3} результатов) — сравниваем со всей платформой.
              </p>
            )}
            {blockGaps.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Разрыв по блокам, худшие сверху</p>
                <BarList
                  items={blockGaps.slice(0, 5).map((g) => ({ key: g.id, label: g.label, value: g.gap }))}
                  format={(n) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2))}
                />
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
