'use client'

import { Suspense } from 'react'
import { ApprovalsPage } from '@/components/giga-panel/agents/ApprovalsPage'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ApprovalsPage />
    </Suspense>
  )
}
