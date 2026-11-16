'use client'

import { useEffect } from 'react'
import { useNotificationsStore } from '@/stores/notifications.store'

/** A focus right after a fetch does not fetch again (tab hopping, dialogs). */
const FOCUS_MIN_GAP_MS = 15_000

/**
 * WA-5: the bell needs the NUMBER only — one `count` (head request), not the
 * 100 latest entries with their texts (app/api/v1/notifications ?count=1).
 */
export const UNREAD_COUNT_URL = '/api/v1/notifications?count=1'

/** Unread notifications of the session user, or null when the answer is not usable. */
export async function fetchUnreadCount(fetchFn: typeof fetch = fetch): Promise<number | null> {
  try {
    const r = await fetchFn(UNREAD_COUNT_URL, { credentials: 'include' })
    const j = (await r.json()) as { ok?: boolean; unread?: unknown }
    return j?.ok ? Math.max(0, Math.floor(Number(j.unread) || 0)) : null
  } catch {
    return null
  }
}

// Hydrates the bell's unread badge from the real feed (app_notifications).
// Polls lightly; a realtime channel can replace the interval later.
// A hidden tab does not poll (each poll is an Auth check + a DB count on the
// server); the count is refreshed as soon as the tab is back.
export function NotificationsBellSync() {
  const setUnreadCount = useNotificationsStore((s) => s.setUnreadCount)

  useEffect(() => {
    let cancelled = false
    let lastAt = 0
    const tick = () => {
      lastAt = Date.now()
      void fetchUnreadCount().then((n) => { if (!cancelled && n !== null) setUnreadCount(n) })
    }
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
    tick()
    const iv = setInterval(() => { if (!hidden()) tick() }, 60_000)
    const onFocus = () => { if (!hidden() && Date.now() - lastAt >= FOCUS_MIN_GAP_MS) tick() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      clearInterval(iv)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [setUnreadCount])

  return null
}
