'use client'

import { SURVEY_MODE_INFO, type SurveyMode } from '@/lib/survey/modes'

const PHRASE: Record<SurveyMode, string> = { full: 'полная анкета', express: 'быстрый старт', chat: 'беседа с ИИ-помощником' }

/**
 * One-time banner for clients who started the full questionnaire before the
 * new modes existed (spec §5.2): they stay in the full questionnaire, the
 * banner only tells them there are other ways.
 */
export function SurveyModesBanner({ enabled, onTry, onDismiss }: {
  enabled: readonly SurveyMode[]
  onTry: (mode: SurveyMode) => void
  onDismiss: () => void
}) {
  const others = enabled.filter((m) => m !== 'full')
  if (!others.length) return null
  return (
    <div role="region" aria-label="Новые способы заполнить анкету" className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
      <span className="material-symbols-outlined text-primary" aria-hidden="true">auto_awesome</span>
      <p className="min-w-0 flex-1 text-sm text-on-surface">
        Новые способы заполнить: {others.map((m) => PHRASE[m]).join(' и ')}. Ваши ответы сохранятся.
      </p>
      <div className="flex gap-2">
        {others.map((m) => (
          <button key={m} type="button" onClick={() => onTry(m)} className="min-h-[36px] rounded-lg bg-primary/15 px-3 text-xs font-medium text-primary">
            {SURVEY_MODE_INFO[m].short}
          </button>
        ))}
        <button type="button" onClick={onDismiss} className="min-h-[36px] rounded-lg px-3 text-xs text-on-surface-variant hover:text-on-surface">Понятно</button>
      </div>
    </div>
  )
}
