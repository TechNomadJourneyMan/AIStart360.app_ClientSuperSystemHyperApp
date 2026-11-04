'use client'

import { WorkspaceShell } from '@/components/giga-panel/WorkspaceShell'
import { ViewAsBanner } from '@/components/giga-panel/dev-tools/ViewAsBanner'
import { GIGA_WORKSPACE } from '@/components/giga-panel/WorkspaceContext'

export default function GigaPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell workspace={GIGA_WORKSPACE}>
      {/* Режим «посмотреть как роль» (Dev-tools Super Admin): полоса с выходом. */}
      <ViewAsBanner />
      {children}
    </WorkspaceShell>
  )
}
