'use client'

/**
 * components/point-b/PlanStatusBanner.tsx — where the owner's plan stands:
 * «Эксперт готовит план» (preparing), «План v{N} одобрен {дата}» (published), nothing
 * otherwise (no empty block). Project tokens only — the look is to be replaced by the
 * PO's design.
 */
import { CARD, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { fmtLongDate, type PlanStatus, type PlanVersionInfo } from './planController'

export default function PlanStatusBanner({ status, version }: { status: PlanStatus; version: PlanVersionInfo | null }) {
  if (status === 'none') return null

  if (status === 'preparing') {
    return (
      <section aria-label="Статус плана" className={cn(CARD, 'flex items-start gap-3 !p-3 sm:!p-4')}>
        <Icon name="hourglass_top" className="mt-0.5 text-xl text-secondary" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">Эксперт готовит план</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            Пока вы видите автоматический расчёт по вашим данным. План эксперта появится здесь после проверки и одобрения.
          </p>
        </div>
      </section>
    )
  }

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
