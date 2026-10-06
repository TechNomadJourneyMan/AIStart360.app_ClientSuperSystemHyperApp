'use client'

/**
 * MetricZonesGrid — Красная / Жёлтая / Зелёная зона + «Без оценки» on
 * /point-a and /dashboard.
 *
 * Zones come from the catalog `status` of each metric (see ./metric-zones):
 * on_track → green, at_risk → yellow, off_track → red; a value without a
 * target is «нет цели» and a missing value is «нет данных» — never green.
 * Clicking a row opens the metric drill-down (mounted here).
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useMetricCatalog } from '@/hooks/useMetricCatalog'
import MetricDrillDownHost from '@/components/metrics/MetricDrillDownHost'
import { formatItemValue, type CatalogItem } from '@/components/metrics/catalog-model'
import { groupByZone, ZONE_STATUS_PARAM, type Zone } from './metric-zones'

type ColoredZone = Exclude<Zone, 'neutral'>

const ZONE_STYLE: Record<
  ColoredZone,
  { title: string; dot: string; text: string; border: string; bg: string; chip: string; rule: string }
> = {
  red: {
    title: 'Красная зона',
    dot: 'bg-error',
    text: 'text-error',
    border: 'border-error/20',
    bg: 'bg-error/[0.04]',
    chip: 'bg-error/10 text-error',
    rule: 'Отставание: метрика заметно хуже цели или ориентира — нужен план действий.',
  },
  yellow: {
    title: 'Жёлтая зона',
    dot: 'bg-tertiary-container',
    text: 'text-tertiary-container',
    border: 'border-tertiary-container/20',
    bg: 'bg-tertiary-container/[0.04]',
    chip: 'bg-tertiary-container/10 text-tertiary-container',
    rule: 'Риск: метрика близко к границе цели или ориентира — под наблюдением.',
  },
  green: {
    title: 'Зелёная зона',
    dot: 'bg-primary',
    text: 'text-primary',
    border: 'border-primary/20',
    bg: 'bg-primary/[0.04]',
    chip: 'bg-primary/10 text-primary',
    rule: 'В плане: метрика на уровне цели или ориентира либо лучше.',
  },
}

const ROW_LIMIT = 5

function pluralizeMetric(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'метрика'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'метрики'
  return 'метрик'
}

function MetricRow({ item, valueClass, onOpen }: { item: CatalogItem; valueClass: string; onOpen: (i: CatalogItem) => void }) {
  return (
    <li className="transition-opacity duration-150">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`${item.label}: ${formatItemValue(item)} — открыть подробности`}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40 text-left transition"
      >
        <span className="text-sm text-on-surface truncate flex-1 min-w-0">{item.label}</span>
        <span className={`font-mono font-bold text-sm tabular-nums flex-shrink-0 ${valueClass}`}>
          {formatItemValue(item)}
        </span>
      </button>
    </li>
  )
}

function ZoneCard({ zone, rows, onOpen }: { zone: ColoredZone; rows: CatalogItem[]; onOpen: (i: CatalogItem) => void }) {
  const style = ZONE_STYLE[zone]
  const visibleRows = rows.slice(0, ROW_LIMIT)
  const remainder = Math.max(0, rows.length - visibleRows.length)
  const href = `/metrics?status=${ZONE_STATUS_PARAM[zone]}#metrics-catalog`
  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} bg-surface-container-low p-5 shadow-card flex flex-col`} data-zone={zone}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2 h-2 rounded-full ${style.dot} flex-shrink-0`} aria-hidden="true" />
        <h3 className="font-headline text-base text-on-surface">{style.title}</h3>
        <span
          className="material-symbols-outlined text-[15px] text-on-surface-variant cursor-help"
          title={style.rule}
          aria-label={`Правило зоны: ${style.rule}`}
          role="img"
        >
          info
        </span>
        <span className={`ml-auto rounded-xl px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.15em] ${style.chip}`}>
          {rows.length} {pluralizeMetric(rows.length)}
        </span>
      </div>
      <ul className="flex flex-col gap-1 [&:hover>li:not(:hover)]:opacity-40" role="list">
        {visibleRows.length === 0 && <li className="text-xs text-on-surface-variant py-2">Нет метрик в этой зоне</li>}
        {visibleRows.map((row) => (
          <MetricRow key={row.id} item={row} valueClass={style.text} onOpen={onOpen} />
        ))}
      </ul>
      <div className="mt-auto pt-4 flex items-center justify-between text-xs">
        {remainder > 0 ? (
          <Link href={href} className={`${style.text} hover:underline font-mono`}>
            + ещё {remainder}
          </Link>
        ) : (
          <span />
        )}
        {rows.length > 0 && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-on-surface-variant hover:text-on-surface font-mono uppercase tracking-[0.15em] text-[10px]"
          >
            Открыть все
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
          </Link>
        )}
      </div>
    </div>
  )
}

function NeutralCard({
  noTarget,
  noData,
  onOpen,
}: {
  noTarget: CatalogItem[]
  noData: CatalogItem[]
  onOpen: (i: CatalogItem) => void
}) {
  const rows = noTarget.slice(0, 3)
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 shadow-card flex flex-col" data-zone="neutral">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-on-surface-variant/40 flex-shrink-0" aria-hidden="true" />
        <h3 className="font-headline text-base text-on-surface">Без оценки</h3>
        <span
          className="material-symbols-outlined text-[15px] text-on-surface-variant cursor-help"
          title="Зона определяется сравнением с целью или ориентиром. Здесь — метрики, у которых их нет, и метрики без значения."
          aria-label="Зона определяется сравнением с целью или ориентиром"
          role="img"
        >
          info
        </span>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.12em] text-on-surface-variant mb-1">
        <span>Нет цели</span>
        <span>{noTarget.length}</span>
      </div>
      <ul className="flex flex-col gap-1 mb-3" role="list">
        {rows.length === 0 && <li className="text-xs text-on-surface-variant py-1">—</li>}
        {rows.map((row) => (
          <MetricRow key={row.id} item={row} valueClass="text-on-surface" onOpen={onOpen} />
        ))}
      </ul>

      <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.12em] text-on-surface-variant">
        <span>Нет данных</span>
        <span>{noData.length}</span>
      </div>
      {noData.length > 0 && (
        <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
          Заполните анкету или загрузите документы (P&L, выгрузка CRM) — значения посчитаются автоматически.
        </p>
      )}

      <div className="mt-auto pt-4 flex items-center justify-between gap-2 text-xs">
        {noData.length > 0 ? (
          <Link
            href="/client/onboarding/documents"
            className="inline-flex items-center gap-1 text-primary/80 hover:text-primary font-mono text-[10px] uppercase tracking-[0.15em]"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">upload_file</span>
            Загрузить
          </Link>
        ) : (
          <span />
        )}
        <Link
          href="/metrics?status=no_target,no_data#metrics-catalog"
          className="inline-flex items-center gap-1 text-on-surface-variant hover:text-on-surface font-mono uppercase tracking-[0.15em] text-[10px]"
        >
          Открыть все
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>
    </div>
  )
}

function ZonesGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" aria-busy="true" aria-label="Загружаем зоны метрик">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 shadow-card animate-pulse">
          <div className="h-4 w-32 bg-white/[0.06] rounded mb-4" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="h-8 bg-white/[0.03] rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MetricZonesGrid() {
  const { data, isLoading, isError, error, refetch } = useMetricCatalog({ category: 'all', search: '', sort: 'label_asc' })
  const [drillItem, setDrillItem] = useState<CatalogItem | null>(null)
  const groups = useMemo(() => groupByZone(data?.items ?? []), [data])

  if (isLoading) return <ZonesGridSkeleton />

  if (isError) {
    return (
      <div className="rounded-2xl border border-error/20 bg-error/5 p-5 text-sm text-on-surface" role="alert">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-error" aria-hidden="true">error</span>
          <span className="font-headline">Не удалось загрузить зоны метрик</span>
        </div>
        <p className="text-on-surface-variant text-xs mb-3">{error instanceof Error ? error.message : 'Неизвестная ошибка'}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
          Повторить
        </button>
      </div>
    )
  }

  const assessed = groups.red.length + groups.yellow.length + groups.green.length

  return (
    <div className="space-y-3">
      {assessed === 0 && groups.noTarget.length > 0 && (
        <p className="text-xs text-on-surface-variant" role="note">
          Зоны строятся сравнением с целью или ориентиром. Пока ни у одной метрики со значением их нет — метрики собраны
          в блоке «Без оценки».
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Зоны состояния метрик">
        <ZoneCard zone="red" rows={groups.red} onOpen={setDrillItem} />
        <ZoneCard zone="yellow" rows={groups.yellow} onOpen={setDrillItem} />
        <ZoneCard zone="green" rows={groups.green} onOpen={setDrillItem} />
        <NeutralCard noTarget={groups.noTarget} noData={groups.noData} onOpen={setDrillItem} />
      </div>
      {drillItem && <MetricDrillDownHost item={drillItem} onClose={() => setDrillItem(null)} />}
    </div>
  )
}
