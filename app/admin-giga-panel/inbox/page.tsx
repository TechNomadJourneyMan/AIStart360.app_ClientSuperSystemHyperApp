'use client'

import { OmnichannelModule } from '@/components/giga-panel/OmnichannelModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export default function InboxPage() {
  return (
    <RequirePermission permission="inbox.view">
      <Breadcrumbs crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Instagram / WhatsApp' }]} />
      <OmnichannelModule />
    </RequirePermission>
  )
}
