'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import { ClientsModule } from '@/components/giga-panel/ClientsModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export function AccountsPage() {
  const { base, label } = useWorkspace()
  return (
    <RequirePermission permission="users.view">
      <Breadcrumbs crumbs={[{ label, href: base }, { label: 'Клиенты' }]} />
      <ClientsModule />
    </RequirePermission>
  )
}
