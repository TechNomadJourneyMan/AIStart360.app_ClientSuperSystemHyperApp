'use client'

/**
 * «Минимум для Точки А» on the Point A page (R3-PA, П5): the RULE of the
 * official score, not a list of questions — what is left before the score
 * («до оценки осталось N пунктов: …») and the way there: fill the blocks,
 * then «Отправить анкету — получить оценку» (the questionnaire's review step).
 * Shown while there is no score.
 */
import Link from 'next/link'
import type { ScorePath } from '@/lib/point-a/v4/score-path'
import { scorePathSummary, scoreRuleText } from '@/lib/point-a/v4/score-path'
import { BTN_GHOST, BTN_PRIMARY, CARD, Icon, SectionTitle } from './ui'
import { cn } from '@/lib/utils'

/** The questionnaire's final step (app/client/onboarding/page.tsx reads ?step=review). */
export const SEND_SURVEY_HREF = '/client/onboarding?step=review'
export const SEND_SURVEY_LABEL = 'Отправить анкету — получить оценку'

export function ScorePathCard({ path, viewerIsOwner, showNeeds = true }: { path: ScorePath; viewerIsOwner: boolean; showNeeds?: boolean }) {
  const summary = scorePathSummary(path)
  if (!summary) return null
  return (
    <section className={cn(CARD, 'border-amber-300/20')} aria-labelledby="pa-minimum" data-score-path>
      <SectionTitle icon="flag"><span id="pa-minimum">Минимум для Точки А</span></SectionTitle>
      <p className="text-sm font-semibold text-on-surface" data-score-path-summary>{summary}</p>
      <p className="mt-1 text-[11px] text-on-surface-variant">Правило: {scoreRuleText(path)}. Блок получает балл, когда по нему есть хотя бы 40 % данных.</p>
      {path.toFill.length > 0 && (
        <ul className="mt-3 space-y-2">
          {path.toFill.map((b) => (
            <li key={b.key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-sm text-on-surface">
                «{b.title}» — ещё {b.items}{b.required ? <span className="ml-2 text-[10px] font-mono uppercase text-amber-200">обязательный</span> : null}
              </p>
              {showNeeds && b.needs.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-on-surface-variant">
                  {b.needs.slice(0, 4).map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {viewerIsOwner && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!path.surveySent && (
            <Link href={SEND_SURVEY_HREF} className={BTN_PRIMARY} data-send-survey>
              <Icon name="send" className="text-[16px]" />{SEND_SURVEY_LABEL}
            </Link>
          )}
          {!path.dataEnough && (
            <Link href="/client/onboarding" className={BTN_GHOST}>
              <Icon name="edit_note" className="text-[16px]" />Дозаполнить анкету
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
