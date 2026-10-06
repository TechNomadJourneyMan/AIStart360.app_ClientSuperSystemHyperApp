'use client'

import { useMemo } from 'react'
import { useGigaQuery } from '../kit'
import type { AgentsListResponse } from './types'

/**
 * Agent names for filters and tables (tasks, approvals, costs). When the list
 * cannot be loaded (or `enabled` is false — no agents.view) the pages still
 * work and show raw agent keys.
 */
export function useAgentDirectory(enabled = true) {
  const q = useGigaQuery<AgentsListResponse>(enabled ? '/api/giga-admin/agents' : null)
  const names = useMemo(() => Object.fromEntries((q.data?.agents ?? []).map((a) => [a.key, a.name])) as Record<string, string>, [q.data])
  const options = useMemo(
    () => [{ value: '', label: 'Все агенты' }, ...(q.data?.agents ?? []).map((a) => ({ value: a.key, label: a.name }))],
    [q.data],
  )
  return { names, options, agents: q.data?.agents ?? null, loading: q.loading, error: q.error }
}
