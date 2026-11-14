'use client'

/**
 * Loads the Point A clarifying-question feed (GET /api/v1/point-a/insights).
 *
 * A failed load (HTTP error, `ok: false`, network, bad JSON) is a load ERROR,
 * never an empty feed: the callers show an alert with «Повторить» instead of
 * «нет обсуждений» and zero counts.
 */

import { useCallback, useEffect, useState } from 'react'
import type { InsightFeedItem } from './InsightItem'

export type InsightsFeedLoad = { ok: true; items: InsightFeedItem[] } | { ok: false; error: string; locked?: boolean }

/** Round 2 (R2-A): Point A is a paid section — the feed is closed for this account (API 402). */
export const INSIGHTS_LOCKED = 'Обсуждения Точки А — в платном доступе.'

export const INSIGHTS_LOAD_ERROR = 'Не удалось загрузить обсуждения.'
export const INSIGHTS_SESSION_ERROR = 'Сессия истекла — войдите заново, чтобы увидеть обсуждения.'

export async function fetchInsightsFeed(limit: number, fetchImpl: typeof fetch = fetch): Promise<InsightsFeedLoad> {
  try {
    const res = await fetchImpl(`/api/v1/point-a/insights?limit=${limit}`, { cache: 'no-store' })
    if (res.status === 401) return { ok: false, error: INSIGHTS_SESSION_ERROR }
    if (res.status === 402) return { ok: false, error: INSIGHTS_LOCKED, locked: true }
    if (!res.ok) return { ok: false, error: INSIGHTS_LOAD_ERROR }
    const json = (await res.json()) as { ok?: boolean; data?: { items?: InsightFeedItem[] } } | null
    if (!json?.ok) return { ok: false, error: INSIGHTS_LOAD_ERROR }
    return { ok: true, items: Array.isArray(json.data?.items) ? json.data.items : [] }
  } catch {
    return { ok: false, error: INSIGHTS_LOAD_ERROR }
  }
}

export function useInsightsFeed(limit: number, initialItems?: InsightFeedItem[]) {
  const [items, setItems] = useState<InsightFeedItem[]>(initialItems ?? [])
  const [loading, setLoading] = useState(!initialItems)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (initialItems) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void fetchInsightsFeed(limit).then((r) => {
      if (cancelled) return
      if (r.ok) setItems(r.items)
      else if (r.locked) setLocked(true)
      else setLoadError(r.error)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [limit, initialItems, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { items, setItems, loading, loadError, reload, locked }
}
