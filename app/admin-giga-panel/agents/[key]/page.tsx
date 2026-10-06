'use client'

import { Suspense } from 'react'
import { AgentDetailPage } from '@/components/giga-panel/agents/AgentDetailPage'

export default function Page({ params }: { params: { key: string } }) {
  return (
    <Suspense fallback={null}>
      <AgentDetailPage agentKey={params.key} />
    </Suspense>
  )
}
