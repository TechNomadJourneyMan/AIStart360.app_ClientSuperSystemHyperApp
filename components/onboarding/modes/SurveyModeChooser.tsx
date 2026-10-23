'use client'

import { SURVEY_MODE_INFO, SURVEY_MODE_ORDER, type SurveyMode } from '@/lib/survey/modes'

/**
 * «Как удобнее заполнить анкету?» (spec 2026-10-23 §5.2): three cards — the
 * full questionnaire (the main one, PO §18.3), express + blocks, the AI chat —
 * with time estimates. A mode that is not available yet is shown as «Скоро».
 */
export function SurveyModeChooser({ enabled, recommended, busy = null, onChoose }: {
  enabled: readonly SurveyMode[]
  recommended: SurveyMode
  /** The mode being saved (its card shows a spinner). */
  busy?: SurveyMode | null
  onChoose: (mode: SurveyMode) => void
}) {
  return (
    <section aria-labelledby="survey-mode-title" className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/60">Анкета</p>
      <h1 id="survey-mode-title" className="mt-1 text-2xl font-bold text-on-surface">Как вам удобнее заполнить анкету?</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
        Вопросы и ответы одни и те же — меняется только способ. По вашим ответам мы построим Точку А и план роста.
      </p>
      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {SURVEY_MODE_ORDER.map((mode) => {
          const info = SURVEY_MODE_INFO[mode]
          const on = enabled.includes(mode)
          const rec = on && mode === recommended
          return (
            <li key={mode}>
              <button
                type="button"
                disabled={!on || busy !== null}
                aria-describedby={`survey-mode-${mode}-sub`}
                onClick={() => on && onChoose(mode)}
                className={`group flex h-full w-full flex-col rounded-2xl border p-5 text-left transition-colors ${
                  on ? 'border-white/[0.08] bg-surface-container-low hover:border-primary/40 hover:bg-primary/[0.04]' : 'cursor-not-allowed border-white/[0.04] bg-surface-container-lowest opacity-70'
                } ${rec ? 'border-primary/40' : ''}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                    <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">{info.icon}</span>
                  </span>
                  {rec && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">Рекомендуем</span>}
                  {!on && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">Скоро</span>}
                </span>
                <span className="mt-4 text-base font-bold text-on-surface">{info.title}</span>
                <span id={`survey-mode-${mode}-sub`} className="mt-1 flex-1 text-xs leading-relaxed text-on-surface-variant">{info.subtitle}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-on-surface">
                  <span className="material-symbols-outlined text-[15px] text-primary/70" aria-hidden="true">schedule</span>
                  {info.time}
                </span>
                {busy === mode && <span className="mt-2 text-[11px] text-primary">Открываем…</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-5 text-xs text-on-surface-variant">Способ можно сменить в любой момент — ответы сохранятся.</p>
    </section>
  )
}
