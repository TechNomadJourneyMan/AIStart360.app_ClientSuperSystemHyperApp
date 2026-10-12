'use client'

/**
 * State of the Point A page (GET /api/v1/point-a/state) and its actions:
 * recalculate, resolve a data discrepancy, change the client's block view.
 * Refreshes itself on a new snapshot / discrepancy (Supabase Realtime,
 * migration 114) and polls while a recalculation is queued or running.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { PointAState } from '@/lib/point-a/v4/state'
import { useRealtimeSync, type RealtimeSyncBinding } from './useRealtimeSync'
import { GOALS_QUERY_KEY } from './useGoals'

export type PointAPageState = PointAState & { companyId: string; canManage: boolean; role: string }

export const POINT_A_STATE_KEY = ['point-a-state'] as const

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? 'Ошибка запроса')
  return body.data as T
}

export function usePointAState(opts: { enabled?: boolean } = {}) {
  const query = useQuery({
    enabled: opts.enabled ?? true,
    queryKey: POINT_A_STATE_KEY,
    queryFn: async () => json<PointAPageState>(await fetch('/api/v1/point-a/state', { cache: 'no-store' })),
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data && q.state.data.recalculation !== 'idle' ? 5_000 : 60_000),
  })
  const companyId = query.data?.companyId ?? null
  const bindings = useMemo<RealtimeSyncBinding[]>(
    () => companyId
      ? [
          { table: 'point_a_snapshots', filter: { column: 'company_id', value: companyId }, invalidateKeys: [POINT_A_STATE_KEY, GOALS_QUERY_KEY] },
          { table: 'data_discrepancies', filter: { column: 'company_id', value: companyId }, invalidateKeys: [POINT_A_STATE_KEY] },
        ]
      : [],
    [companyId],
  )
  useRealtimeSync(bindings)
  return query
}

export function useRecalculatePointA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => json<unknown>(await fetch('/api/v1/diagnostics/recalculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })),
    onSettled: () => qc.invalidateQueries({ queryKey: POINT_A_STATE_KEY }),
  })
}

export type ResolveBody =
  | { choice: 'candidate'; index: number; note?: string }
  | { choice: 'custom'; value: number; note?: string }
  | { choice: 'ignore'; note?: string }

export function useResolveDiscrepancy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: ResolveBody }) =>
      json<unknown>(await fetch(`/api/v1/data/discrepancies/${encodeURIComponent(id)}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
    onSettled: () => qc.invalidateQueries({ queryKey: POINT_A_STATE_KEY }),
  })
}

export function useBlockView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientView: { hidden?: string[]; order?: string[]; added?: string[] }) =>
      json<unknown>(await fetch('/api/v1/point-a/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientView }) })),
    onSettled: () => qc.invalidateQueries({ queryKey: POINT_A_STATE_KEY }),
  })
}
