'use client'

import { Suspense } from 'react'
import { ReportsPage } from '@/components/giga-panel/reports/ReportsPage'

/** SuperExpert: report versions waiting for the expert (reports.review). */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReportsPage />
    </Suspense>
  )
}
