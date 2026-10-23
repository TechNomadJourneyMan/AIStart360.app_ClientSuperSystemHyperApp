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
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { isApproxAnswer, isUnknownAnswer } from '@/lib/survey/answer-value'
import { blockV4Impact, nextBlock, recommendedBlocks } from '@/lib/survey/blocks'
import { expressPages } from '@/lib/survey/express'
import { EXPRESS_SCREENS, surveyBlock } from '@/lib/survey/questions'
import { recommendationInput, type SnapshotPointA } from '@/lib/survey/snapshot'
import { previewAnswers, type SurveyPreviewVariant } from './fixture'

export type ModeTwoView = 'express' | 'snapshot' | 'blocks'

const EXPRESS_KEYS = new Set(EXPRESS_SCREENS.flatMap((s) => s.keys))

/** Point A v4 on the answers as the snapshot would compute it (marks → stored values). */
function previewPointA(answers: Record<string, unknown>): SnapshotPointA {
  const flat = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, isUnknownAnswer(v) ? null : isApproxAnswer(v) ? v.value : v]))
  if (Object.keys(flat).length === 0) return { state: 'none' }
  const v4 = calculatePointAV4({ answers: flat, blocks: effectiveBlocks(DEFAULT_TEMPLATE) })
  return { state: 'ready', snapshot: { overall: v4.overall, confidence: v4.confidence, blocks: v4.blocks, uploadChecklist: v4.upload_checklist } }
}

export function ModeTwoPreview({ view, variant, screen, block, phone }: { view: ModeTwoView; variant: SurveyPreviewVariant; screen?: number; block?: string; phone?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const all = previewAnswers(variant)
    return view === 'snapshot' ? Object.fromEntries(Object.entries(all).filter(([k]) => EXPRESS_KEYS.has(k))) : all
  })
  const change = (k: string, v: unknown) => setAnswers((a) => ({ ...a, [k]: v }))
  const pages = useMemo(() => expressPages({ oneQuestionPerHardScreen: phone }), [phone])
  const [index, setIndex] = useState(() => Math.max(0, pages.findIndex((p) => p.screen === (screen ?? 1))))
  const pointA = useMemo(() => previewPointA(answers), [answers])
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
