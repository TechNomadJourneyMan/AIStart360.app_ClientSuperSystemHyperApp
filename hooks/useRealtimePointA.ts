'use client'

import { useMemo } from 'react'
import { useRealtimeSync, type RealtimeSyncBinding } from './useRealtimeSync'

/**
 * Composition hook for `/point-a`. Subscribes to the three tables that feed
 * the Point-A aggregate (metrics, diagnostics, documents) and invalidates the
 * page-level + per-table React Query caches whenever any of them change.
 *
 * `companyId` may be `null` if the user has not yet completed onboarding —
 * in that case we skip the metrics binding (metrics rows are company-scoped
 * via `company_id`).
 */
export function useRealtimePointA(userId: string, companyId: string | null) {
  const bindings = useMemo<RealtimeSyncBinding[]>(() => {
    const list: RealtimeSyncBinding[] = []

    if (companyId) {
      list.push({
        table: 'metrics',
        filter: { column: 'company_id', value: companyId },
        invalidateKeys: [['point-a-aggregate'], ['metrics']],
      })
    }

    list.push({
      table: 'diagnostics',
      filter: { column: 'user_id', value: userId },
      invalidateKeys: [['point-a-aggregate']],
    })

    list.push({
      table: 'documents',
      filter: { column: 'user_id', value: userId },
      invalidateKeys: [['documents'], ['point-a-aggregate']],
    })

    return list
  }, [userId, companyId])

  return useRealtimeSync(bindings)
}
