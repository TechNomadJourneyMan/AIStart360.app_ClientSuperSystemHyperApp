import type { Metadata } from 'next'
import { SalesMonitoringWorkspace } from '@/components/sales-monitoring/SalesMonitoringWorkspace'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Мониторинг продаж',
  description: 'Продажи, расходы, планы, управленческая аналитика и AI-помощник',
}

export default function SalesMonitoringPage() {
  return <SalesMonitoringWorkspace />
}
