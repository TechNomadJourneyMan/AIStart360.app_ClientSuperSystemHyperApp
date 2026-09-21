'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import { RequestsModule } from '@/components/giga-panel/RequestsModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export function RequestsPage() {
  const { base, label } = useWorkspace()
  return (
    <RequirePermission permission="users.view">
      <Breadcrumbs crumbs={[{ label, href: base }, { label: 'Заявки' }]} />
      <RequestsModule />
    </RequirePermission>
  )
}
