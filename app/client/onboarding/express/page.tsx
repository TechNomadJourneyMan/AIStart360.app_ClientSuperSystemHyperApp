export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { ExpressFlow } from '@/components/onboarding/express/ExpressFlow'
import { surveyModeOffRedirect } from '@/lib/survey/modes'
import { getSurveyModes } from '@/lib/survey/modes-server'

/**
 * «Экспресс + блоки» — the 15 express screens (spec 2026-10-23 §7.1). Switched
 * off in GIGA (R4-B4) → the full questionnaire with a notice, not a 404.
 */
export default async function SurveyExpressPage() {
  const off = surveyModeOffRedirect('express', await getSurveyModes())
  if (off) redirect(off)
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0c0e14]" />}>
      <ExpressFlow />
    </Suspense>
  )
}
