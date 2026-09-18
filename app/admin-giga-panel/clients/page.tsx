'use client'

import { ClientsModule } from '@/components/giga-panel/ClientsModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export default function ClientsPage() {
  return (
    <RequirePermission permission="users.view">
      <Breadcrumbs crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Клиенты' }]} />
      <ClientsModule />
    </RequirePermission>
  )
}
