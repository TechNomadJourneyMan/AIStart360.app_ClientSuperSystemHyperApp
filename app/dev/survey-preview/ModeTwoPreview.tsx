'use client'

// Dev preview of «Экспресс + блоки» (survey Ф2) on fixture data — no network,
// no database; edits stay in memory:
//   ?mode=express [&screen=N] [&phone=1] — the express screens (phone=1: one question per page on hard screens)
//   ?mode=snapshot                       — «Снимок бизнеса» on the variant's EXPRESS answers; Point A is the
//                                          real v4 engine on them (→ «Первичная · по быстрым данным»)
//   ?mode=blocks [&block=bN]             — the block list / one block
import { useMemo, useState } from 'react'
import { ExpressScreen } from '@/components/onboarding/express/ExpressScreen'
import { BusinessSnapshot } from '@/components/onboarding/express/BusinessSnapshot'
import { BlockList } from '@/components/onboarding/blocks/BlockList'
import { BlockPage } from '@/components/onboarding/blocks/BlockPage'
import SurveyProgressHeader from '@/components/onboarding/SurveyProgressHeader'
import { isApproxAnswer, isUnknownAnswer } from '@/lib/survey/answer-value'
import { blockV4Impact, nextBlock, recommendedBlocks } from '@/lib/survey/blocks'
import { expressPages } from '@/lib/survey/express'
import { EXPRESS_SCREENS, surveyBlock } from '@/lib/survey/questions'
import { recommendationInput, type SnapshotPointA } from '@/lib/survey/snapshot'
import { previewAnswers, type SurveyPreviewVariant } from './fixture'

export type ModeTwoView = 'express' | 'snapshot' | 'blocks'

// The v4 engine uses node:crypto — it runs on the server (./point-a.ts); the page passes its result in.
const EXPRESS_KEYS = new Set(EXPRESS_SCREENS.flatMap((s) => s.keys))

export function ModeTwoPreview({ view, variant, screen, block, phone, pointA }: { view: ModeTwoView; variant: SurveyPreviewVariant; screen?: number; block?: string; phone?: boolean; pointA: SnapshotPointA }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const all = previewAnswers(variant)
    return view === 'snapshot' ? Object.fromEntries(Object.entries(all).filter(([k]) => EXPRESS_KEYS.has(k))) : all
  })
  const change = (k: string, v: unknown) => setAnswers((a) => ({ ...a, [k]: v }))
  const pages = useMemo(() => expressPages({ oneQuestionPerHardScreen: phone }), [phone])
  const [index, setIndex] = useState(() => Math.max(0, pages.findIndex((p) => p.screen === (screen ?? 1))))
  const recommended = useMemo(() => recommendedBlocks(answers, recommendationInput(pointA)), [answers, pointA])
  const [done, setDone] = useState(false)

  let body: React.ReactNode
  if (view === 'express') {
    const page = pages[Math.min(index, pages.length - 1)]
    body = done ? (
      <p role="status" className="text-sm text-primary">Превью: «Готово» сохранит ответы, отправит событие и уведомление эксперту, пересчитает Точку А и откроет «Снимок» (?mode=snapshot).</p>
    ) : (
      <ExpressScreen key={page.index} page={page} answers={answers} onChange={change}
        onBack={page.index > 0 ? () => setIndex(page.index - 1) : undefined}
        onNext={() => setIndex(page.index + 1)} onSkip={() => setIndex(page.index + 1)} onFinish={() => setDone(true)}
        last={page.index === pages.length - 1} />
    )
  } else if (view === 'snapshot') {
    body = <BusinessSnapshot answers={answers} pointA={pointA} recommended={recommended} />
  } else {
    const b = block ? surveyBlock(block) : null
    body = b ? (
      <BlockPage block={b} answers={answers} onChange={change} onSave={() => undefined} next={nextBlock(b.id, answers)} onNext={() => undefined}
        impact={pointA.snapshot ? blockV4Impact(b, pointA.snapshot.blocks) : []} />
    ) : (
      <BlockList answers={answers} recommended={recommended} />
    )
  }
  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">
      <header className="border-b border-white/[0.06]">
        <SurveyProgressHeader answers={answers} />
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{body}</main>
    </div>
  )
}
