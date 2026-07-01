import type { Metadata } from 'next'
import { NotificationsFeed } from '@/components/notifications/NotificationsFeed'

export const metadata: Metadata = { title: 'Notifications' }
export const dynamic = 'force-dynamic'

export default function NotificationsPage() {
  return <NotificationsFeed />
}
