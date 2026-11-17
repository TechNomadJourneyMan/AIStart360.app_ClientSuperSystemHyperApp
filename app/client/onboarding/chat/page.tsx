export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { SurveyChat } from '@/components/onboarding/chat/SurveyChat'
import { surveyModeOffRedirect } from '@/lib/survey/modes'
import { getSurveyModes } from '@/lib/survey/modes-server'

/**
 * /client/onboarding/chat — «Диагностическая беседа с ИИ» (spec 2026-10-23 §8,
 * survey Ф4): the questionnaire helper asks the questions of the registry,
 * explains them and writes only what the client confirms with «Записать».
 * The AI helper switched off in GIGA (survey_chat_enabled, R4-B4) → the full
 * questionnaire with a notice, not a 404.
 */
export default async function SurveyChatPage() {
  const off = surveyModeOffRedirect('chat', await getSurveyModes())
  if (off) redirect(off)
  return <SurveyChat />
}
