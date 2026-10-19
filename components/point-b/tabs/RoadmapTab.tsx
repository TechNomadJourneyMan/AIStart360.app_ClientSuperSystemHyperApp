'use client'

/**
 * components/point-b/tabs/RoadmapTab.tsx — the «Дорожная карта» tab (plan Ф5 Task 5, spec §11): the timeline
 * by quarters (bars of strategies and initiatives over the dates of their tasks, diamonds for milestones, a line
 * for today), the list of milestones with the date and KPI, what waits for what, and the tasks by quarter with their
 * statuses. Same source as «Стратегия»: the APPROVED plan version only.
 *
 * On a phone the timeline is not drawn: the per-quarter list carries the same information (and it is also the text
 * alternative of the chart on a wide screen). Nothing is invented: no dates → an honest placeholder.
 */
import { useMemo } from 'react'
import { CARD, CARD_TITLE, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import TimelineChart from '../TimelineChart'
import { DASH } from '../overviewModel'
import type { PointBStateSnapshot } from '../pointBStateController'
import {
  KIND_LABEL, buildRoadmap, fmtDay, roadmapSummary, strategyMode, todayIso,
  type PointBStrategyState, type Roadmap, type RoadmapItem,
} from '../strategyModel'
import { SectionError, SectionSkeleton } from './OverviewTab'
import { ActionPlanLink, StateChip, StrategyEmpty, StrategyPreparing } from './StrategyTab'

const ITEM_ICON: Record<RoadmapItem['type'], string> = { milestone: 'flag', strategy: 'flag_circle', initiative: 'rocket_launch', task: 'task_alt' }
const ITEM_WORD: Record<RoadmapItem['type'], string> = { milestone: 'Контрольная точка', strategy: KIND_LABEL.strategy, initiative: KIND_LABEL.initiative, task: KIND_LABEL.task }

const STATUS_TONE = {
  done: 'bg-primary/[0.14] text-primary',
  in_progress: 'bg-secondary/[0.14] text-secondary',
  open: 'bg-white/[0.06] text-on-surface-variant',
  missing: 'bg-white/[0.04] text-on-surface-variant',
  unknown: 'bg-white/[0.04] text-on-surface-variant',
} as const

function ItemLine({ item }: { item: RoadmapItem }) {
  return (
    <li className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <Icon name={ITEM_ICON[item.type]} className={cn('mt-0.5 text-xl', item.type === 'milestone' ? 'text-tertiary-fixed-dim' : 'text-on-surface-variant')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-medium text-on-surface">{item.title || DASH}</p>
          <span className="flex flex-wrap items-center gap-1.5">
            {item.status?.overdue && <span className={cn(CHIP, 'bg-error/[0.14] normal-case tracking-normal text-error')}>просрочена</span>}
            {item.status && <span className={cn(CHIP, 'normal-case tracking-normal', STATUS_TONE[item.status.key])}>{item.status.label}</span>}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-on-surface-variant">
          {ITEM_WORD[item.type]} · <time dateTime={item.date ?? undefined}>{fmtDay(item.date)}</time>
          {item.context ? ` · ${item.context}` : ''}
          {item.owner ? ` · ${item.owner}` : ''}
        </p>
        {item.kpi && <p className="mt-0.5 text-xs text-on-surface-variant">KPI: <span className="text-on-surface">{item.kpi}</span></p>}
        {item.description && item.type === 'milestone' && <p className="mt-0.5 break-words text-xs text-on-surface-variant">{item.description}</p>}
      </div>
    </li>
  )
}

export function RoadmapView({ strategy, today }: { strategy: PointBStrategyState; today: string }) {
  const roadmap: Roadmap = buildRoadmap(strategy, today)
  const hasTasks = roadmap.byQuarter.some((q) => q.items.some((i) => i.type === 'task'))

  return (
    <div className="space-y-5">
      <section aria-labelledby="pb-rm-timeline" className={CARD}>
        <h2 id="pb-rm-timeline" className="font-headline text-base font-bold text-on-surface">Таймлайн по кварталам</h2>
        {roadmap.hasDates ? (
          <>
            <p className="mb-3 mt-0.5 text-xs text-on-surface-variant">{roadmapSummary(roadmap)}</p>
            {/* A wide screen: the chart. A phone: the quarter list below is the timeline. */}
            <div className="hidden md:block"><TimelineChart roadmap={roadmap} /></div>
            <p className="text-xs text-on-surface-variant md:hidden">На телефоне таймлайн показан списком по кварталам — ниже.</p>
            {roadmap.outside > 0 && (
              <p role="note" className="mt-2 text-xs text-on-surface-variant">
                Показаны не все кварталы: {roadmap.outside} {roadmap.outside === 1 ? 'пункт со сроком' : 'пунктов со сроком'} за границами графика есть только в списке ниже.
              </p>
            )}
          </>
        ) : (
          <p role="note" className="mt-2 rounded-xl border border-dashed border-white/[0.1] p-4 text-sm text-on-surface-variant">
            <Icon name="event_busy" className="mr-1.5 align-middle text-xl text-on-surface-variant/60" />
            На дорожной карте пока нет сроков: ни у задач, ни у контрольных точек не указаны даты. Эксперт расставит их при следующем обновлении плана.
          </p>
        )}
      </section>

      <section aria-labelledby="pb-rm-milestones" className={CARD}>
        <h3 id="pb-rm-milestones" className="font-headline text-base font-bold text-on-surface">Этапы и контрольные точки</h3>
        {roadmap.milestones.length === 0 ? (
          <p className="mt-2 text-sm text-on-surface-variant">Контрольные точки пока не заданы.</p>
        ) : (
          <ol className="mt-3 space-y-2" aria-label="Контрольные точки по дате">
            {roadmap.milestones.map((m) => <ItemLine key={m.id} item={m} />)}
          </ol>
        )}
      </section>

      {roadmap.dependencies.length > 0 && (
        <section aria-labelledby="pb-rm-deps" className={CARD}>
          <h3 id="pb-rm-deps" className="font-headline text-base font-bold text-on-surface">Зависимости</h3>
          <p className="mt-0.5 text-xs text-on-surface-variant">Что нельзя довести до конца, пока не сделано другое.</p>
          <ul className="mt-3 space-y-1.5">
            {roadmap.dependencies.map((d) => (
              <li key={d.key} className="flex items-start gap-2 text-sm text-on-surface">
                <Icon name={d.resolved ? 'check_circle' : 'hourglass_top'} className={cn('mt-0.5 text-lg', d.resolved ? 'text-primary' : 'text-secondary')} />
                <span className="min-w-0 break-words">{d.text}{d.resolved ? ' — выполнено, можно двигаться' : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="pb-rm-quarters" className="space-y-3">
        <div>
          <h3 id="pb-rm-quarters" className="font-headline text-base font-bold text-on-surface">По кварталам</h3>
          <p className="mt-0.5 text-xs text-on-surface-variant">Контрольные точки, сроки инициатив и задачи. Статус задачи берётся из вашего плана действий.</p>
        </div>
        {roadmap.byQuarter.map(({ quarter, items, isCurrent }) => (
          <section key={quarter.key} aria-label={quarter.label} className={cn(CARD, '!p-4', isCurrent && 'border-primary/40')}>
            <h4 className="flex items-center gap-2 text-sm font-semibold text-on-surface">
              {quarter.label}
              {isCurrent && <span className={cn(CHIP, 'bg-primary/[0.12] normal-case tracking-normal text-primary')}>сейчас</span>}
            </h4>
            {items.length === 0 ? (
              <p className="mt-1.5 text-xs text-on-surface-variant">В этом квартале ничего не запланировано.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {items.map((i) => <ItemLine key={`${i.type}-${i.id}`} item={i} />)}
              </ul>
            )}
          </section>
        ))}
        {roadmap.undated.length > 0 && (
          <section aria-label="Без срока" className={cn(CARD, '!p-4')}>
            <h4 className="text-sm font-semibold text-on-surface">Без срока</h4>
            <p className="mt-0.5 text-xs text-on-surface-variant">Эксперт ещё не назначил срок этим задачам.</p>
            <ul className="mt-2 space-y-2">
              {roadmap.undated.map((i) => <ItemLine key={`${i.type}-${i.id}`} item={i} />)}
            </ul>
          </section>
        )}
        {hasTasks && <ActionPlanLink />}
      </section>

      <section aria-labelledby="pb-rm-progress" className={CARD}>
        <h3 id="pb-rm-progress" className="font-headline text-base font-bold text-on-surface">Состояние стратегий и инициатив</h3>
        <ul className="mt-3 space-y-1.5">
          {roadmap.rows.map((r) => (
            <li key={r.key} className={cn('flex flex-wrap items-center justify-between gap-2 text-sm', r.kind === 'initiative' && 'pl-4')}>
              <span className={cn('min-w-0 break-words', r.kind === 'strategy' ? 'font-semibold text-on-surface' : 'text-on-surface')}>{r.title || DASH}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-on-surface-variant">{r.start && r.end ? (r.start === r.end ? fmtDay(r.start) : `${fmtDay(r.start)} – ${fmtDay(r.end)}`) : 'без срока'}</span>
                <StateChip view={r.progress} />
              </span>
            </li>
          ))}
        </ul>
        <p className={cn(CARD_TITLE, 'mt-3 normal-case tracking-normal')}>Выполнено считается по задачам из плана действий.</p>
      </section>
    </div>
  )
}

export default function RoadmapTab({ snap, onRetry }: { snap: PointBStateSnapshot; onRetry?: () => void }) {
  const today = useMemo(() => todayIso(), [])
  const mode = strategyMode(snap)
  if (mode === 'loading') return <SectionSkeleton label="Загружаем дорожную карту" />
  if (mode === 'error') return <SectionError message={snap.error ?? 'Нет данных'} onRetry={onRetry} />
  if (mode === 'ready' && snap.strategy) return <RoadmapView strategy={snap.strategy} today={today} />
  return mode === 'empty' ? <StrategyEmpty /> : <StrategyPreparing />
}
