'use client'

import { ScoreGauge } from '@/components/point-a/ExecutiveOverview'
import { formatRelativeRuLong } from '@/components/point-a/executive-overview-model'
import type { PointAPageState } from '@/hooks/usePointAState'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, ConfidenceBar, Icon, STAGE_RU, pct } from './ui'
import { cn } from '@/lib/utils'

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
  const busy = recalcPending || state.recalculation !== 'idle'
  const withoutData = s?.blocks.filter((b) => b.score === null && !b.informational).length ?? 0
  return (
    <section className={cn(CARD, 'relative overflow-hidden')} aria-labelledby="pa-title">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
        <ScoreGauge score={s?.overall ?? null} size={132} />
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">Точка А</p>
            <h1 id="pa-title" className="font-headline text-xl sm:text-2xl font-bold text-on-surface">Текущее состояние бизнеса</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s?.stage && <span className={cn(CHIP, 'bg-primary/10 text-primary')}>{STAGE_RU[s.stage] ?? s.stage}</span>}
            {s && <span className={cn(CHIP, 'bg-white/[0.04] text-on-surface-variant')}>Полнота данных {pct(s.coverage)}</span>}
            {withoutData > 0 && <span className={cn(CHIP, 'bg-amber-300/10 text-amber-200')}>Без данных: {withoutData}</span>}
            {s?.reviewedAt && <span className={cn(CHIP, 'bg-emerald-400/10 text-emerald-300')}><Icon name="verified" className="text-[12px]" />Проверено экспертом</span>}
            {busy && (
              <span className={cn(CHIP, 'bg-primary/10 text-primary')} aria-live="polite">
                <Icon name="progress_activity" className="text-[12px] animate-spin" />Пересчитывается…
              </span>
            )}
          </div>
          <div className="max-w-sm"><ConfidenceBar value={s?.confidence ?? null} /></div>
          {s && <p className="text-[11px] text-on-surface-variant" suppressHydrationWarning>Обновлено {formatRelativeRuLong(s.createdAt)}</p>}
        </div>
        <div className="flex flex-row sm:flex-col gap-2 sm:items-stretch">
          <button type="button" className={BTN_PRIMARY} onClick={onRecalc} disabled={busy} aria-busy={busy}>
            <Icon name={busy ? 'progress_activity' : 'refresh'} className={cn('text-[16px]', busy && 'animate-spin')} />
            {busy ? 'Считаем…' : 'Обновить'}
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
