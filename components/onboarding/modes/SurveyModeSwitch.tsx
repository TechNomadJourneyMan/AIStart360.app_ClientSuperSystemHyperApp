'use client'

import Link from 'next/link'
import { SURVEY_MODE_INFO, type SurveyMode } from '@/lib/survey/modes'

/**
 * The switch in the header of every mode (spec §5.2): segments of the modes
 * a client can pick and «Мои ответы». With one mode only the link is shown.
 */
export function SurveyModeSwitch({ current, enabled, onSwitch, answersHref = '/client/onboarding/answers' }: {
  current: SurveyMode | 'answers'
  enabled: readonly SurveyMode[]
  onSwitch?: (mode: SurveyMode) => void
  answersHref?: string
}) {
  return (
    <nav aria-label="Способ заполнения анкеты" className="flex items-center gap-1 text-xs">
      {enabled.length > 1 && enabled.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={current === m}
          onClick={() => current !== m && onSwitch?.(m)}
          className={`min-h-[32px] rounded-lg px-2.5 ${current === m ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
        >
          {SURVEY_MODE_INFO[m].short}
        </button>
      ))}
      <Link
        href={answersHref}
        aria-current={current === 'answers' ? 'page' : undefined}
        aria-label="Мои ответы"
        title="Все ответы на одной странице: просмотр, поиск, правка"
        className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2.5 ${current === 'answers' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-primary'}`}
      >
        <span className="material-symbols-outlined text-[15px]" aria-hidden="true">fact_check</span>
        <span className="hidden sm:inline">Мои ответы</span>
      </Link>
    </nav>
  )
}
