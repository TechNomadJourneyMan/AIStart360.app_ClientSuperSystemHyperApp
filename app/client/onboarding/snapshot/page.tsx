export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { SnapshotScreen } from '@/components/onboarding/express/SnapshotScreen'
import { surveyModeOffRedirect } from '@/lib/survey/modes'
import { getSurveyModes } from '@/lib/survey/modes-server'

/**
 * «Снимок бизнеса» after the express flow (spec 2026-10-23 §7.3) — a screen of
 * «Экспресс + блоки»: switched off in GIGA (R4-B4) → the full questionnaire with a notice.
 */
export default async function SurveySnapshotPage() {
  const off = surveyModeOffRedirect('express', await getSurveyModes())
  if (off) redirect(off)
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0c0e14]" />}>
      <SnapshotScreen />
    </Suspense>
  )
}
