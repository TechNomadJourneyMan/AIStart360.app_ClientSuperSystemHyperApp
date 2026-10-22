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
// Edits, the answer editor (click a text field) and «Принять» work in memory only.
import { notFound } from 'next/navigation'
import { TOTAL_STEPS } from '@/components/onboarding/constants/step-config'
import SurveyPreviewClient from './SurveyPreviewClient'
import { isSurveyPreviewVariant } from './fixture'

export const dynamic = 'force-dynamic'

/** The check screen after step 12 (as in the wizard). */
const REVIEW_STEP = TOTAL_STEPS + 1

function parseStep(raw: string | undefined): number {
  if (raw === 'review') return REVIEW_STEP
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_STEPS ? n : 1
}

export default function SurveyPreviewPage({ searchParams }: { searchParams?: { step?: string; variant?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const variant = isSurveyPreviewVariant(searchParams?.variant) ? searchParams.variant : 'filled'
  const step = parseStep(searchParams?.step)
  // A new key per variant / step: the in-memory answers start over.
  return <SurveyPreviewClient key={`${variant}-${step}`} variant={variant} step={step} />
}
