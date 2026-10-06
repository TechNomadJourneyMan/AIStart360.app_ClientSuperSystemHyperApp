'use client'

import { AgentTaskDetailPage } from '@/components/giga-panel/agents/AgentTaskDetailPage'

export default function Page({ params }: { params: { id: string } }) {
  return <AgentTaskDetailPage taskId={params.id} />
}
