'use client'

import { SurveyChat } from '@/components/onboarding/chat/SurveyChat'

/**
 * /client/onboarding/chat — «Диагностическая беседа с ИИ» (spec 2026-10-23 §8,
 * survey Ф4): the questionnaire helper asks the questions of the registry,
 * explains them and writes only what the client confirms with «Записать».
 */
export default function SurveyChatPage() {
  return <SurveyChat />
}
