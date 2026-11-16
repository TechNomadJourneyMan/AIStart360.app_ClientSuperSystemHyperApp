'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSurveyAnswers } from '@/hooks/useSurveyAnswers'
import { track } from '@/lib/events/client'
import { recommendedBlocks } from '@/lib/survey/blocks'
import { recommendationInput } from '@/lib/survey/snapshot'
import { useSurveyModes } from '@/components/onboarding/modes/SurveyModesContext'
import { BusinessSnapshot } from './BusinessSnapshot'
import { ModeTwoChrome } from './ModeTwoChrome'
import { usePointAView } from './usePointAView'

/**
 * «Снимок бизнеса» page: numbers and calculations at once (in the browser),
 * the Point A card when the recalculation is done (GET /api/v1/point-a/state,
 * polled while it runs; `?fresh=<ms>` — «Готово» was just pressed).
 */
export function SnapshotScreen() {
  const survey = useSurveyAnswers('express')
  // «Продолжить в беседе» only while the chat is on in GIGA (server → SurveyModesContext, R4-B4).
  const chatEnabled = useSurveyModes().enabled.includes('chat')
  const params = useSearchParams()
  const fresh = Number(params.get('fresh')) || null
  const pointA = usePointAView(fresh, (view) => track('SURVEY_SNAPSHOT_VIEWED', { metadata: { point_a_ready: view.state === 'ready' } }))

  const recommended = useMemo(
    () => recommendedBlocks(survey.answers, recommendationInput(pointA)),
    [survey.answers, pointA],
  )

  return (
    <ModeTwoChrome survey={survey} current="snapshot">
      <BusinessSnapshot answers={survey.answers} pointA={pointA} recommended={recommended} chatEnabled={chatEnabled} />
    </ModeTwoChrome>
  )
}
