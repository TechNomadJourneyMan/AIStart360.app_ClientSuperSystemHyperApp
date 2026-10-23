'use client'

import { ScoreGauge } from '@/components/point-a/ExecutiveOverview'
import { formatRelativeRuLong } from '@/components/point-a/executive-overview-model'
import type { PointAPageState } from '@/hooks/usePointAState'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, ConfidenceBar, Icon, STAGE_RU, pct } from './ui'
import { cn } from '@/lib/utils'
import { openAiChat } from '@/components/ai-chat/open'
import { PRIMARY_POINT_A_HINT, PRIMARY_POINT_A_LABEL, isPrimaryPointA } from '@/lib/point-a/v4/primary'

export function PointAHeader({
  state, onRecalc, recalcPending, customize, onCustomize,
}: {
  state: PointAPageState
  onRecalc: () => void
  recalcPending: boolean
  customize: boolean
  onCustomize: () => void
}) {
  const s = state.snapshot
  // Only a running recalculation blocks the button: a queued one (debounce,
  // backoff) is taken over by the manual run (claimCompany).
  const busy = recalcPending || state.recalculation === 'running'
  const queued = !busy && state.recalculation === 'queued'
  const withoutData = s?.blocks.filter((b) => b.score === null && !b.informational).length ?? 0
  return (
    // overflow-clip, not overflow-hidden: the glow sticks out of the card, and a
    // hidden-overflow box can still be scrolled (focus, scrollIntoView) — that
    // shifted the whole header left and cut the gauge.
    <section className={cn(CARD, 'relative overflow-clip')} aria-labelledby="pa-title">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-col md:flex-row md:items-center gap-4 md:gap-5">
        <div className="self-center md:self-auto"><ScoreGauge score={s?.overall ?? null} size={132} /></div>
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">Точка А</p>
            <h1 id="pa-title" className="font-headline text-xl sm:text-2xl font-bold text-on-surface">Текущее состояние бизнеса</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s?.stage && <span className={cn(CHIP, 'bg-primary/10 text-primary')}>{STAGE_RU[s.stage] ?? s.stage}</span>}
            {/* A block without data → the assessment is primary (survey express, spec 2026-10-23 §7.2). */}
            {s && s.overall !== null && isPrimaryPointA(s.blocks) && (
              <span className={cn(CHIP, 'bg-amber-300/10 text-amber-200')} title={PRIMARY_POINT_A_HINT}>{PRIMARY_POINT_A_LABEL}</span>
            )}
            {s && <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')}>Полнота данных {pct(s.coverage)}</span>}
            {withoutData > 0 && <span className={cn(CHIP, 'bg-amber-300/10 text-amber-200')}>Без данных: {withoutData}</span>}
            {state.review?.status === 'current' && (
              <span className={cn(CHIP, 'bg-emerald-400/10 text-emerald-300')} suppressHydrationWarning>
                <Icon name="verified" className="text-[12px]" />Проверено экспертом{state.review.by ? ` ${state.review.by}` : ''}, {new Date(state.review.at).toLocaleDateString('ru-RU')}
              </span>
            )}
            {state.review?.status === 'earlier' && (
              <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')} title={`${state.review.by ?? 'Эксперт'}, ${new Date(state.review.at).toLocaleDateString('ru-RU')}`} suppressHydrationWarning>
                <Icon name="history" className="text-[12px]" />Проверено ранее, есть изменения
              </span>
            )}
            {busy && (
              <span className={cn(CHIP, 'bg-primary/10 text-primary')} aria-live="polite">
                <Icon name="progress_activity" className="text-[12px] animate-spin" />Пересчитывается…
              </span>
            )}
            {queued && (
              <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')} aria-live="polite">
                <Icon name="schedule" className="text-[12px]" />Данные изменились — скоро пересчитаем
              </span>
            )}
          </div>
          <div className="max-w-sm"><ConfidenceBar value={s?.confidence ?? null} /></div>
          {s && <p className="text-[11px] text-on-surface-variant" suppressHydrationWarning>Обновлено {formatRelativeRuLong(s.createdAt)}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-col md:items-stretch md:min-w-[11rem] [&>*:first-child:nth-last-child(odd)]:col-span-2 [&>*:only-child]:col-span-2">
          {state.canManage && (
            <button type="button" className={BTN_PRIMARY} onClick={onRecalc} disabled={busy} aria-busy={busy}>
              <Icon name={busy ? 'progress_activity' : 'refresh'} className={cn('text-[16px]', busy && 'animate-spin')} />
              {busy ? 'Считаем…' : 'Обновить'}
            </button>
          )}
          <button type="button" className={BTN_GHOST} onClick={() => openAiChat({ surface: 'point_a' })}>
            <Icon name="auto_awesome" className="text-[16px]" />Спросить AI
          </button>
          {state.canManage && (
            <button type="button" className={BTN_GHOST} onClick={onCustomize} aria-pressed={customize}>
              <Icon name="tune" className="text-[16px]" />{customize ? 'Готово' : 'Настроить блоки'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
