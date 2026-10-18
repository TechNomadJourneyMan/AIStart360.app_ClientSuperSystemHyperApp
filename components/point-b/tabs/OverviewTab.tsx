'use client'

/**
 * components/point-b/tabs/OverviewTab.tsx — the first screen of Point B (plan Phase 2 Task 8,
 * spec §15.2, visual audit): the verdict with its reason, the way А → Б (now · goal · at the
 * current pace · gap), the trajectory with a corridor, what the data lacks and what to keep
 * in mind. Always the PRELIMINARY automatic calculation — labelled as such.
 *
 * Every state is local: loading → skeleton, failure → a retry card, level 0 → an honest
 * placeholder instead of the chart. Project tokens only — the PO will replace the design.
 */
import { BTN_GHOST, BTN_PRIMARY, CARD, CARD_TITLE, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import type { ModelResult } from '@/lib/point-b/model/types'
import CorridorChart from '../CorridorChart'
import CostOfGoalCard from '../CostOfGoalCard'
import DataGapBanner from '../DataGapBanner'
import StaleBaseBanner from '../StaleBaseBanner'
import type { PointBStateSnapshot } from '../pointBStateController'
import {
  TONE_CLASS, chartData, chartPlaceholder, costOfGoalView, fmtLongDate, otherWarnings, pathCells, staleWarning, verdictView,
  type PointBFinmodelStatus, type PointBPlanState,
} from '../overviewModel'
import { useGoToTab } from './PointBTabs'

export const AUTOMATIC_LABEL = 'Автоматический расчёт, не проверен экспертом'

export function SectionSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={label}>
      <div className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />)}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-white/[0.04]" />
    </div>
  )
}

export function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section role="alert" className={cn(CARD, 'border-error/30 bg-error/[0.06]')}>
      <div className="flex items-start gap-3">
        <Icon name="error" className="mt-0.5 text-xl text-error" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">Не удалось загрузить расчёт</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">{message}</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">Вкладка «Подробности» при этом работает.</p>
          {onRetry && <button type="button" onClick={onRetry} className={cn(BTN_GHOST, 'mt-3')}>Повторить</button>}
        </div>
      </div>
    </section>
  )
}

export function OverviewView({ result, plan, finmodel = null }: { result: ModelResult; plan: PointBPlanState; finmodel?: PointBFinmodelStatus | null }) {
  const go = useGoToTab()
  const verdict = verdictView(result)
  const tone = TONE_CLASS[verdict.tone]
  const stale = staleWarning(result)
  const warnings = otherWarnings(result)
  // The corridor comes from the APPROVED plan's scenarios (never from the automatic calculation).
  const chart = chartData({ ...result, scenarios: plan.scenarios }, plan.selectedScenario)
  const chartHint = plan.scenarios.length === 0 && result.level >= 1
    ? 'Траектория по сценариям появится после того, как эксперт одобрит план. Прогноз и цель — выше.'
    : chartPlaceholder(result)
  const computed = fmtLongDate(result.computedAt)
  const suggestScenarios = verdict.key === 'behind' || verdict.key === 'at_risk'
  const cost = costOfGoalView(result, finmodel, plan.selectedScenario)

  return (
    <div className="space-y-4">
      {stale && <StaleBaseBanner message={stale} />}

      <section aria-label="Вердикт" className={cn(CARD, tone.border, tone.bg)}>
        <div className="flex items-start gap-3">
          <Icon name={verdict.icon} className={cn('mt-0.5 text-3xl', tone.text)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(CHIP, 'bg-white/[0.06]', tone.text)}>{verdict.label}</span>
              <span className={cn(CHIP, 'bg-white/[0.06] text-on-surface-variant')}>
                <Icon name="calculate" className="text-[14px]" />
                {AUTOMATIC_LABEL}
              </span>
            </div>
            <h2 className="mt-2 font-headline text-xl font-bold text-on-surface sm:text-2xl">{verdict.headline}</h2>
            {verdict.reason && <p className="mt-1 text-sm text-on-surface-variant">{verdict.reason}</p>}
            {suggestScenarios && (
              <button type="button" onClick={() => go('scenarios')} className={cn(BTN_PRIMARY, 'mt-3')}>
                Что делать: смотреть сценарии
              </button>
            )}
          </div>
        </div>
      </section>

      <section aria-label="От сегодняшней выручки к цели">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pathCells(result).map((c) => (
            <div key={c.label} className={cn(CARD, '!p-4')}>
              <dt className={CARD_TITLE}>{c.label}</dt>
              <dd className="mt-1.5 font-headline text-xl font-bold text-on-surface">{c.value}</dd>
              {c.note && <dd className="mt-0.5 text-xs text-on-surface-variant">{c.note}</dd>}
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-on-surface-variant">
          Цель — годовая выручка к сроку. Цели на другие сроки и подробный разбор — на вкладке «Подробности».
        </p>
      </section>

      <section aria-labelledby="pb-overview-chart" className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="pb-overview-chart" className="font-headline text-base font-bold text-on-surface">Траектория выручки</h3>
          {chart && <span className={cn(CHIP, 'bg-white/[0.06] text-on-surface-variant')}>Темп: {chart.scenario.label}</span>}
        </div>
        {chart ? (
          <CorridorChart data={chart.data} scenarioLabel={chart.scenario.label} placeholder={chartHint} />
        ) : (
          <div className="rounded-xl border border-dashed border-white/[0.1] p-6 text-center">
            <Icon name="show_chart" className="mb-1 block text-3xl text-on-surface-variant/50" />
            <p className="text-sm font-medium text-on-surface">Графика пока нет</p>
            <p className="mt-0.5 text-xs text-on-surface-variant">{chartHint}</p>
          </div>
        )}
      </section>

      <CostOfGoalCard view={cost} onFill={() => go('finmodel')} />

      <DataGapBanner missing={result.missing} />

      {warnings.length > 0 && (
        <section aria-label="Что учесть в расчёте" className={CARD}>
          <h3 className="text-sm font-semibold text-on-surface">Что учесть в расчёте</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-on-surface-variant">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </section>
      )}

      {computed && <p className="text-[11px] text-on-surface-variant">Рассчитано {computed}. {AUTOMATIC_LABEL}.</p>}
    </div>
  )
}

export default function OverviewTab({ snap, onRetry }: { snap: PointBStateSnapshot; onRetry?: () => void }) {
  if (snap.phase === 'loading') return <SectionSkeleton label="Загружаем обзор" />
  if (!snap.result) return <SectionError message={snap.error ?? 'Нет данных расчёта'} onRetry={onRetry} />
  return <OverviewView result={snap.result} plan={snap.plan} finmodel={snap.finmodel ?? null} />
}
