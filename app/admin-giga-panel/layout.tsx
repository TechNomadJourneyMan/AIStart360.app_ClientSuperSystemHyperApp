'use client'

import { WorkspaceShell } from '@/components/giga-panel/WorkspaceShell'
import { GIGA_WORKSPACE } from '@/components/giga-panel/WorkspaceContext'

export default function GigaPanelLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell workspace={GIGA_WORKSPACE}>{children}</WorkspaceShell>
}
