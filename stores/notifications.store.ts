import { create } from 'zustand'
import type { Notification } from '@/types'

interface NotificationsState {
  notifications: Notification[]
  unreadCount: number

  // Actions
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  addNotification: (notif: Notification) => void
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],
  unreadCount: 0,

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
}))
