'use client'

/**
 * components/point-b/NextStepCard.tsx — «Следующий шаг» of the «Обзор» (plan Ф6a Task 7, spec §15.2): one card with
 * what to do now and a button to the right tab — the next action of the most important verified recommendation, or
 * the nearest open task of the strategy. Nothing to show → nothing is drawn. Project tokens only.
 */
import Link from 'next/link'
import { BTN_PRIMARY, CARD, CARD_TITLE, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { nextStepTarget, nextStepText, targetLabel, type PointBNextStep } from './recsModel'
import { useGoToTab } from './tabs/PointBTabs'

export default function NextStepCard({ step }: { step: PointBNextStep | null | undefined }) {
  const go = useGoToTab()
  if (!step) return null
  const target = nextStepTarget(step)
  const text = nextStepText(step)
  return (
    <section aria-labelledby="pb-next-step" className={cn(CARD, 'border-primary/25 bg-primary/[0.05]')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Icon name="flag" className="mt-0.5 text-2xl text-primary" />
          <div className="min-w-0">
            <p className={CARD_TITLE}>Следующий шаг</p>
            <h3 id="pb-next-step" className="mt-1 break-words font-headline text-base font-bold text-on-surface">{step.title}</h3>
            {text && <p className="mt-0.5 break-words text-sm text-on-surface-variant">{text}</p>}
            <p className="mt-1 text-[11px] text-on-surface-variant">
              {step.recId ? 'Из рекомендации, проверенной экспертом' : 'Ближайшая задача вашего плана'}
            </p>
          </div>
        </div>
        {'tab' in target ? (
          <button type="button" onClick={() => go(target.tab)} className={cn(BTN_PRIMARY, 'shrink-0 self-start sm:self-center')}>
            {targetLabel(target)}
            <Icon name="arrow_forward" className="text-sm" />
          </button>
        ) : (
          <Link href={target.href} className={cn(BTN_PRIMARY, 'shrink-0 self-start sm:self-center')}>
            Открыть
            <Icon name="arrow_forward" className="text-sm" />
          </Link>
        )}
      </div>
    </section>
  )
}
