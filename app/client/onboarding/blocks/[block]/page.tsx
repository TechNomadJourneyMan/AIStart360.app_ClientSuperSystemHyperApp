export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { BlockScreen } from '@/components/onboarding/blocks/BlockScreens'
import { surveyModeOffRedirect } from '@/lib/survey/modes'
import { getSurveyModes } from '@/lib/survey/modes-server'

/**
 * One deepening block (spec 2026-10-23 §7.4): /client/onboarding/blocks/b1 … b15.
 * The express mode switched off in GIGA (R4-B4) → the full questionnaire with a notice.
 */
export default async function SurveyBlockPage({ params }: { params: { block: string } }) {
  const off = surveyModeOffRedirect('express', await getSurveyModes())
  if (off) redirect(off)
  return <BlockScreen key={params.block} id={params.block} />
}
