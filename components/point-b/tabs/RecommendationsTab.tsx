'use client'

/**
 * components/point-b/tabs/RecommendationsTab.tsx — the client «Рекомендации» tab (plan Ф6a Task 7, spec §12, §15.2).
 *
 * Shows ONLY what an expert has verified: the badge «Проверено экспертом» with the name, specialty and date, the scope
 * the expert stated, and the whole recommendation (essence, reason, expected result, resources, confidence with its
 * reason, risks, next action) with «Почему вы это видите» and its sources. A recommendation verified earlier whose data
 * has since changed is greyed with «Требует обновления». Recommendations waiting for the expert are only COUNTED —
 * their texts never reach the client (the parser drops them too). Rejected ones are not shown at all.
 * Project tokens only — the PO will replace the design.
 */
import { CARD, CARD_TITLE, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import type { ClientRecommendationView } from '@/lib/point-b/recs/types'
import { WhyDetails } from '../InviteCards'
import type { PointBStateSnapshot } from '../pointBStateController'
import {
  EMPTY_RECS, RECS_EMPTY_NONE, RECS_EMPTY_PREPARING, RECS_HONEST_TEXT, REC_KIND_LABEL, STALE_LABEL,
  orderedRecs, pendingText, recRows, recsMode, reviewedBadge, type PointBRecsState,
} from '../recsModel'
import { SectionError, SectionSkeleton } from './OverviewTab'

export const REC_WHY_TEXT = 'Рекомендация опирается на данные ниже. Числа в ней взяты из расчёта вашего плана, а эксперт проверил выводы.'

function HonestNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-on-surface-variant">
      <Icon name="shield" className="text-base text-primary" />
      <span>{RECS_HONEST_TEXT}. В карточке указано, кто проверил рекомендацию, когда и для каких условий она верна.</span>
    </p>
  )
}

function PendingNote({ count }: { count: number }) {
  const text = pendingText(count)
  if (!text) return null
  return (
    <p className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-on-surface-variant">
      <Icon name="hourglass_top" className="text-lg text-secondary" />
      <span>{text}</span>
    </p>
  )
}

export function RecommendationCard({ rec }: { rec: ClientRecommendationView }) {
  const stale = rec.state === 'stale'
  const titleId = `pb-rec-${rec.id}`
  return (
    <li>
      <article
        aria-labelledby={titleId}
        data-state={rec.state}
        className={cn(CARD, 'space-y-3', stale && 'border-dashed border-white/[0.1] bg-white/[0.02] opacity-75')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(CHIP, 'normal-case tracking-normal bg-white/[0.06] text-on-surface-variant')}>{REC_KIND_LABEL[rec.kind]}</span>
          {stale ? (
            <span className={cn(CHIP, 'normal-case tracking-normal bg-white/[0.08] text-on-surface-variant')}>
              <Icon name="update" className="text-[14px]" />
              {STALE_LABEL}
            </span>
          ) : null}
          <span className={cn(CHIP, 'normal-case tracking-normal', stale ? 'bg-white/[0.04] text-on-surface-variant' : 'bg-primary/10 text-primary')}>
            <Icon name="verified" className="text-[14px]" />
            {reviewedBadge(rec)}
          </span>
        </div>
        <h3 id={titleId} className="break-words font-headline text-base font-bold text-on-surface">{rec.title}</h3>
        {stale && (
          <p className="text-xs text-on-surface-variant">Данные изменились после проверки. Эксперт обновит рекомендацию — до этого опирайтесь на неё с осторожностью.</p>
        )}
        {rec.scopeNote && (
          <p className="text-xs text-on-surface-variant"><span className="font-medium text-on-surface">Область применимости:</span> {rec.scopeNote}</p>
        )}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          {recRows(rec).map((row) => (
            <div key={row.key} className={cn('min-w-0', (row.key === 'essence' || row.key === 'nextAction') && 'md:col-span-2')}>
              <dt className={CARD_TITLE}>{row.label}</dt>
              <dd className={cn('mt-0.5 break-words text-sm', row.key === 'nextAction' ? 'font-medium text-on-surface' : 'text-on-surface-variant')}>{row.value}</dd>
            </div>
          ))}
        </dl>
        <WhyDetails why={REC_WHY_TEXT} sources={rec.sourceRefs} />
      </article>
    </li>
  )
}

function EmptyRecs({ mode, pendingCount }: { mode: 'preparing' | 'none'; pendingCount: number }) {
  return (
    <section aria-labelledby="pb-recs-empty" className={CARD}>
      <div className="flex items-start gap-3">
        <Icon name={mode === 'preparing' ? 'hourglass_top' : 'info'} className="mt-0.5 text-2xl text-secondary" />
        <div className="min-w-0">
          <h2 id="pb-recs-empty" className="font-headline text-lg font-bold text-on-surface">{mode === 'preparing' ? RECS_EMPTY_PREPARING : RECS_EMPTY_NONE}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {mode === 'preparing'
              ? `${pendingText(pendingCount)}. Они появятся здесь, как только эксперт их проверит.`
              : 'Когда эксперт проверит рекомендации по вашему плану, они появятся здесь — с тем, кто и когда их проверил.'}
          </p>
        </div>
      </div>
    </section>
  )
}

export function RecommendationsView({ recs }: { recs: PointBRecsState }) {
  const list = orderedRecs(recs)
  if (list.length === 0) {
    return (
      <div className="space-y-4">
        <HonestNote />
        <EmptyRecs mode={recs.pendingCount > 0 ? 'preparing' : 'none'} pendingCount={recs.pendingCount} />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <HonestNote />
      <PendingNote count={recs.pendingCount} />
      <ul className="space-y-3" aria-label="Рекомендации, проверенные экспертом">
        {list.map((r) => <RecommendationCard key={r.id} rec={r} />)}
      </ul>
    </div>
  )
}

export default function RecommendationsTab({ snap, onRetry }: { snap: PointBStateSnapshot; onRetry?: () => void }) {
  const mode = recsMode(snap)
  if (mode === 'loading') return <SectionSkeleton label="Загружаем рекомендации" />
  if (mode === 'error') return <SectionError message={snap.error ?? 'Нет данных'} onRetry={onRetry} />
  return <RecommendationsView recs={snap.recommendations ?? EMPTY_RECS} />
}
