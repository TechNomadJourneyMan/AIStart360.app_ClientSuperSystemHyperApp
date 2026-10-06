// Zone classification for <MetricZonesGrid/> — pure, unit-tested.
//
// Zones follow the catalog `status` (docs/platform/04-point-a.md §2.4):
//   on_track  → green  «В плане»
//   at_risk   → yellow «Риск»
//   off_track → red    «Отставание»
//   no_target → neutral «Нет цели»   (a value without a target is NOT green)
//   no_data   → neutral «Нет данных»
// A metric without a value is always «нет данных», whatever the status says.

import type { MetricStatus } from '@/types/metric-catalog'
import { targetProgress, type CatalogItem } from '@/components/metrics/catalog-model'

export type Zone = 'red' | 'yellow' | 'green' | 'neutral'
export type NeutralReason = 'no_target' | 'no_data'

export interface ZoneClassification {
  zone: Zone
  /** Set for the neutral zone only. */
  reason: NeutralReason | null
}

export function classifyMetric(item: { status?: MetricStatus | string | null; value: number | string | null }): ZoneClassification {
  const hasValue = item.value !== null && item.value !== undefined && item.value !== ''
  if (!hasValue) return { zone: 'neutral', reason: 'no_data' }
  switch (item.status) {
    case 'on_track':
      return { zone: 'green', reason: null }
    case 'at_risk':
      return { zone: 'yellow', reason: null }
    case 'off_track':
      return { zone: 'red', reason: null }
    case 'no_data':
      return { zone: 'neutral', reason: 'no_data' }
    default:
      return { zone: 'neutral', reason: 'no_target' }
  }
}

export interface ZoneGroups {
  red: CatalogItem[]
  yellow: CatalogItem[]
  green: CatalogItem[]
  noTarget: CatalogItem[]
  noData: CatalogItem[]
}

function byProgressAsc(a: CatalogItem, b: CatalogItem): number {
  return (targetProgress(a) ?? 1) - (targetProgress(b) ?? 1)
}

function byUpdatedDesc(a: CatalogItem, b: CatalogItem): number {
  const ta = a.lastUpdated ? Date.parse(a.lastUpdated) : 0
  const tb = b.lastUpdated ? Date.parse(b.lastUpdated) : 0
  return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
}

export function groupByZone(items: ReadonlyArray<CatalogItem>): ZoneGroups {
  const g: ZoneGroups = { red: [], yellow: [], green: [], noTarget: [], noData: [] }
  for (const it of items) {
    const c = classifyMetric(it)
    if (c.zone === 'red') g.red.push(it)
    else if (c.zone === 'yellow') g.yellow.push(it)
    else if (c.zone === 'green') g.green.push(it)
    else if (c.reason === 'no_target') g.noTarget.push(it)
    else g.noData.push(it)
  }
  g.red.sort(byProgressAsc)
  g.yellow.sort(byProgressAsc)
  g.green.sort(byUpdatedDesc)
  g.noTarget.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  return g
}

export const ZONE_STATUS_PARAM: Record<Exclude<Zone, 'neutral'>, MetricStatus> = {
  red: 'off_track',
  yellow: 'at_risk',
  green: 'on_track',
}
