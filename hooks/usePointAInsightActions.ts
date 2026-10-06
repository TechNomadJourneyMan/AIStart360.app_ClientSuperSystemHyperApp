'use client'

/**
 * Actions on Point A clarifying questions (table point_a_insights):
 *   • create  → POST  /api/v1/point-a/insights        (composer)
 *   • confirm → PATCH /api/v1/point-a/insights/[id]   { status: 'confirmed' }
 *   • answer  → PATCH /api/v1/point-a/insights/[id]   { answer_text, answer_author_role: 'client' }
 *
 * Every call returns the row as stored by the API — callers replace their
 * local item with it (nothing is added to the feed unless the API saved it).
 */

import { useCallback, useState } from 'react'
import type { InsightFeedItem } from '@/components/point-a/v2/InsightItem'

interface Envelope {
  ok?: boolean
  data?: InsightFeedItem
  error?: string
}

async function send(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<InsightFeedItem> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as Envelope | null
  if (!res.ok || !json?.ok || !json.data) {
    if (res.status === 401) throw new Error('Сессия истекла — войдите заново')
    if (res.status === 400) throw new Error('Проверьте текст: минимум 4 символа')
    throw new Error('Не удалось сохранить — попробуйте ещё раз')
  }
  return json.data
}

export function usePointAInsightActions() {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async <T,>(id: string, fn: () => Promise<T>): Promise<T | null> => {
    setPendingId(id)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      return null
    } finally {
      setPendingId(null)
    }
  }, [])

  const create = useCallback(
    (input: { question_text: string; category: string }) =>
      run('__new__', () =>
        send('/api/v1/point-a/insights', 'POST', {
          question_text: input.question_text,
          category: input.category,
          type: 'client',
          status: 'pending_ai',
        }),
      ),
    [run],
  )

  const confirm = useCallback(
    (id: string) => run(id, () => send(`/api/v1/point-a/insights/${encodeURIComponent(id)}`, 'PATCH', { status: 'confirmed' })),
    [run],
  )

  const answer = useCallback(
    (id: string, text: string) =>
      run(id, () =>
        send(`/api/v1/point-a/insights/${encodeURIComponent(id)}`, 'PATCH', {
          answer_text: text,
          answer_author_role: 'client',
        }),
      ),
    [run],
  )

  return { create, confirm, answer, pendingId, error, clearError: () => setError(null) }
}
