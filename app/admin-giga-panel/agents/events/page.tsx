'use client'

import { Suspense } from 'react'
import { PlatformEventsPage } from '@/components/giga-panel/agents/PlatformEventsPage'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlatformEventsPage />
    </Suspense>
  )
}
