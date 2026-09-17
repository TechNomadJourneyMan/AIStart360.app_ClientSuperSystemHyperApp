'use client'

import { InsightModerationModule } from '@/components/giga-panel/InsightModerationModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export default function ModerationPage() {
  return (
    <RequirePermission permission="insights.moderate">
      <Breadcrumbs crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Модерация ИИ' }]} />
      <InsightModerationModule />
    </RequirePermission>
  )
}
