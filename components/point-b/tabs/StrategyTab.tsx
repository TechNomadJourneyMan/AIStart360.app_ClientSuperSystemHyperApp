'use client'

/**
 * components/point-b/tabs/StrategyTab.tsx — the «Стратегия» tab (plan Ф5 Task 5, spec §11, §15): strategy cards
 * with the progress of their tasks, expandable into initiatives (impact and effort, KPI, due date, delay risk) and
 * tasks (owner, due date, status from the action plan), and the impact × effort matrix. Shows the tree of the
 * APPROVED plan version only (the server never sends a draft); without it — «Эксперт готовит стратегию».
 *
 * Progress is computed by the server on read from the live statuses of the action plan; a node without tasks says
 * «нет задач», never 0 %. Expanding is native <details> (keyboard and screen-reader friendly, works without JS).
 * Project tokens only — the PO will replace the design.
 */
import { useMemo } from 'react'
import { CARD, CARD_TITLE, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import MatrixChart from '../MatrixChart'
import { DASH } from '../overviewModel'
import type { PointBStateSnapshot } from '../pointBStateController'
import {
  ACTION_PLAN_LINK_TEXT, ACTION_PLAN_TAB, buildCards, countsLine, fmtDay, kpiText, ratingText, strategyCounts, strategyMode, todayIso,
  type InitiativeView, type PointBStrategyState, type ProgressView, type StrategyCardView, type TaskView,
} from '../strategyModel'
import { SectionError, SectionSkeleton } from './OverviewTab'
import { useGoToTab } from './PointBTabs'

const STATE_TONE: Record<ProgressView['state'], string> = {
  done: 'bg-primary/[0.14] text-primary',
  in_progress: 'bg-secondary/[0.14] text-secondary',
  not_started: 'bg-white/[0.06] text-on-surface-variant',
  no_tasks: 'bg-white/[0.04] text-on-surface-variant',
  unknown: 'bg-white/[0.04] text-on-surface-variant',
}

const TASK_TONE = {
  done: 'bg-primary/[0.14] text-primary',
  in_progress: 'bg-secondary/[0.14] text-secondary',
  open: 'bg-white/[0.06] text-on-surface-variant',
  missing: 'bg-white/[0.04] text-on-surface-variant',
  unknown: 'bg-white/[0.04] text-on-surface-variant',
} as const

/** The state of a node as a chip: the word is the signal, the colour only helps. */
export function StateChip({ view }: { view: ProgressView }) {
  return <span className={cn(CHIP, 'normal-case tracking-normal', STATE_TONE[view.state])} title={view.detail}>{view.label}</span>
}

/** A bar for a node that has tasks; a node without tasks has no bar at all (and never shows 0 %). */
export function ProgressBar({ view, label }: { view: ProgressView; label: string }) {
  if (view.percent === null) return <p className="text-xs text-on-surface-variant">{view.state === 'no_tasks' ? 'нет задач — прогресс не считается' : `${DASH} ${view.detail}`}</p>
  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-label={`Прогресс: ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.percent}
        aria-valuetext={`${view.percent}%, ${view.detail}`}
        className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${view.percent}%` }} />
      </div>
      <p className="text-[11px] text-on-surface-variant">{view.percent}% · {view.detail}</p>
    </div>
  )
}

function Dots({ value }: { value: number | null }) {
  return (
    <span aria-hidden className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cn('h-1.5 w-1.5 rounded-full', value !== null && i <= value ? 'bg-primary' : 'bg-white/[0.15]')} />)}
    </span>
  )
}

function Rating({ label, value }: { label: 'Влияние' | 'Усилие'; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
      <Dots value={value} />
      <span>{ratingText(label, value)}</span>
    </span>
  )
}

/** The action plan lives in the «Подробности» tab of this page, so the link switches to it. */
export function ActionPlanLink() {
  const go = useGoToTab()
  return (
    <button
      type="button"
      onClick={() => go(ACTION_PLAN_TAB)}
      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {ACTION_PLAN_LINK_TEXT}
      <Icon name="arrow_forward" className="text-base" />
    </button>
  )
}

function Meta({ items }: { items: Array<[string, string | null]> }) {
  const shown = items.filter((i): i is [string, string] => !!i[1])
  if (shown.length === 0) return null
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className={CARD_TITLE}>{k}</dt>
          <dd className="break-words text-sm text-on-surface">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function TaskRow({ t }: { t: TaskView }) {
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium text-on-surface">{t.node.title || DASH}</p>
        <span className="flex flex-wrap items-center gap-1.5">
          {t.status.overdue && <span className={cn(CHIP, 'bg-error/[0.14] normal-case tracking-normal text-error')}>просрочена</span>}
          <span className={cn(CHIP, 'normal-case tracking-normal', TASK_TONE[t.status.key])} title={t.status.key === 'missing' ? 'Задачи нет в плане действий — возможно, вы её удалили' : undefined}>{t.status.label}</span>
        </span>
      </div>
      {t.node.description && <p className="mt-1 break-words text-xs text-on-surface-variant">{t.node.description}</p>}
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-on-surface-variant">
        <span>Ответственный: <span className="text-on-surface">{t.node.ownerLabel ?? DASH}</span></span>
        <span>Срок: <span className="text-on-surface">{fmtDay(t.node.dueDate)}</span></span>
      </p>
    </li>
  )
}

function InitiativeItem({ i }: { i: InitiativeView }) {
  const n = i.node
  const kpi = kpiText(n.kpi)
  return (
    <li>
      <details className="group rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="expand_more" className="-rotate-90 text-xl text-on-surface-variant transition-transform group-open:rotate-0" />
            <span className="min-w-0 break-words text-sm font-semibold text-on-surface">{n.title || DASH}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Rating label="Влияние" value={n.impact} />
            <Rating label="Усилие" value={n.effort} />
            <StateChip view={i.progress} />
          </span>
        </summary>
        <div className="space-y-3 border-t border-white/[0.06] px-3 py-3">
          <ProgressBar view={i.progress} label={n.title || 'инициатива'} />
          {n.description && <p className="break-words text-sm text-on-surface-variant">{n.description}</p>}
          <Meta items={[['KPI', kpi], ['Срок', n.dueDate ? fmtDay(n.dueDate) : null], ['Ответственный', n.ownerLabel], ['Риск задержки', n.delayRisk]]} />
          {i.tasks.length === 0 ? (
            <p className="text-xs text-on-surface-variant">Задач у этой инициативы пока нет.</p>
          ) : (
            <div className="space-y-2">
              <h5 className={CARD_TITLE}>Задачи</h5>
              <ul className="space-y-2" aria-label={`Задачи инициативы «${n.title || DASH}»`}>
                {i.tasks.map((t) => <TaskRow key={t.node.key} t={t} />)}
              </ul>
              <ActionPlanLink />
            </div>
          )}
        </div>
      </details>
    </li>
  )
}

function StrategyCard({ s, open }: { s: StrategyCardView; open: boolean }) {
  const n = s.node
  const kpi = kpiText(n.kpi)
  return (
    <li>
      <details open={open} className={cn(CARD, 'group !p-0')}>
        <summary className="cursor-pointer list-none space-y-2 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:px-5">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="expand_more" className="-rotate-90 text-2xl text-on-surface-variant transition-transform group-open:rotate-0" />
              <span className="min-w-0 break-words font-headline text-base font-bold text-on-surface">{n.title || DASH}</span>
            </span>
            <StateChip view={s.progress} />
          </span>
          <span className="block"><ProgressBar view={s.progress} label={n.title || 'стратегия'} /></span>
        </summary>
        <div className="space-y-4 border-t border-white/[0.06] px-4 py-4 sm:px-5">
          {n.description && <p className="break-words text-sm text-on-surface-variant">{n.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Rating label="Влияние" value={n.impact} />
            <Rating label="Усилие" value={n.effort} />
          </div>
          <Meta items={[['KPI', kpi], ['Срок', n.dueDate ? fmtDay(n.dueDate) : null], ['Ответственный', n.ownerLabel], ['Риск задержки', n.delayRisk]]} />
          {s.initiatives.length === 0 ? (
            <p className="text-xs text-on-surface-variant">Инициатив у этой стратегии пока нет.</p>
          ) : (
            <div className="space-y-2">
              <h4 className={CARD_TITLE}>Инициативы</h4>
              <ul className="space-y-2" aria-label={`Инициативы стратегии «${n.title || DASH}»`}>
                {s.initiatives.map((i) => <InitiativeItem key={i.node.key} i={i} />)}
              </ul>
            </div>
          )}
        </div>
      </details>
    </li>
  )
}

export function StrategyPreparing() {
  return (
    <section aria-labelledby="pb-str-prep" className={CARD}>
      <div className="flex items-start gap-3">
        <Icon name="hourglass_top" className="mt-0.5 text-2xl text-secondary" />
        <div className="min-w-0">
          <h2 id="pb-str-prep" className="font-headline text-lg font-bold text-on-surface">Эксперт готовит стратегию</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Стратегии, инициативы и задачи появятся здесь после того, как эксперт соберёт их и одобрит план. Задачи сразу попадут в ваш план действий.
          </p>
        </div>
      </div>
    </section>
  )
}

export function StrategyEmpty() {
  return (
    <section aria-labelledby="pb-str-empty" className={CARD}>
      <div className="flex items-start gap-3">
        <Icon name="info" className="mt-0.5 text-2xl text-secondary" />
        <div className="min-w-0">
          <h2 id="pb-str-empty" className="font-headline text-lg font-bold text-on-surface">В плане пока нет стратегии</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Эксперт добавит её в следующей версии плана. Пока ориентир — вкладка «Сценарии».</p>
        </div>
      </div>
    </section>
  )
}

export function StrategyView({ strategy, today, planVersion = null }: { strategy: PointBStrategyState; today: string; planVersion?: number | null }) {
  const cards = buildCards(strategy, today)
  const counts = strategyCounts(strategy)
  return (
    <div className="space-y-5">
      <p className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
        <Icon name="verified" className="text-lg text-primary" />
        <span>{planVersion !== null ? `Стратегия из плана v${planVersion}` : 'Стратегия из одобренного плана'} · {countsLine(counts)}</span>
      </p>

      <ul className="space-y-3" aria-label="Стратегии">
        {cards.map((s, idx) => <StrategyCard key={s.node.key} s={s} open={idx === 0} />)}
      </ul>

      <section aria-labelledby="pb-str-matrix" className={CARD}>
        <h3 id="pb-str-matrix" className="font-headline text-base font-bold text-on-surface">Матрица «влияние × усилие»</h3>
        <p className="mb-3 mt-0.5 text-xs text-on-surface-variant">Подсказка, с чего начать: сверху слева — большое влияние при умеренном усилии. Оценки ставит эксперт.</p>
        <MatrixChart matrix={strategy.matrix} />
      </section>
    </div>
  )
}

export default function StrategyTab({ snap, onRetry }: { snap: PointBStateSnapshot; onRetry?: () => void }) {
  const today = useMemo(() => todayIso(), [])
  const mode = strategyMode(snap)
  if (mode === 'loading') return <SectionSkeleton label="Загружаем стратегию" />
  if (mode === 'error') return <SectionError message={snap.error ?? 'Нет данных'} onRetry={onRetry} />
  if (mode === 'ready' && snap.strategy) return <StrategyView strategy={snap.strategy} today={today} planVersion={snap.plan.version} />
  return mode === 'empty' ? <StrategyEmpty /> : <StrategyPreparing />
}
