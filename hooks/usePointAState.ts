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

/** Round 2 (R2-A): Point A is a paid section and the account has no access (API 402 upgrade_required). */
export interface Locked { locked: true }

type StateResponse = PointAPageState | NoCompany | Locked

function isNoCompany(d: StateResponse | undefined): d is NoCompany {
  return !!d && 'noCompany' in d
}

function isLocked(d: StateResponse | undefined): d is Locked {
  return !!d && 'locked' in d
}

/** How often the page re-reads its state (ms), or false. */
export function pollIntervalOf(d: StateResponse | undefined): number | false {
  if (!d || isNoCompany(d) || isLocked(d)) return false
  if (d.recalculation !== 'idle') return 5_000
  if (d.aiAnalysis?.status === 'processing') return 10_000
  return 60_000
}

export function usePointAState(opts: { enabled?: boolean } = {}) {
  const query = useQuery({
    enabled: opts.enabled ?? true,
    queryKey: POINT_A_STATE_KEY,
    queryFn: async (): Promise<StateResponse> => {
      const res = await fetch('/api/v1/point-a/state', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      // The paywall instead of an error with «Повторить» (no retries, no polling).
      if (res.status === 402 || body?.error === 'upgrade_required') return { locked: true }
      if (res.ok && body?.ok && body.noCompany) return { noCompany: { staff: Boolean(body.noCompany.staff) } }
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? 'Ошибка запроса')
      return body.data as PointAPageState
    },
    staleTime: 10_000,
    // Poll only a company whose recalculation is under way (no company → never);
    // while the AI analysis is being prepared — every 10 s (R3-PA).
    refetchInterval: (q) => pollIntervalOf(q.state.data),
  })
  const raw = query.data
  const state: PointAPageState | undefined = raw && !isNoCompany(raw) && !isLocked(raw) ? (raw as PointAPageState) : undefined
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
    /** Point A is closed for this account (paid section) — draw the paywall. */
    locked: isLocked(raw),
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

/**
 * «Повторить разбор» (R3-PA): POST /api/v1/diagnostics/retry-ai — owner or
 * staff, its own rate limit and the paid-section gate; the AI budget is
 * checked by the analysis itself. The page then polls the «готовится» state.
 */
export function useRetryAiAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (diagnosticId: string) => {
      const res = await fetch('/api/v1/diagnostics/retry-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ diagnostic_id: diagnosticId }) })
      const body = await res.json().catch(() => null)
      if (res.status === 429) throw new Error('Слишком много попыток — повторите через минуту')
      if (res.status === 402 || body?.error === 'upgrade_required') throw new Error('Разбор ИИ — в платном доступе')
      if (!res.ok || !body?.ok) throw new Error(typeof body?.error === 'string' && /[а-яё]/i.test(body.error) ? body.error : 'Не удалось перезапустить разбор')
      return body as { ok: true; ai_status: string }
    },
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
