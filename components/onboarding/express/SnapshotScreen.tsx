'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSurveyAnswers } from '@/hooks/useSurveyAnswers'
import { track } from '@/lib/events/client'
import { recommendedBlocks } from '@/lib/survey/blocks'
import { enabledSurveyModes } from '@/lib/survey/modes'
import { readSnapshotPointA, type PointAStateSlice, type SnapshotPointA } from '@/lib/survey/snapshot'
import { BusinessSnapshot } from './BusinessSnapshot'
import { ModeTwoChrome } from './ModeTwoChrome'

const POLL_MS = 5000
const POLL_LIMIT_MS = 3 * 60_000
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
  const [pointA, setPointA] = useState<SnapshotPointA>({ state: 'loading' })
  const tracked = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const started = Date.now()
    const load = async () => {
      const json = await fetch('/api/v1/point-a/state', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).catch(() => null)
      if (cancelled) return
      const data = (json?.ok ? json.data : null) as PointAStateSlice | null
      const timedOut = Date.now() - started > POLL_LIMIT_MS
      const { view, poll } = readSnapshotPointA(data, timedOut ? null : fresh)
      setPointA(view)
      if (!tracked.current && view.state !== 'loading' && (view.state !== 'pending' || timedOut)) {
        tracked.current = true
        track('SURVEY_SNAPSHOT_VIEWED', { metadata: { point_a_ready: view.state === 'ready' } })
      }
      if (poll && !timedOut) timer = setTimeout(() => void load(), POLL_MS)
    }
    void load()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [fresh])

  const recommended = useMemo(
    () => recommendedBlocks(survey.answers, pointA.state === 'ready' && pointA.snapshot ? { blocks: pointA.snapshot.blocks.map((b) => ({ key: b.key, weight: b.weight ?? 0, status: b.status, coverage: b.coverage ?? 0, informational: b.informational })), uploadChecklist: pointA.snapshot.uploadChecklist } : null),
    [survey.answers, pointA],
  )

  return (
    <ModeTwoChrome survey={survey} current="snapshot">
      <BusinessSnapshot answers={survey.answers} pointA={pointA} recommended={recommended} chatEnabled={CHAT_ENABLED} />
    </ModeTwoChrome>
  )
}
