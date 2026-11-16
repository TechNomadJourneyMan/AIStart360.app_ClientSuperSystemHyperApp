'use client'

/**
 * components/point-b/PlanStatusBanner.tsx — where the owner's plan stands, above the tabs:
 * «План v{N} одобрен {дата}» (published), otherwise the honest state of the preparation (R3): the team works on a
 * draft / the plan is in review / the data is enough and the team will prepare it / data is missing (with links).
 * Nothing while the state is unknown — never «эксперт готовит», when nobody does. Project tokens only.
 */
import { CARD, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import PlanPrepNotice from './PlanPrepNotice'
import type { PlanPrepState } from './planPrep'
import { fmtLongDate, type PlanStatus, type PlanVersionInfo } from './planController'

export default function PlanStatusBanner({ status, version, prep = null }: { status: PlanStatus; version: PlanVersionInfo | null; prep?: PlanPrepState | null }) {
  if (status !== 'published') return <PlanPrepNotice prep={prep} area="banner" compact />

  const date = fmtLongDate(version?.approvedAt ?? null)
  return (
    <section aria-label="Статус плана" className={cn(CARD, 'flex items-start gap-3 !p-3 sm:!p-4')}>
      <Icon name="verified" className="mt-0.5 text-xl text-primary" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-on-surface">
          {version ? `План v${version.number} одобрен${date ? ` ${date}` : ''}` : 'План одобрен'}
        </p>
        {version?.authorName && <p className="mt-0.5 text-xs text-on-surface-variant">Подготовил: {version.authorName}</p>}
      </div>
    </section>
  )
}
