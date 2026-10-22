'use client'

/**
 * Goals of the current company (GET/POST /api/v1/goals, DELETE /api/v1/goals/[id]) —
 * the one source of goals (public.metric_targets), evaluated against the
 * current metric values.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Goal, GoalEvaluation } from '@/lib/goals/evaluate'

export interface GoalItem {
  goal: Goal
  evaluation: GoalEvaluation
}

export const GOALS_QUERY_KEY = ['goals'] as const
/** = POINT_A_STATE_KEY (hooks/usePointAState imports this module — no import back). */
const POINT_A_STATE_KEY = ['point-a-state'] as const

/** A goal change shows everywhere at once: the goals list and the Point A state (its goals, key metrics). */
function invalidateGoalViews(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([qc.invalidateQueries({ queryKey: GOALS_QUERY_KEY }), qc.invalidateQueries({ queryKey: POINT_A_STATE_KEY })])
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? 'Ошибка запроса')
  return body.data as T
}

export function useGoals() {
  return useQuery({
    queryKey: GOALS_QUERY_KEY,
    queryFn: async () => (await json<{ items: GoalItem[] }>(await fetch('/api/v1/goals', { cache: 'no-store' }))).items,
    staleTime: 30_000,
  })
}

export interface GoalDraft {
  metricId: string
  targetValue: number
  periodLabel: string
  direction?: Goal['direction']
  deadline?: string | null
  label?: string | null
}

export function useSaveGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (draft: GoalDraft) =>
      json<GoalItem>(await fetch('/api/v1/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })),
    onSuccess: () => invalidateGoalViews(qc),
  })
}

export function useDeleteGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => json<unknown>(await fetch(`/api/v1/goals/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    onSuccess: () => invalidateGoalViews(qc),
  })
}
