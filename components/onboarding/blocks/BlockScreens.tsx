'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import DocumentSuggestions from '@/components/onboarding/DocumentSuggestions'
import { ModeTwoChrome } from '@/components/onboarding/express/ModeTwoChrome'
import { usePointAView } from '@/components/onboarding/express/usePointAView'
import { useSurveyAnswers } from '@/hooks/useSurveyAnswers'
import { track } from '@/lib/events/client'
import { blockV4Impact, nextBlock, recommendedBlocks } from '@/lib/survey/blocks'
import { surveyBlock } from '@/lib/survey/questions'
import { recommendationInput } from '@/lib/survey/snapshot'
import { BlockList } from './BlockList'
import { BlockPage } from './BlockPage'

/** /client/onboarding/blocks — the list. */
export function BlocksListScreen() {
  const survey = useSurveyAnswers('express')
  const pointA = usePointAView(null)
  const recommended = useMemo(() => recommendedBlocks(survey.answers, recommendationInput(pointA)), [survey.answers, pointA])
  return (
    <ModeTwoChrome survey={survey} current="blocks">
      <BlockList answers={survey.answers} recommended={recommended} />
    </ModeTwoChrome>
  )
}

/** /client/onboarding/blocks/[block] — one block, saved with the path «express». */
export function BlockScreen({ id }: { id: string }) {
  const survey = useSurveyAnswers('express')
  const router = useRouter()
  const block = surveyBlock(id)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const pointA = usePointAView(savedAt)

  useEffect(() => { if (block) track('SURVEY_BLOCK_OPENED', { metadata: { block: block.id } }) }, [block])

  if (!block) {
    return (
      <ModeTwoChrome survey={survey} current="blocks">
        <p className="text-sm text-on-surface-variant">Такого блока нет. <a href="/client/onboarding/blocks" className="text-primary hover:underline">Все блоки</a></p>
      </ModeTwoChrome>
    )
  }
  const next = nextBlock(block.id, survey.answers)
  const impact = pointA.snapshot ? blockV4Impact(block, pointA.snapshot.blocks) : pointA.state === 'none' ? [] : null

  const save = async (): Promise<boolean> => {
    setSaving(true)
    const r = await survey.save()
    setSaving(false)
    if (r.ok) setSavedAt(Date.now())
    return r.ok
  }

  return (
    <ModeTwoChrome survey={survey} current="blocks">
      {!survey.loaded ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/[0.06] p-10" aria-busy="true">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <DocumentSuggestions step={1} keys={block.keys} answers={survey.answers} onApply={(k, v) => survey.change(k, v, 'document')} />
          <BlockPage
            block={block}
            answers={survey.answers}
            onChange={(k, v) => survey.change(k, v)}
            onSave={() => void save()}
            next={next}
            onNext={() => { void save().then((ok) => { if (ok && next) { router.push(`/client/onboarding/blocks/${next.id}`); window.scrollTo({ top: 0 }) } }) }}
            saving={saving}
            impact={impact}
            recalculating={pointA.state === 'pending'}
            fieldIssue={survey.fieldIssue}
          />
        </>
      )}
    </ModeTwoChrome>
  )
}
