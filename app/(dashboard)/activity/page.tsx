import type { Metadata } from 'next'
import { ActivityLogClient } from '@/components/activity/ActivityLogClient'

export const metadata: Metadata = { title: 'Журнал действий' }
export const dynamic = 'force-dynamic'

export default function ActivityPage() {
  return <ActivityLogClient />
}
