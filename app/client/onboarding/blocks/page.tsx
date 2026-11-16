export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { BlocksListScreen } from '@/components/onboarding/blocks/BlockScreens'
import { surveyModeOffRedirect } from '@/lib/survey/modes'
import { getSurveyModes } from '@/lib/survey/modes-server'

/**
 * «Экспресс + блоки» — the 15 deepening blocks (spec 2026-10-23 §7.4). The
 * express mode switched off in GIGA (R4-B4) → the full questionnaire with a notice.
 */
export default async function SurveyBlocksPage() {
  const off = surveyModeOffRedirect('express', await getSurveyModes())
  if (off) redirect(off)
  return <BlocksListScreen />
}
