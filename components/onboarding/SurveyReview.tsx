'use client'

import { STEPS } from '@/components/onboarding/constants/step-config'
import type { StepFill } from '@/lib/survey/progress'

interface Props {
  fill: ReadonlyArray<StepFill>
  percent: number
  submitting: boolean
  hasUnsaved: boolean
  onEditStep: (step: number) => void
  onBack: () => void
  onSubmit: () => void
}

/** Final confirmation before the survey is submitted: what is filled, what is not. */
export default function SurveyReview({ fill, percent, submitting, hasUnsaved, onEditStep, onBack, onSubmit }: Props) {
  const missing = fill.filter((s) => !s.started)

  return (
    <div className="pb-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <span className="material-symbols-outlined text-lg text-primary">fact_check</span>
        </div>
        <div>
          <p className="text-[10px] font-mono text-primary/60 uppercase tracking-[0.15em]">Проверка</p>
          <h1 className="text-xl font-bold text-on-surface">Проверьте анкету перед отправкой</h1>
        </div>
      </div>

      <div className={`mb-5 rounded-xl border px-4 py-3 ${missing.length ? 'border-amber-400/25 bg-amber-400/[0.06]' : 'border-primary/20 bg-primary/[0.06]'}`}>
        <p className="text-sm font-semibold text-on-surface">
          {missing.length
            ? `Заполнено ${percent}% — без ответов ${missing.length} из ${fill.length} разделов`
            : 'Все разделы заполнены'}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant leading-snug">
          {missing.length
            ? 'Отправить можно и так: диагностика построится по тому, что есть, но будет менее точной. Пустые разделы можно дозаполнить позже.'
            : 'После отправки мы сформируем ваш профиль и Точку А. Ответы можно будет изменить в любой момент.'}
        </p>
      </div>

      <ul className="mb-6 grid gap-2 sm:grid-cols-2">
        {fill.map((s) => {
          const cfg = STEPS[s.step - 1]
          const pct = s.total ? Math.round((s.filled / s.total) * 100) : 0
          return (
            <li key={s.step}>
              <button
                type="button"
                onClick={() => onEditStep(s.step)}
                disabled={submitting}
                className="group w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-base ${s.started ? 'text-primary' : 'text-amber-300/80'}`}>
                    {s.started ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">
                    {s.step}. {cfg?.title}
                  </span>
                  <span className="text-[10px] font-mono text-on-surface-variant">{s.filled}/{s.total}</span>
                  <span className="material-symbols-outlined text-sm text-on-surface-variant/50 group-hover:text-primary">edit</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className={`h-full rounded-full ${s.started ? 'bg-primary/70' : 'bg-transparent'}`} style={{ width: `${pct}%` }} />
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm hover:bg-white/[0.04] transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Назад
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm hover:scale-[0.99] transition-all disabled:opacity-50"
        >
          {submitting ? (
            <><span className="material-symbols-outlined text-base animate-spin">progress_activity</span> Отправляем…</>
          ) : (
            <><span className="material-symbols-outlined text-base">rocket_launch</span> Отправить анкету</>
          )}
        </button>
      </div>
      {hasUnsaved && !submitting && (
        <p className="mt-2 text-center text-[10px] text-on-surface-variant/70">Несохранённые изменения уйдут на сервер вместе с отправкой.</p>
      )}
    </div>
  )
}
