'use client'

import { Suspense } from 'react'
import { ExpressFlow } from '@/components/onboarding/express/ExpressFlow'

/** «Экспресс + блоки» — the 15 express screens (spec 2026-10-23 §7.1). */
export default function SurveyExpressPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0c0e14]" />}>
      <ExpressFlow />
    </Suspense>
  )
}
