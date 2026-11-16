import { create } from 'zustand'
import type { Notification } from '@/types'

interface NotificationsState {
  notifications: Notification[]
  unreadCount: number
  /**
   * The count came from the feed (NotificationsBellSync / the feed page), not
   * the initial 0. Until then the cabinet bell shows the server's count
   * (R-096); after it — this store, so «Прочитать все» updates it at once (WA-4).
   */
  synced: boolean

  // Actions
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  addNotification: (notif: Notification) => void
  setUnreadCount: (n: number) => void
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],
  unreadCount: 0,
  synced: false,

  markAsRead: (id) =>
    set((s) => {
      const notifications = s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      )
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      }
    }),

  markAllAsRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  addNotification: (notif) =>
    set((s) => ({
      notifications: [notif, ...s.notifications],
      unreadCount: s.unreadCount + (notif.read ? 0 : 1),
    })),

  setUnreadCount: (n) => set({ unreadCount: Math.max(0, Math.floor(Number(n) || 0)), synced: true }),
}))
