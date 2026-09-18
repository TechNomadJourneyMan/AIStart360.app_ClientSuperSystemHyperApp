'use client'

import { LeadsModule } from '@/components/giga-panel/LeadsModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export default function LeadsPage() {
  return (
    <RequirePermission permission="leads.view">
      <Breadcrumbs crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Лиды' }]} />
      <LeadsModule />
    </RequirePermission>
  )
}
