'use client'

import { SURVEY_MODE_INFO, surveyModeCardOrder, type SurveyMode } from '@/lib/survey/modes'

/**
 * «Как удобнее заполнить анкету?» (spec 2026-10-23 §5.2): the cards of the
 * modes switched on in GIGA — the full questionnaire, express + blocks, the AI
 * chat — with time estimates. R4-B4 (PO, Round 4): the default mode of the
 * setting (express unless changed) comes first and is marked «Рекомендуем»;
 * a switched-off mode is not shown at all (it is not «coming soon»).
 */
export function SurveyModeChooser({ enabled, recommended, busy = null, onChoose }: {
  enabled: readonly SurveyMode[]
  recommended: SurveyMode
  /** The mode being saved (its card shows a spinner). */
  busy?: SurveyMode | null
  onChoose: (mode: SurveyMode) => void
}) {
  const cards = surveyModeCardOrder(enabled, recommended)
  return (
    <section aria-labelledby="survey-mode-title" className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/60">Анкета</p>
      <h1 id="survey-mode-title" className="mt-1 text-2xl font-bold text-on-surface">Как вам удобнее заполнить анкету?</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
        Вопросы и ответы одни и те же — меняется только способ. По вашим ответам мы построим Точку А и план роста.
      </p>
      <ul className={`mt-6 grid gap-4 ${cards.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {cards.map((mode) => {
          const info = SURVEY_MODE_INFO[mode]
          const rec = mode === recommended
          return (
            <li key={mode} data-mode={mode}>
              <button
                type="button"
                disabled={busy !== null}
                aria-describedby={`survey-mode-${mode}-sub`}
                onClick={() => onChoose(mode)}
                className={`group flex h-full w-full flex-col rounded-2xl border bg-surface-container-low p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.04] ${
                  rec ? 'border-primary/40' : 'border-white/[0.08]'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                    <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">{info.icon}</span>
                  </span>
                  {/* R4-B4: one mark — the mode the platform offers first (the GIGA setting). The full
                      questionnaire stays the one that counts as «анкета заполнена» (its subtitle says so). */}
                  {rec && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">Рекомендуем</span>}
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
      <p className="mt-5 text-xs text-on-surface-variant">Способ можно сменить в любой момент — ответы сохранятся. Полная анкета доступна всегда.</p>
    </section>
  )
}
