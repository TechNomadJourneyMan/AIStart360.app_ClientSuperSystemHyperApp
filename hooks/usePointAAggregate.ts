'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PointA } from '@/types/onboarding'

async function fetchAggregate(): Promise<PointA> {
  const res = await fetch('/api/v1/point-a/aggregate', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Не удалось загрузить Point A (${res.status})`)
  const json = await res.json() as { ok: boolean; data?: PointA; error?: string }
  if (!json.ok || !json.data) throw new Error(json.error ?? 'Пустой ответ от агрегатора')
  return json.data
}

async function postAggregate(): Promise<PointA> {
  const res = await fetch('/api/v1/point-a/aggregate', { method: 'POST', cache: 'no-store' })
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
