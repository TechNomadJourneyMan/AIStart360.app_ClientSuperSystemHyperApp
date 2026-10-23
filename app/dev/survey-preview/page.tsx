// Dev-only preview of the client questionnaire («Анкета») on fixture data — the
// real step forms inside the wizard's chrome, no database, no auth, no network.
// For visual audits and screenshots. 404 in production, like /dev/point-b-preview.
//   ?step=1..12 | review          — the open step (default 1); «review» = the check screen before sending
//   ?variant=empty | half | filled | ai | authors | unknown
//       empty   — a new owner, nothing answered
//       half    — what a typical owner leaves after one sitting (step 1, goals, a few numbers)
//       filled  — every question answered
//       ai      — half-filled + «Нашли в ваших документах» chips on steps 1, 5, 7, 9
//       authors — filled, with the author line under every field (вы / эксперт / админ / ИИ; none when unknown)
//       unknown — half-filled + «Не знаю» and «примерно» answers (steps 1, 5, 7, 9), blind spots on «review»
//   ?view=answers [&as=staff]   — «Мои ответы» (survey Ф1) on the variant's answers; as=staff — the GIGA / expert view
//   ?view=chooser               — the three-mode chooser and the one-time banner (survey Ф1)
//   ?mode=chat [&as=staff | &helper=1] — the AI chat on a recorded scenario, no model, no network (survey Ф4);
//                                 as=staff — the expert's transcript; helper=1 — the field «Помощник»
//   ?mode=express [&screen=N] [&phone=1] — the express screens (survey Ф2); phone=1: one question per page on hard screens
//   ?mode=snapshot              — «Снимок бизнеса» on the variant's express answers, Point A = the v4 engine on them
//   ?mode=blocks [&block=bN]    — the deepening blocks (list / one block)
// Edits, the answer editor (click a text field) and «Принять» work in memory only.
// Steps 1, 4, 5, 7, 8, 9, 10 show «Приблизительный расчёт по вашим цифрам» under the numeric
// fields (lib/survey/calcs, components/survey/FieldCalc): ready in «filled» / «half», «≈ … (диапазон …)»
// and «укажите …» in «unknown». They recompute in memory as you edit.
import { notFound } from 'next/navigation'
import { TOTAL_STEPS } from '@/components/onboarding/constants/step-config'
import SurveyPreviewClient from './SurveyPreviewClient'
import { isSurveyPreviewVariant } from './fixture'
import { AnswersPreview, ChooserPreview } from './PreviewViews'
import { ChatPreview } from './ChatPreview'
import { ModeTwoPreview } from './ModeTwoPreview'
import { previewPointA } from './point-a'

export const dynamic = 'force-dynamic'

/** The check screen after step 12 (as in the wizard). */
const REVIEW_STEP = TOTAL_STEPS + 1

function parseStep(raw: string | undefined): number {
  if (raw === 'review') return REVIEW_STEP
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_STEPS ? n : 1
}

export default function SurveyPreviewPage({ searchParams }: { searchParams?: { step?: string; variant?: string; view?: string; as?: string; mode?: string; helper?: string; screen?: string; block?: string; phone?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const variant = isSurveyPreviewVariant(searchParams?.variant) ? searchParams.variant : 'filled'
  if (searchParams?.view === 'answers') return <AnswersPreview key={`${variant}-${searchParams.as}`} variant={variant} staff={searchParams.as === 'staff'} />
  if (searchParams?.view === 'chooser') return <ChooserPreview />
  if (searchParams?.mode === 'chat') return <ChatPreview staff={searchParams.as === 'staff'} helper={searchParams.helper === '1'} />
  const mode = searchParams?.mode
  if (mode === 'express' || mode === 'snapshot' || mode === 'blocks') {
    return <ModeTwoPreview key={`${mode}-${variant}-${searchParams?.screen}-${searchParams?.block}-${searchParams?.phone}`} view={mode} variant={variant} screen={Number(searchParams?.screen) || 1} block={searchParams?.block} phone={searchParams?.phone === '1'} pointA={previewPointA(variant, mode === 'snapshot')} />
  }
  const step = parseStep(searchParams?.step)
  // A new key per variant / step: the in-memory answers start over.
  return <SurveyPreviewClient key={`${variant}-${step}`} variant={variant} step={step} />
}
