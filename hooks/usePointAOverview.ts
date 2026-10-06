'use client'

/**
 * usePointAOverview — React Query hook for the Point A executive overview
 * (GET /api/v1/point-a/overview, contract in types/point-a-overview.ts).
 *
 * The query never throws for the two "expected" empty answers:
 *   • 404 {ok:false, error:'no_company'} → { kind: 'no_company' }
 *   • 401                               → { kind: 'unauthorized' }
 * Everything else that is not `{ok:true,data}` is a real error (retry UI).
 *
 * Realtime (optional): pass `userId` and the hook invalidates the overview on
 * changes of the tables that feed it (diagnostics, documents, GRI, metrics).
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PointAOverview } from '@/types/point-a-overview'
import { useRealtimeSync, type RealtimeSyncBinding } from './useRealtimeSync'

export const POINT_A_OVERVIEW_QUERY_KEY = ['point-a-overview'] as const

export type PointAOverviewResult =
  | { kind: 'ready'; data: PointAOverview }
  | { kind: 'no_company' }
  | { kind: 'unauthorized' }

export class PointAOverviewError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'PointAOverviewError'
    this.status = status
  }
}

interface OverviewEnvelope {
  ok?: boolean
  data?: PointAOverview
  error?: string
}

/** Pure response → result mapping (exported for tests). */
export function interpretOverviewResponse(status: number, body: OverviewEnvelope | null): PointAOverviewResult {
  if (status === 401) return { kind: 'unauthorized' }
  if (body?.ok === false && body.error === 'no_company') return { kind: 'no_company' }
  if (status === 404) return { kind: 'no_company' }
  if (status >= 200 && status < 300 && body?.ok && body.data) return { kind: 'ready', data: body.data }
  throw new PointAOverviewError(
    status >= 500
      ? 'Сервис Точки А временно недоступен'
      : status === 403
        ? 'Нет доступа к данным этой компании'
        : `Не удалось загрузить обзор Точки А (${status})`,
    status,
  )
}

async function fetchOverview(): Promise<PointAOverviewResult> {
  const res = await fetch('/api/v1/point-a/overview', { cache: 'no-store', credentials: 'include' })
  const body = (await res.json().catch(() => null)) as OverviewEnvelope | null
  return interpretOverviewResponse(res.status, body)
}

export interface UsePointAOverviewOptions {
  /** Supabase user id — enables realtime invalidation when provided. */
  userId?: string | null
  enabled?: boolean
}

export function usePointAOverview({ userId = null, enabled = true }: UsePointAOverviewOptions = {}) {
  const query = useQuery({
    queryKey: POINT_A_OVERVIEW_QUERY_KEY,
    queryFn: fetchOverview,
    staleTime: 60_000,
    enabled,
    retry: (failureCount, error) => {
      // 4xx other than the handled ones won't fix themselves.
      if (error instanceof PointAOverviewError && error.status >= 400 && error.status < 500) return false
      return failureCount < 1
    },
  })

  const companyId = query.data?.kind === 'ready' ? query.data.data.companyId : null

  const bindings = useMemo<RealtimeSyncBinding[]>(() => {
    if (!userId) return []
    const keys = [[...POINT_A_OVERVIEW_QUERY_KEY]]
    const list: RealtimeSyncBinding[] = [
      { table: 'diagnostics', filter: { column: 'user_id', value: userId }, invalidateKeys: keys },
      { table: 'documents', filter: { column: 'user_id', value: userId }, invalidateKeys: keys },
      { table: 'gri_assessments', filter: { column: 'user_id', value: userId }, invalidateKeys: keys },
    ]
    if (companyId) {
      list.push({ table: 'metrics', filter: { column: 'company_id', value: companyId }, invalidateKeys: keys })
    }
    return list
  }, [userId, companyId])

  useRealtimeSync(bindings)

  return query
}

// ─── Recalculate (POST /api/v1/diagnostics/recalculate) ─────────────────────

export class RecalculateError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'RecalculateError'
    this.status = status
  }
}

/** Russian, user-facing message for a failed recalculation (exported for tests). */
export function recalcErrorMessage(status: number): string {
  if (status === 422) return 'Сначала ответьте хотя бы на один шаг анкеты'
  if (status === 429) return 'Слишком много пересчётов подряд — попробуйте через минуту'
  if (status === 401) return 'Сессия истекла — войдите заново'
  return 'Не удалось пересчитать Точку А'
}

async function postRecalculate(): Promise<void> {
  const res = await fetch('/api/v1/diagnostics/recalculate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new RecalculateError(recalcErrorMessage(res.status), res.status)
}

export function useRecalculateDiagnostics(onDone?: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: postRecalculate,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: POINT_A_OVERVIEW_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['point-a-aggregate'] }),
      ])
      onDone?.()
    },
  })
}
