/**
 * WA-4: the feed page tells the bell at once — through the same store that
 * NotificationsBellSync fills — instead of the bell showing the old number
 * for up to a minute after «Прочитать все» or after opening an entry.
 */
import { useNotificationsStore } from '@/stores/notifications.store'

/** The feed knows the exact unread count (after loading it, or 0 after «Прочитать все»). */
export function publishUnreadCount(n: number): void {
  useNotificationsStore.getState().setUnreadCount(n)
}

/** One entry was opened (marked read): one less, never below zero. */
export function publishOneRead(): void {
  const s = useNotificationsStore.getState()
  s.setUnreadCount(s.unreadCount - 1)
}
