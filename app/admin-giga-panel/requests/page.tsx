'use client'

import { RequestsModule } from '@/components/giga-panel/RequestsModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export default function RequestsPage() {
  return (
    <RequirePermission permission="users.view">
      <Breadcrumbs crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Заявки' }]} />
      <RequestsModule />
    </RequirePermission>
  )
}
