'use client'

import { MarketInsightsModule } from '@/components/giga-panel/MarketInsightsModule'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Breadcrumbs } from '@/components/giga-panel/kit'

export default function MarketPage() {
  return (
    <RequirePermission permission="market.manage">
      <Breadcrumbs crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Инсайты рынка' }]} />
      <MarketInsightsModule />
    </RequirePermission>
  )
}
