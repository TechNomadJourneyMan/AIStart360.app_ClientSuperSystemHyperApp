'use client'

import { Suspense } from 'react'
import { AgentTasksPage } from '@/components/giga-panel/agents/AgentTasksPage'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AgentTasksPage />
    </Suspense>
  )
}
