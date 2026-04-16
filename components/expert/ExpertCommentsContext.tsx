'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ExpertCommentsContext — single batch-load of ALL comments for a client,
// grouped by target id, shared across <Commentable> wrappers in all tabs.
// ─────────────────────────────────────────────────────────────────────────────
// Avoids N network calls (one per Commentable). Every commentable widget
// just reads the count/list from context; composer actions call the mutators
// which do the HTTP round-trip and apply the result optimistically.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExpertComment } from '@/lib/expert-blocks'

interface ExpertCommentsContextValue {
  clientId: string
  allComments: ExpertComment[]
  byTarget: Map<string, ExpertComment[]>
  /** Comments with blockKey === null (general feed) */
  general: ExpertComment[]
  loading: boolean
  error: string | null
  /** Re-fetch from server */
  refresh: () => Promise<void>
  /** POST a new comment, return it if success */
  create: (args: { targetId: string | null; text: string }) => Promise<ExpertComment | null>
  /** PATCH an existing comment body */
  update: (id: string, text: string) => Promise<ExpertComment | null>
  /** DELETE a comment */
  remove: (id: string) => Promise<boolean>
  /** Count of comments for a specific target (null → general) */
  countFor: (targetId: string | null) => number
  /** Comments for a specific target (null → general) */
  listFor: (targetId: string | null) => ExpertComment[]
}

const Ctx = createContext<ExpertCommentsContextValue | null>(null)

export function useExpertComments(): ExpertCommentsContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useExpertComments must be used inside <ExpertCommentsProvider>')
  return v
}

/** Safe hook variant — returns null outside provider (for components that can work standalone too) */
export function useExpertCommentsMaybe(): ExpertCommentsContextValue | null {
  return useContext(Ctx)
}

interface ProviderProps {
  clientId: string
  children: ReactNode
}

export function ExpertCommentsProvider({ clientId, children }: ProviderProps) {
  const [allComments, setAllComments] = useState<ExpertComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/expert/comments?clientId=${clientId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: ExpertComment[] }
      setAllComments(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // ── Derived indexes ─────────────────────────────────────────────────────────
  const { byTarget, general } = useMemo(() => {
    const map = new Map<string, ExpertComment[]>()
    const gen: ExpertComment[] = []
    for (const c of allComments) {
      if (!c.blockKey) {
        gen.push(c)
        continue
      }
      const arr = map.get(c.blockKey) ?? []
      arr.push(c)
      map.set(c.blockKey, arr)
    }
    return { byTarget: map, general: gen }
  }, [allComments])

  const countFor = useCallback(
    (targetId: string | null) => {
      if (!targetId) return general.length
      return byTarget.get(targetId)?.length ?? 0
    },
    [byTarget, general],
  )

  const listFor = useCallback(
    (targetId: string | null) => {
      if (!targetId) return general
      return byTarget.get(targetId) ?? []
    },
    [byTarget, general],
  )

  // ── Mutators (optimistic) ───────────────────────────────────────────────────
  const create = useCallback<ExpertCommentsContextValue['create']>(
    async ({ targetId, text }) => {
      try {
        const res = await fetch('/api/expert/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, targetId, text }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        const json = (await res.json()) as { data: ExpertComment }
        setAllComments((prev) => [json.data, ...prev])
        return json.data
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка создания')
        return null
      }
    },
    [clientId],
  )

  const update = useCallback<ExpertCommentsContextValue['update']>(
    async (id, text) => {
      try {
        const res = await fetch(`/api/expert/comments/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: ExpertComment | { text: string; updated_at: string } }
        // Server may return raw DB row (snake_case) — normalize to ExpertComment shape
        setAllComments((prev) =>
          prev.map((c) => {
            if (c.id !== id) return c
            const raw = json.data as Record<string, unknown>
            return {
              ...c,
              text: (raw.text as string) ?? text,
              updatedAt: (raw.updated_at as string) ?? (raw.updatedAt as string) ?? new Date().toISOString(),
            }
          }),
        )
        return null // caller uses local update; full row isn't strictly needed
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка обновления')
        return null
      }
    },
    [],
  )

  const remove = useCallback<ExpertCommentsContextValue['remove']>(
    async (id) => {
      try {
        const res = await fetch(`/api/expert/comments/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setAllComments((prev) => prev.filter((c) => c.id !== id))
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка удаления')
        return false
      }
    },
    [],
  )

  const value = useMemo<ExpertCommentsContextValue>(
    () => ({
      clientId,
      allComments,
      byTarget,
      general,
      loading,
      error,
      refresh,
      create,
      update,
      remove,
      countFor,
      listFor,
    }),
    [clientId, allComments, byTarget, general, loading, error, refresh, create, update, remove, countFor, listFor],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
