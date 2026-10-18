'use client'

/**
 * components/point-b/CostOfGoalCard.tsx — «Цена достижения» on the overview (plan Ф3 Task 5, spec
 * §15.2): investments, time, the lowest cash and its month, the shortage of money and the liquidity
 * reserve for the pace in view. At level 1 it is a grey card with the progress of the finmodel
 * («заполнено N из M») and a way to fill it in. Always the PRELIMINARY automatic calculation.
 * Project tokens only — the PO will replace the design.
 */
import { CARD, CARD_TITLE, CHIP, BTN_PRIMARY, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { TONE_CLASS, type CostOfGoalView } from './overviewModel'

export default function CostOfGoalCard({ view, onFill }: { view: CostOfGoalView; onFill?: () => void }) {
  if (view.mode === 'locked') {
    const p = view.progress
    return (
      <section aria-labelledby="pb-cost-title" className={cn(CARD, 'border-dashed border-white/[0.1] bg-white/[0.02]')}>
        <div className="flex items-start gap-3">
          <Icon name="lock_clock" className="mt-0.5 text-2xl text-on-surface-variant/60" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="pb-cost-title" className="font-headline text-base font-bold text-on-surface">Цена достижения</h3>
              {p && p.total > 0 && <span className={cn(CHIP, 'bg-white/[0.06] text-on-surface-variant')}>Заполнено {p.filled} из {p.total}</span>}
            </div>
            <p className="mt-1 text-sm text-on-surface-variant">{view.lockedText}</p>
            {p && onFill && <button type="button" onClick={onFill} className={cn(BTN_PRIMARY, 'mt-3')}>Заполнить финмодель</button>}
          </div>
        </div>
      </section>
    )
  }
  return (
    <section aria-labelledby="pb-cost-title" className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="pb-cost-title" className="font-headline text-base font-bold text-on-surface">Цена достижения</h3>
        {view.scenarioLabel && <span className={cn(CHIP, 'bg-white/[0.06] text-on-surface-variant')}>Темп: {view.scenarioLabel}</span>}
      </div>
      {view.caveat && <p role="note" className={cn('mb-3 text-xs', TONE_CLASS.warn.text)}>{view.caveat}</p>}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {view.cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <dt className={CARD_TITLE}>{c.label}</dt>
            <dd className={cn('mt-1.5 font-headline text-lg font-bold', c.tone ? TONE_CLASS[c.tone].text : 'text-on-surface')}>{c.value}</dd>
            {c.note && <dd className="mt-0.5 text-xs text-on-surface-variant">{c.note}</dd>}
          </div>
        ))}
      </dl>
    </section>
  )
}
