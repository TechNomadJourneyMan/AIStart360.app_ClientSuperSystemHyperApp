'use client'

/**
 * components/point-b/DataGapBanner.tsx — «Данных мало»: what the calculation lacks, what each
 * missing input would unlock, and where to add it (plan Phase 2 Task 8, spec §7.3). The
 * actions are links to the owner's existing pages: the survey, the documents upload and the
 * messages with the expert. Project tokens only.
 */
import Link from 'next/link'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import type { MissingInput } from '@/lib/point-b/model/types'
import { GAP_ACTIONS, MISSING_LEVEL_LABEL } from './overviewModel'

export function GapActionLinks({ actions }: { actions: MissingInput['actions'] }) {
  if (!actions.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((a) => (
        <Link key={a} href={GAP_ACTIONS[a].href} className={a === 'survey' ? BTN_PRIMARY : BTN_GHOST}>
          {GAP_ACTIONS[a].label}
        </Link>
      ))}
    </div>
  )
}

export default function DataGapBanner({
  missing,
  title = 'Данных мало — расчёт неполный',
  className,
}: {
  missing: MissingInput[]
  title?: string
  className?: string
}) {
  if (!missing.length) return null
  return (
    <section aria-label="Каких данных не хватает" className={cn(CARD, 'border-tertiary-fixed-dim/30', className)}>
      <div className="flex items-start gap-3">
        <Icon name="database" className="mt-0.5 text-xl text-tertiary-fixed-dim" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            Мы не подставляем выдуманные цифры. Добавьте данные ниже — и расчёт станет точнее.
          </p>
          <ul className="mt-3 space-y-3">
            {missing.map((m, i) => (
              <li key={`${m.key}-${i}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-on-surface">{m.label}</p>
                  <span className={cn(CHIP, 'bg-white/[0.06] text-on-surface-variant')}>{MISSING_LEVEL_LABEL[m.level]}</span>
                </div>
                {m.unlocks && <p className="mt-0.5 text-xs text-on-surface-variant">Откроет: {m.unlocks}</p>}
                <GapActionLinks actions={m.actions} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
