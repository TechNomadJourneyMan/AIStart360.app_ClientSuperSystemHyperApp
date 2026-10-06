'use client'

/**
 * MetricDrillDownHost — mounts <MetricDrillDownModalV2/> for one metric.
 *
 * Callers pass either a full catalog item (the /metrics catalog, the zones
 * grid) or just a metric id + label (the key-metrics hero, whose data comes
 * from /api/v1/metrics) — in that case the enriched catalog item is fetched
 * by id. recharts lives inside the modal, so the modal is loaded lazily.
 */

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useCatalogItem } from '@/hooks/useMetricCatalog'
import type { DrillProvenance } from '@/components/dashboard/_drill-down-utils'
import { buildProvenanceChain, displayUnit, formatItemValue, sourceLabel, type CatalogItem } from './catalog-model'

const MetricDrillDownModalV2 = dynamic(() => import('@/components/dashboard/MetricDrillDownModalV2'), {
  ssr: false,
})

type DescriptionShape = { what: string; why?: string; how?: string }

/**
 * Generic what/why/how of a metric from lib/metrics/descriptions.ts (171 KB,
 * loaded on demand). Only the definition texts are used — `current_state`
 * sample texts are deliberately ignored.
 */
function useFallbackDescription(item: CatalogItem | null): DescriptionShape | undefined {
  const [desc, setDesc] = useState<DescriptionShape | undefined>(undefined)
  const needsFallback = Boolean(item) && !item?.description
  const id = item?.id ?? null
  useEffect(() => {
    setDesc(undefined)
    if (!item || !needsFallback) return
    let cancelled = false
    void import('@/lib/metrics/descriptions')
      .then(({ getBizDescription, getKpiDescription, getGriDescription }) => {
        if (cancelled) return
        let d: { what: string; why: string; how: string } | undefined
        if (item.namespace === 'biz' && item.department) d = getBizDescription(item.department, item.label)
        else if (item.namespace === 'kpi') d = getKpiDescription(item.label)
        else if (item.namespace === 'gri') d = getGriDescription(item.label)
        setDesc(d ? { what: d.what, why: d.why, how: d.how } : undefined)
      })
      .catch(() => {
        if (!cancelled) setDesc(undefined)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, needsFallback])
  return desc
}

function buildDrillProvenance(item: CatalogItem): DrillProvenance {
  const considered = item.sources.map((s) => {
    const hit = item.source !== null && (item.source === s.type || (item.source === 'external' && s.type === 'prisma'))
    const label =
      s.type === 'survey'
        ? `Анкета: ${s.label ?? s.key ?? ''}`
        : s.type === 'document'
          ? `Документ (${s.doc_type ?? '—'}) поле ${s.field ?? '—'}`
          : s.type === 'prisma'
            ? 'CRM / база платформы'
            : s.type === 'external'
              ? `Интеграция: ${s.system ?? '—'}`
              : sourceLabel(s.type)
    return {
      type: s.type,
      label,
      status: (hit ? 'hit' : 'miss') as 'hit' | 'miss' | 'error',
      confidence: hit ? item.confidence ?? undefined : undefined,
    }
  })
  if (item.source === 'gri_assessment') {
    considered.unshift({ type: 'gri_assessment', label: 'GRI-оценка (средний балл раздела)', status: 'hit', confidence: item.confidence ?? undefined })
  }
  const picked = considered.find((c) => c.status === 'hit')
  return {
    picked: picked ? { type: picked.type, label: picked.label } : null,
    considered,
    computedAt: item.lastUpdated ?? item.computedAt ?? undefined,
  }
}

export interface MetricDrillDownHostProps {
  /** Full catalog item when the caller has it. */
  item?: CatalogItem | null
  /** Metric id to fetch when `item` is not provided. */
  metricId?: string | null
  /** Label shown while the item loads (and if the id is not in the catalog). */
  fallbackLabel?: string
  fallbackUnit?: string
  fallbackValue?: number | string | null
  onClose: () => void
}

export default function MetricDrillDownHost({
  item: itemProp = null,
  metricId = null,
  fallbackLabel,
  fallbackUnit,
  fallbackValue = null,
  onClose,
}: MetricDrillDownHostProps) {
  const lookupId = itemProp ? null : metricId
  const { data: fetched } = useCatalogItem(lookupId)
  const item: CatalogItem | null = itemProp ?? fetched ?? null
  const fallbackDescription = useFallbackDescription(item)

  const id = item?.id ?? metricId
  const description = useMemo<DescriptionShape | undefined>(() => {
    if (item?.description) return { what: item.description }
    return fallbackDescription
  }, [item?.description, fallbackDescription])

  const provenance = useMemo(() => (item ? buildDrillProvenance(item) : undefined), [item])
  const chain = useMemo(
    () => (item ? buildProvenanceChain(item, (v) => formatItemValue(item, v)) : undefined),
    [item],
  )

  if (!id) return null

  const value = item ? item.value : fallbackValue
  const trend =
    item && item.deltaPct !== null && item.trend !== 'unknown'
      ? { direction: item.trend === 'up' ? ('up' as const) : item.trend === 'down' ? ('down' as const) : ('flat' as const), deltaPct: item.deltaPct }
      : undefined

  return (
    <MetricDrillDownModalV2
      open
      onClose={onClose}
      metricId={id}
      metricLabel={item?.label ?? fallbackLabel ?? id}
      unit={item?.valueKind === 'flag' ? undefined : displayUnit(item?.unit ?? fallbackUnit)}
      description={description}
      calculationMethod={item?.calculationMethod ?? item?.formula ?? null}
      target={item?.target ?? null}
      benchmark={item?.benchmark ?? null}
      status={item?.status ?? null}
      provenanceType={item?.provenanceType ?? null}
      confidence={item?.confidence ?? null}
      period={item?.period ?? null}
      provenanceChain={chain}
      provenance={provenance}
      liveValue={value !== null && value !== undefined ? { value, trend } : undefined}
      displayValue={item?.valueKind === 'flag' && value !== null && value !== undefined ? formatItemValue(item, value) : undefined}
    />
  )
}
