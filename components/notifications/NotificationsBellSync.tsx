'use client'

import { useEffect } from 'react'
import { useNotificationsStore } from '@/stores/notifications.store'

// Hydrates the header bell's unread badge from the real feed (app_notifications).
// Polls lightly; a realtime channel can replace the interval later.
export function NotificationsBellSync() {
  const setUnreadCount = useNotificationsStore((s) => s.setUnreadCount)

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      fetch('/api/v1/notifications?filter=unread', { credentials: 'include' })
        .then((r) => r.json())
        .then((j) => { if (!cancelled && j?.ok) setUnreadCount(j.unread ?? 0) })
        .catch(() => {})
    }
    tick()
    const iv = setInterval(tick, 60_000)
    const onFocus = () => tick()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [setUnreadCount])

  return null
}
