'use client'

import { useMemo } from 'react'
import type { QueryKey } from '@tanstack/react-query'
import { useRealtimeSync, type RealtimeSyncBinding } from './useRealtimeSync'

/**
 * Composition hook for the `/metrics` catalog page. Subscribes to metrics-table
 * changes and invalidates:
 *  - `['metrics']` and `['metrics-catalog']` (exact-key invalidations)
 *  - every active `['timeseries', metricId, period]` query (predicate-based,
 *    because we don't know which metricId/period combos the page has loaded)
 *
 * `companyId` is required because metrics rows are scoped by `company_id`.
 * If absent the hook is a no-op (status='closed').
 */
export function useRealtimeMetrics(companyId: string | null) {
  const bindings = useMemo<RealtimeSyncBinding[]>(() => {
    if (!companyId) return []

    const timeseriesPredicate = (query: { queryKey: QueryKey }) =>
      Array.isArray(query.queryKey) && query.queryKey[0] === 'timeseries'

    return [
      {
        table: 'metrics',
        filter: { column: 'company_id', value: companyId },
        invalidateKeys: [['metrics'], ['metrics-catalog']],
        invalidatePredicates: [timeseriesPredicate],
      },
    ]
  }, [companyId])

  return useRealtimeSync(bindings)
}
