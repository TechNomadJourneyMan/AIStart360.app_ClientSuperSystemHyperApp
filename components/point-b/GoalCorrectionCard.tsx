'use client'

/**
 * components/point-b/GoalCorrectionCard.tsx — the expert proposes to change the owner's
 * goal. The goal stays as it is until the owner answers: «Согласен» applies the proposal,
 * «Не согласен» sends the goal back to the expert. After the answer the card closes.
 */
import { useId } from 'react'
import { BTN_GHOST, BTN_PRIMARY, CARD, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { fmtGoalNumber, type GoalCorrection } from './planController'

export interface GoalCorrectionCardProps {
  correction: GoalCorrection
  busy: boolean
  error: string | null
  onRespond: (accept: boolean) => void
}

export default function GoalCorrectionCard({ correction: c, busy, error, onRespond }: GoalCorrectionCardProps) {
  const id = useId()
  return (
    <section aria-labelledby={`${id}-t`} className={cn(CARD, '!border-secondary/30 !p-3 sm:!p-4')}>
      <div className="flex items-start gap-3">
        <Icon name="rate_review" className="mt-0.5 text-xl text-secondary" />
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-t`} className="text-sm font-semibold text-on-surface">Эксперт предлагает изменить цель</h3>
          <p className="mt-1 text-sm text-on-surface">
            <span className="text-on-surface-variant">{c.metricLabel}: </span>
            <span className="tabular-nums">{fmtGoalNumber(c.from)} → {fmtGoalNumber(c.to)}</span>
          </p>
          {c.reason && <p className="mt-1 text-xs text-on-surface-variant">Причина: {c.reason}</p>}
          <p className="mt-1 text-[11px] text-on-surface-variant">Пока вы не ответите, цель остаётся прежней.</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => onRespond(true)}>Согласен</button>
            <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => onRespond(false)}>Не согласен</button>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-[1rem] text-xs">
            {busy && <span className="text-on-surface-variant">Отправляем ответ…</span>}
            {error && !busy && <span role="alert" className="text-error">{error}</span>}
          </p>
        </div>
      </div>
    </section>
  )
}
