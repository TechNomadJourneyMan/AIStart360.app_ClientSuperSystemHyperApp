'use client'

/**
 * The Point A page (spec 2026-10-12 §4): one page instead of /point-a and the
 * old /client/point-a — header, what needs attention, the overview, the
 * blocks, goals, GRI, benchmarks, history and data sources. Refreshes itself
 * (Realtime + polling while a recalculation runs).
 */
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { usePointAState, useRecalculatePointA, type PointAPageState } from '@/hooks/usePointAState'
import { PointAHeader } from './PointAHeader'
import { AttentionPanel } from './AttentionPanel'
import { OverviewSection } from './OverviewSection'
import { BlocksSection } from './BlocksSection'
import { GoalsSection } from './GoalsSection'
import { BenchmarksCard, GriCard, SourcesCard } from './SideCards'
import { HistorySection } from './HistorySection'
import { KeyMetricsStrip } from './KeyMetricsStrip'
import { ExpertNotes } from './ExpertNotes'
import type { BlockKey } from '@/lib/point-a/v4/config'
import type { BlockDetail } from '@/lib/point-a/v4/metric-views'
import { BTN_PRIMARY, CARD, Icon } from './ui'
import { cn } from '@/lib/utils'

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Загрузка Точки А">
      <div className={cn(CARD, 'h-44 animate-pulse')} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className={cn(CARD, 'h-40 animate-pulse')} />)}
      </div>
    </div>
  )
}

/** `preview` (dev-only /dev/point-a-preview): render the given state, no requests. */
export default function PointAV4Page({ preview, previewDetails }: { preview?: PointAPageState; previewDetails?: Partial<Record<BlockKey, BlockDetail>> } = {}) {
  const live = usePointAState({ enabled: !preview })
  const { isLoading, error, refetch } = live
  const state = preview ?? live.data
  const recalc = useRecalculatePointA()
  const [customize, setCustomize] = useState(false)

  if (isLoading && !preview) return <main className="mx-auto max-w-6xl px-4 py-6"><Skeleton /></main>
  if (error || !state) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className={CARD} role="alert">
          <p className="text-sm text-on-surface">Не удалось загрузить Точку А.</p>
          <button type="button" className={cn(BTN_PRIMARY, 'mt-3')} onClick={() => void refetch()}>Повторить</button>
        </div>
      </main>
    )
  }

  const runRecalc = () =>
    recalc.mutate(undefined, {
      onSuccess: () => toast.success('Точка А пересчитана'),
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось пересчитать'),
    })

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
      <PointAHeader state={state} onRecalc={preview ? () => toast.info('Предпросмотр: пересчёт отключён') : runRecalc} recalcPending={recalc.isPending} customize={customize} onCustomize={() => setCustomize((v) => !v)} />

      {!state.snapshot ? (
        <section className={CARD}>
          {state.sources.survey.completed === 0 ? (
            <>
              <p className="text-sm text-on-surface">Заполните анкету — Точка А построится автоматически по вашим ответам, документам и метрикам.</p>
              <Link href="/client/onboarding" className={cn(BTN_PRIMARY, 'mt-3')}><Icon name="edit_note" className="text-[16px]" />Заполнить анкету</Link>
            </>
          ) : (
            <p className="text-sm text-on-surface" aria-live="polite">Точка А считается по вашим данным — это займёт до минуты.</p>
          )}
        </section>
      ) : (
        <>
          <KeyMetricsStrip state={state} readonly={!!preview} />
          <ExpertNotes state={state} />
          <AttentionPanel state={state} readonly={!!preview} />
          <OverviewSection snapshot={state.snapshot} />
          <BlocksSection state={state} customize={customize} previewDetails={previewDetails} />
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <GoalsSection state={state} readonly={!!preview} />
              <HistorySection history={state.history} />
            </div>
            <div className="space-y-4">
              <GriCard gri={state.gri} />
              <BenchmarksCard benchmarks={state.benchmarks} />
              <SourcesCard sources={state.sources} />
            </div>
          </div>
        </>
      )}
    </main>
  )
}
