'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSurveyAnswers } from '@/hooks/useSurveyAnswers'
import { track } from '@/lib/events/client'
import { recommendedBlocks } from '@/lib/survey/blocks'
import { enabledSurveyModes } from '@/lib/survey/modes'
import { recommendationInput } from '@/lib/survey/snapshot'
import { BusinessSnapshot } from './BusinessSnapshot'
import { ModeTwoChrome } from './ModeTwoChrome'
import { usePointAView } from './usePointAView'

const CHAT_ENABLED = enabledSurveyModes().includes('chat')

/**
 * «Снимок бизнеса» page: numbers and calculations at once (in the browser),
 * the Point A card when the recalculation is done (GET /api/v1/point-a/state,
 * polled while it runs; `?fresh=<ms>` — «Готово» was just pressed).
 */
export function SnapshotScreen() {
  const survey = useSurveyAnswers('express')
  const params = useSearchParams()
  const fresh = Number(params.get('fresh')) || null
  const pointA = usePointAView(fresh, (view) => track('SURVEY_SNAPSHOT_VIEWED', { metadata: { point_a_ready: view.state === 'ready' } }))

  const recommended = useMemo(
    () => recommendedBlocks(survey.answers, recommendationInput(pointA)),
    [survey.answers, pointA],
  )

  return (
    <ModeTwoChrome survey={survey} current="snapshot">
      <BusinessSnapshot answers={survey.answers} pointA={pointA} recommended={recommended} chatEnabled={CHAT_ENABLED} />
    </ModeTwoChrome>
  )
}
