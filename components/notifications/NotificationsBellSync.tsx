'use client'

import { useEffect } from 'react'
import { useNotificationsStore } from '@/stores/notifications.store'

/** A focus right after a fetch does not fetch again (tab hopping, dialogs). */
const FOCUS_MIN_GAP_MS = 15_000

// Hydrates the header bell's unread badge from the real feed (app_notifications).
// Polls lightly; a realtime channel can replace the interval later.
// A hidden tab does not poll (each poll is an Auth check + a DB read on the
// server); the count is refreshed as soon as the tab is back.
export function NotificationsBellSync() {
  const setUnreadCount = useNotificationsStore((s) => s.setUnreadCount)

  useEffect(() => {
    let cancelled = false
    let lastAt = 0
    const tick = () => {
      lastAt = Date.now()
      fetch('/api/v1/notifications?filter=unread', { credentials: 'include' })
        .then((r) => r.json())
        .then((j) => { if (!cancelled && j?.ok) setUnreadCount(j.unread ?? 0) })
        .catch(() => {})
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
