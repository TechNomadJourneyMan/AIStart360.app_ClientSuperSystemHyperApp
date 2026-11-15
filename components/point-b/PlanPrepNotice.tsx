'use client'

/**
 * components/point-b/PlanPrepNotice.tsx — the honest «where is my plan» card (R3, S1 part): the banner above the tabs
 * and the empty state of the tabs that show the approved plan only. Wording: planPrep.ts. Project tokens only.
 */
import { CARD, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { GapActionLinks } from './DataGapBanner'
import { planPrepView, type PlanPrepArea, type PlanPrepState } from './planPrep'

export default function PlanPrepNotice({ prep, area, compact = false }: { prep: PlanPrepState | null | undefined; area: PlanPrepArea; compact?: boolean }) {
  const v = planPrepView(prep, area)
  if (!v) return null
  const Heading = compact ? 'p' : 'h2'
  return (
    <section aria-label="Статус плана" className={cn(CARD, compact && '!p-3 sm:!p-4', v.tone === 'action' && 'border-tertiary-fixed-dim/30')}>
      <div className="flex items-start gap-3">
        <Icon name={v.icon} className={cn('mt-0.5', compact ? 'text-xl' : 'text-2xl', v.tone === 'action' ? 'text-tertiary-fixed-dim' : 'text-secondary')} />
        <div className="min-w-0 flex-1">
          <Heading className={compact ? 'text-sm font-semibold text-on-surface' : 'font-headline text-lg font-bold text-on-surface'}>{v.title}</Heading>
          <p className={cn('mt-0.5 text-on-surface-variant', compact ? 'text-xs' : 'text-sm')}>{v.text}</p>
          {v.missing.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label="Каких данных не хватает для плана">
              {v.missing.map((m) => (
                <li key={m.key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="text-sm font-medium text-on-surface">{m.label}</p>
                  <GapActionLinks actions={m.actions} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
