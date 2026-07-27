import type { Metadata } from 'next'
import { SalesMonitoringWorkspace } from '@/components/sales-monitoring/SalesMonitoringWorkspace'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Мониторинг продаж' }

export default function ExpertSalesMonitoringPage() {
  return <SalesMonitoringWorkspace />
}
