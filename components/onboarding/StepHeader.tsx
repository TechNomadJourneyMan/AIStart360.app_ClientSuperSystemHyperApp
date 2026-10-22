'use client'

import type { StepConfig } from '@/components/onboarding/constants/step-config'
import { stepTimeHint, type StepFill } from '@/lib/survey/progress'

/**
 * The header of a questionnaire step: number, title, time («~4 мин» /
 * «осталось ~2 мин»), the fill-in hint and «Зачем спрашиваем → что получите»
 * (survey audit 2026-10-22, MVP item 6). Shared by the wizard and the dev preview.
 */
export default function StepHeader({ step, config, fill }: { step: number; config: StepConfig | undefined; fill?: StepFill }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">{config?.icon ?? 'description'}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-mono text-primary/60 uppercase tracking-[0.15em]">
            Шаг {step}{config ? <span className="normal-case tracking-normal text-on-surface-variant/70"> · {stepTimeHint(fill, config.minutes)}</span> : null}
          </p>
          <h1 className="text-xl font-bold text-on-surface">{config?.title ?? `Шаг ${step}`}</h1>
        </div>
      </div>

      {config && (
        <div className="rounded-lg border border-primary/15 bg-primary/[0.05] px-3 py-2 space-y-1.5">
          <p className="flex items-start gap-2 text-xs text-on-surface-variant leading-snug">
            <span className="material-symbols-outlined text-sm text-primary/70 mt-0.5 flex-shrink-0" aria-hidden="true">lightbulb</span>
            <span>{config.hint}</span>
          </p>
          <p className="flex items-start gap-2 text-xs text-on-surface-variant leading-snug">
            <span className="material-symbols-outlined text-sm text-primary/70 mt-0.5 flex-shrink-0" aria-hidden="true">help</span>
            <span>
              <b className="font-semibold text-on-surface">Зачем спрашиваем:</b> {config.why.ask}
              <span aria-hidden="true"> → </span>
              <b className="font-semibold text-on-surface">что получите:</b> {config.why.get}.
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
