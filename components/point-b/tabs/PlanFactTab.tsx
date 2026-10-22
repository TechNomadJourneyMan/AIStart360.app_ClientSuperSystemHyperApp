'use client'

/**
 * components/point-b/tabs/PlanFactTab.tsx — the client tab «План-факт и история» (plan Ф6b, spec §13, §15.2):
 *   - the verdict strip «на курсе / риск / отстаём / нет данных» with its reason and the forecast; the badge
 *     «обновлено N дней назад» (stale after 4 days — the recompute runs twice a week);
 *   - the progress of every goal: base → fact → goal, the share of the WAY and the share of the TIME side by side,
 *     the forecast date — never one aggregated percent;
 *   - plan · fact by month: a chart of the revenue (plan with its corridor, fact) and the KPIs of each month with their
 *     verdict (a table on a wide screen, cards on a phone — no horizontal scroll at 375 px);
 *   - «Факт за месяц» — the form of the monthly reconciliation;
 *   - the versions of the plan and their comparison.
 * The plan-fact exists for an APPROVED plan only. Project tokens only — the PO will replace the design.
 */
import { CARD, CARD_TITLE, CHIP, Icon } from '@/components/point-a-v4/ui'
import type { PlanFactState } from '@/lib/point-b/planfact/types'
import { cn } from '@/lib/utils'
import MonthlyFactForm, { MonthlyFactFormView } from '../MonthlyFactForm'
import { TONE_CLASS } from '../overviewModel'
import {
  checkpointRows, progressRows, revenueChart, staleBadge, verdictStrip,
  type CheckpointRow, type ProgressRow, type RevenueChart,
} from '../planFactModel'
import type { PointBStateSnapshot } from '../pointBStateController'
import VersionCompare from '../VersionCompare'
import { SectionError, SectionSkeleton } from './OverviewTab'

export const PLANFACT_EMPTY_NO_PLAN = 'План-факт появится после одобрения плана экспертом'
export const PLANFACT_NO_AGGREGATE = 'Единый процент выполнения не считаем: у каждой цели — доля пройденного пути и доля прошедшего времени.'

function VerdictBar({ state }: { state: PlanFactState }) {
  const v = verdictStrip(state)
  const badge = staleBadge(state)
  return (
    <section aria-labelledby="pb-pf-verdict" className={cn(CARD, v ? [TONE_CLASS[v.tone].border, TONE_CLASS[v.tone].bg] : null)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon name={v?.icon ?? 'help'} className={cn('mt-0.5 text-2xl', v ? TONE_CLASS[v.tone].text : 'text-on-surface-variant')} />
          <div className="min-w-0">
            <h2 id="pb-pf-verdict" className="font-headline text-lg font-bold text-on-surface">
              {v ? <>{v.label} <span className="text-sm font-normal text-on-surface-variant">· {v.period}</span></> : 'Сверок ещё не было'}
            </h2>
            <p className="mt-1 break-words text-sm text-on-surface">{v?.reason ?? 'Мы сравним факт с планом после первого пересчёта или когда вы внесёте «Факт за месяц».'}</p>
            {v?.forecast && <p className="mt-1 break-words text-xs text-on-surface-variant">{v.forecast}</p>}
          </div>
        </div>
        {badge && (
          <span className={cn(CHIP, 'normal-case tracking-normal', badge.stale ? 'bg-tertiary-fixed-dim/10 text-tertiary-fixed-dim' : 'bg-white/[0.06] text-on-surface-variant')}>
            <Icon name="update" className="text-[14px]" />
            {badge.text}
          </span>
        )}
      </div>
    </section>
  )
}

function Bar({ value, label, tone }: { value: { text: string; width: number } | null; label: string; tone: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <span>{label}</span>
        <span>{value?.text ?? 'нет данных'}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.06]" role="presentation">
        {value && <div className={cn('h-full rounded-full', tone)} style={{ width: `${value.width}%` }} />}
      </div>
    </div>
  )
}

export function ProgressSection({ rows }: { rows: ProgressRow[] }) {
  if (!rows.length) return null
  return (
    <section aria-labelledby="pb-pf-progress" className={cn(CARD, 'space-y-3')}>
      <div>
        <h2 id="pb-pf-progress" className="font-headline text-lg font-bold text-on-surface">Прогресс по целям</h2>
        <p className="mt-1 text-xs text-on-surface-variant">{PLANFACT_NO_AGGREGATE}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="break-words font-medium text-on-surface">{r.label}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div className="min-w-0"><dt className={CARD_TITLE}>База</dt><dd className="break-words text-on-surface-variant">{r.base}</dd></div>
              <div className="min-w-0"><dt className={CARD_TITLE}>Факт</dt><dd className="break-words font-medium text-on-surface">{r.fact}</dd></div>
              <div className="min-w-0"><dt className={CARD_TITLE}>Цель</dt><dd className="break-words text-on-surface-variant">{r.target}</dd></div>
            </dl>
            {r.factNote && <p className="mt-1 text-xs text-on-surface-variant">{r.factNote}</p>}
            <div className="mt-3 space-y-2">
              <Bar value={r.path} label="Пройдено пути" tone="bg-primary" />
              <Bar value={r.time} label="Прошло времени" tone="bg-on-surface-variant/60" />
            </div>
            <p className="mt-2 text-xs text-on-surface-variant">{r.forecast}{r.deadline ? ` · срок цели: ${r.deadline}` : ''}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

const CHART_H = 140
const SLOT = 36

export function RevenueBars({ chart }: { chart: RevenueChart }) {
  const w = chart.bars.length * SLOT
  const y = (v: number) => CHART_H - (v / chart.max) * (CHART_H - 8)
  return (
    <figure className="min-w-0 space-y-2">
      <svg role="img" aria-label={chart.summary} viewBox={`0 0 ${w} ${CHART_H}`} preserveAspectRatio="none" className="block h-36 w-full">
        {chart.bars.map((b, i) => {
          const x = i * SLOT
          return (
            <g key={b.period}>
              {b.low !== null && b.high !== null && (
                <rect x={x + 4} y={y(b.high)} width={SLOT - 8} height={Math.max(1, y(b.low) - y(b.high))} className="text-on-surface-variant" fill="currentColor" fillOpacity={0.12} />
              )}
              {b.fact !== null && <rect x={x + 9} y={y(b.fact)} width={SLOT - 18} height={CHART_H - y(b.fact)} className="text-primary" fill="currentColor" fillOpacity={0.8} />}
              {b.plan !== null && <line x1={x + 4} x2={x + SLOT - 4} y1={y(b.plan)} y2={y(b.plan)} className="text-on-surface" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            </g>
          )
        })}
      </svg>
      <div className="grid gap-0 text-center text-[10px] text-on-surface-variant" style={{ gridTemplateColumns: `repeat(${chart.bars.length}, minmax(0, 1fr))` }}>
        {chart.bars.map((b) => <span key={b.period} className="truncate">{b.short}</span>)}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-on-surface" />план</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-on-surface-variant/20" />коридор плана</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-primary/80" />факт</span>
      </figcaption>
    </figure>
  )
}

function VerdictChip({ label, tone }: { label: string; tone: keyof typeof TONE_CLASS }) {
  return <span className={cn(CHIP, 'normal-case tracking-normal', TONE_CLASS[tone].bg, TONE_CLASS[tone].text)}>{label}</span>
}

export function CheckpointsSection({ rows, chart }: { rows: CheckpointRow[]; chart: RevenueChart | null }) {
  return (
    <section aria-labelledby="pb-pf-months" className={cn(CARD, 'space-y-4')}>
      <div>
        <h2 id="pb-pf-months" className="font-headline text-lg font-bold text-on-surface">План и факт по месяцам</h2>
        <p className="mt-1 text-xs text-on-surface-variant">План — из одобренной версии; факт — из ежемесячной сверки и данных Точки А; отклонение в пределах допуска — «на курсе».</p>
      </div>
      {chart && <RevenueBars chart={chart} />}
      {rows.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Сверок по месяцам пока нет.</p>
      ) : (
        <>
          {/* Phone: one card per month. */}
          <ul className="space-y-3 sm:hidden">
            {rows.map((r) => (
              <li key={r.period} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium capitalize text-on-surface">{r.label}</span>
                  <VerdictChip label={r.overallLabel} tone={r.tone} />
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  {r.cells.map((c) => (
                    <div key={c.kpi} className="flex flex-wrap justify-between gap-x-2">
                      <dt className="text-on-surface-variant">{c.label}</dt>
                      <dd className="text-right text-on-surface">{c.actual} <span className="text-on-surface-variant">/ план {c.planned}</span></dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 break-words text-xs text-on-surface-variant">{r.reason}</p>
              </li>
            ))}
          </ul>
          {/* Wide screen: the table. */}
          <table className="hidden w-full table-fixed border-collapse text-sm sm:table">
            <caption className="sr-only">План, факт и вердикт по ключевым показателям за каждый месяц</caption>
            <thead>
              <tr className="text-left text-xs text-on-surface-variant">
                <th scope="col" className="w-36 py-2 pr-2 font-medium">Месяц</th>
                {rows[0].cells.map((c) => <th key={c.kpi} scope="col" className="py-2 pr-2 font-medium">{c.label}</th>)}
                <th scope="col" className="w-28 py-2 font-medium">Вердикт</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period} className="border-t border-white/[0.06] align-top">
                  <th scope="row" className="py-2 pr-2 text-left font-medium capitalize text-on-surface">{r.label}</th>
                  {r.cells.map((c) => (
                    <td key={c.kpi} className="py-2 pr-2">
                      <span className={cn('block', TONE_CLASS[c.tone].text)}>{c.actual}</span>
                      <span className="block text-xs text-on-surface-variant">план {c.planned}{c.source ? ` · ${c.source}` : ''}</span>
                    </td>
                  ))}
                  <td className="py-2"><VerdictChip label={r.overallLabel} tone={r.tone} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

/** The whole tab for a parsed state (exported for the preview and the tests). */
export function PlanFactView({ state, preview, onSaved, factUrl, audience = 'client' }: {
  state: PlanFactState
  preview?: boolean
  onSaved?: () => void
  factUrl?: string
  audience?: 'client' | 'staff'
}) {
  return (
    <div className="min-w-0 space-y-4">
      <VerdictBar state={state} />
      <ProgressSection rows={progressRows(state)} />
      <CheckpointsSection rows={checkpointRows(state)} chart={revenueChart(state)} />
      {state.kpis.length > 0 && state.reconciliation.period && (
        <MonthlyFactForm
          kpis={state.kpis}
          period={state.reconciliation.period}
          initial={state.reconciliation.values}
          done={state.reconciliation.done}
          audience={audience}
          url={factUrl}
          onSaved={onSaved}
          preview={preview}
        />
      )}
      <VersionCompare versions={state.versions} />
    </div>
  )
}

function Empty({ text, sub }: { text: string; sub: string }) {
  return (
    <section aria-labelledby="pb-pf-empty" className={CARD}>
      <div className="flex items-start gap-3">
        <Icon name="hourglass_top" className="mt-0.5 text-2xl text-secondary" />
        <div className="min-w-0">
          <h2 id="pb-pf-empty" className="font-headline text-lg font-bold text-on-surface">{text}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">{sub}</p>
        </div>
      </div>
    </section>
  )
}

export default function PlanFactTab({ snap, onRetry, onSaved, preview }: { snap: PointBStateSnapshot; onRetry?: () => void; onSaved?: () => void; preview?: boolean }) {
  if (snap.phase === 'loading') return <SectionSkeleton label="Загружаем план-факт" />
  if (snap.phase === 'error') return <SectionError message={snap.error ?? 'Ошибка загрузки'} onRetry={onRetry} />
  if (snap.plan.status !== 'published') {
    return <Empty text={PLANFACT_EMPTY_NO_PLAN} sub="Когда план будет одобрен, здесь появятся сверки «план — факт» по месяцам, прогресс по целям и история версий." />
  }
  if (!snap.planFact) return <Empty text="План-факт готовится" sub="Сверки появятся после первого пересчёта плана." />
  return <PlanFactView state={snap.planFact} preview={preview} onSaved={onSaved} />
}

export { MonthlyFactFormView }
