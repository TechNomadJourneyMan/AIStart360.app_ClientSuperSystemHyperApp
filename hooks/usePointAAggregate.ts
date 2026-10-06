'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PointA } from '@/types/onboarding'

/** Non-error marker: the user has no company yet (404 from the aggregator). */
export const NO_COMPANY = 'no_company' as const
export type PointAAggregateResult = PointA | typeof NO_COMPANY

async function fetchAggregate(): Promise<PointAAggregateResult> {
  const res = await fetch('/api/v1/point-a/aggregate', { cache: 'no-store' })
  // No company yet is an expected empty state («пройдите анкету»), not an
  // error — it used to render a red «Не удалось загрузить… (404)» card.
  if (res.status === 404) return NO_COMPANY
  if (!res.ok) throw new Error(`Не удалось загрузить Point A (${res.status})`)
  const json = await res.json() as { ok: boolean; data?: PointA; error?: string }
  if (!json.ok || !json.data) throw new Error(json.error ?? 'Пустой ответ от агрегатора')
  return json.data
}

async function postAggregate(): Promise<PointAAggregateResult> {
  const res = await fetch('/api/v1/point-a/aggregate', { method: 'POST', cache: 'no-store' })
  if (res.status === 404) return NO_COMPANY
  if (!res.ok) throw new Error(`Не удалось пересчитать Point A (${res.status})`)
  const json = await res.json() as { ok: boolean; data?: PointA; error?: string }
  if (!json.ok || !json.data) throw new Error(json.error ?? 'Пустой ответ от агрегатора')
  return json.data
}

export const POINT_A_QUERY_KEY = ['point-a-aggregate'] as const

export function usePointAAggregate() {
  return useQuery({
    queryKey: POINT_A_QUERY_KEY,
    queryFn: fetchAggregate,
    staleTime: 60_000,
    retry: 1,
  })
}

export function useRecalculatePointA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: postAggregate,
    onSuccess: (data) => {
      qc.setQueryData(POINT_A_QUERY_KEY, data)
      qc.invalidateQueries({ queryKey: ['metrics'] })
      qc.invalidateQueries({ queryKey: ['metrics-catalog'] })
    },
  })
}
