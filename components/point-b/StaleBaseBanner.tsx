'use client'

/**
 * components/point-b/StaleBaseBanner.tsx — the top-of-page warning that the base revenue is
 * out of date (visual audit: the first screen did not say that the revenue is from 2024).
 * The text is the model's own warning; the actions lead to where the revenue is refreshed.
 */
import { CARD, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { GapActionLinks } from './DataGapBanner'

export default function StaleBaseBanner({ message, className }: { message: string; className?: string }) {
  return (
    <section role="status" aria-label="Данные устарели" className={cn(CARD, 'border-tertiary-fixed-dim/40 bg-tertiary-fixed-dim/[0.06]', className)}>
      <div className="flex items-start gap-3">
        <Icon name="update" className="mt-0.5 text-xl text-tertiary-fixed-dim" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">Данные о выручке устарели</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">{message}</p>
          <GapActionLinks actions={['survey', 'documents']} />
        </div>
      </div>
    </section>
  )
}
