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

/** The caller has no company (staff, or a client before the questionnaire). */
export interface NoCompany { noCompany: { staff: boolean } }

type StateResponse = PointAPageState | NoCompany

function isNoCompany(d: StateResponse | undefined): d is NoCompany {
  return !!d && 'noCompany' in d
}

export function usePointAState(opts: { enabled?: boolean } = {}) {
  const query = useQuery({
    enabled: opts.enabled ?? true,
    queryKey: POINT_A_STATE_KEY,
    queryFn: async (): Promise<StateResponse> => {
      const res = await fetch('/api/v1/point-a/state', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.ok && body.noCompany) return { noCompany: { staff: Boolean(body.noCompany.staff) } }
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? 'Ошибка запроса')
      return body.data as PointAPageState
    },
    staleTime: 10_000,
    // Poll only a company whose recalculation is under way (no company → never).
    refetchInterval: (q) => (!q.state.data || isNoCompany(q.state.data) ? false : q.state.data.recalculation !== 'idle' ? 5_000 : 60_000),
  })
  const raw = query.data
  const state: PointAPageState | undefined = raw && !isNoCompany(raw) ? (raw as PointAPageState) : undefined
  const companyId = state?.companyId ?? null
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
  return {
    data: state,
    noCompany: isNoCompany(raw) ? raw.noCompany : null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useRecalculatePointA() {
  const qc = useQueryClient()
  return useMutation({
    // Company-scoped (a member / admin recalculates the company, not their own questionnaire).
    mutationFn: async () => json<unknown>(await fetch('/api/v1/point-a/recalculate', { method: 'POST' })),
    onSettled: () => qc.invalidateQueries({ queryKey: POINT_A_STATE_KEY }),
  })
}

export type ResolveBody =
  | { choice: 'candidate'; index: number; expected?: { sourceRef: string; value: number }; note?: string }
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

export function useBlockDetail(key: string | null) {
  return useQuery({
    queryKey: [...POINT_A_STATE_KEY, 'block', key],
    enabled: !!key,
    queryFn: async () => json<import('@/lib/point-a/v4/metric-views').BlockDetail>(await fetch(`/api/v1/point-a/block/${encodeURIComponent(key as string)}`, { cache: 'no-store' })),
    staleTime: 30_000,
  })
}

export function useKeyMetrics() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (keyMetrics: string[]) =>
      json<unknown>(await fetch('/api/v1/point-a/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientView: { keyMetrics } }) })),
    onSettled: () => qc.invalidateQueries({ queryKey: POINT_A_STATE_KEY }),
  })
}
