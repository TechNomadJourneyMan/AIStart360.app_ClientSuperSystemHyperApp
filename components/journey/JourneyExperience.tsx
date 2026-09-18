'use client'

import {
  Check,
  ChevronRight,
  Circle,
  Map,
  MessageCircle,
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JourneyWorkspaceView } from './model'

/** The small, user-facing milestones of the first Journey conversation. */
export type JourneyExperienceStage = 'describe' | 'confirm' | 'goal' | 'ready'

export interface JourneyExperienceSummary {
  facts: JourneyWorkspaceView['facts']
  goal: JourneyWorkspaceView['goals'][number] | null
  nextRoadmapItem: JourneyWorkspaceView['roadmap'][number] | null
}

export interface JourneyExperienceProps {
  state: JourneyWorkspaceView
  /** Sends a short, editable prompt into the existing chat composer. */
  onDraftRequest?: (text: string) => void
  /** Opens or focuses the existing A → B board. */
  onOpenBoard?: () => void
  className?: string
}

const STEPS: Array<{ stage: JourneyExperienceStage; label: string }> = [
  { stage: 'describe', label: 'Бизнес' },
  { stage: 'confirm', label: 'Точка A' },
  { stage: 'goal', label: 'Точка B' },
  { stage: 'ready', label: 'Первый шаг' },
]

const STAGE_INDEX: Record<JourneyExperienceStage, number> = {
  describe: 0,
  confirm: 1,
  goal: 2,
  ready: 3,
}

const DRAFT_REQUEST: Record<JourneyExperienceStage, string> = {
  describe: 'Помоги описать мой бизнес: продукт, клиентов и текущую ситуацию.',
  confirm: 'Покажи, какие факты о Точке A нужно подтвердить или исправить.',
  goal: 'Помоги сформулировать измеримую Точку B: метрику, цель и срок.',
  ready: 'Давай подробно разберём следующее действие из дорожной карты.',
}

/**
 * Uses only human-validated state: pending facts always take priority so the
 * user is not rushed past confirmation, and a ready state needs a complete,
 * confirmed Point B plus at least one roadmap item.
 */
export function getJourneyExperienceStage(state: JourneyWorkspaceView): JourneyExperienceStage {
  const hasConfirmedFact = state.facts.some((fact) => fact.status === 'confirmed')
  const hasPendingFact = state.facts.some((fact) => fact.status === 'pending')
  const currentGoal = getCurrentConfirmedJourneyGoal(state)
  const hasMeasurableConfirmedGoal = Boolean(
    currentGoal?.metric?.trim() && currentGoal.target?.trim() && currentGoal.deadline?.trim(),
  )

  if (!hasConfirmedFact && !hasPendingFact) return 'describe'
  if (hasPendingFact) return 'confirm'
  if (hasMeasurableConfirmedGoal && state.roadmap.length > 0) return 'ready'
  return 'goal'
}

/**
 * Conversation leads while it can materially establish the business context.
 * Loading/error are intentionally excluded: neither is an actionable dialog
 * state, and ready moves attention to the next concrete action on the board.
 */
export function isJourneyConversationFirst(state: JourneyWorkspaceView): boolean {
  if (state.phase === 'loading' || state.phase === 'error') return false
  return getJourneyExperienceStage(state) !== 'ready'
}

/**
 * Goal updates are appended by the merge layer, so the final confirmed entry
 * is the current human-validated revision. Drafts never replace it.
 */
export function getCurrentConfirmedJourneyGoal(
  state: JourneyWorkspaceView,
): JourneyWorkspaceView['goals'][number] | null {
  for (let index = state.goals.length - 1; index >= 0; index -= 1) {
    const goal = state.goals[index]
    if (goal?.status === 'confirmed') return goal
  }
  return null
}

/** Returns only facts and plans already stored in the Journey state. */
export function getJourneyExperienceSummary(state: JourneyWorkspaceView): JourneyExperienceSummary {
  const facts = state.facts.filter((fact) => fact.status === 'confirmed')
  const goal = getCurrentConfirmedJourneyGoal(state)
  const nextRoadmapItem = state.roadmap.find((item) => item.status === 'next') ?? state.roadmap[0] ?? null

  return { facts, goal, nextRoadmapItem }
}

export function JourneyExperience({
  state,
  onDraftRequest,
  onOpenBoard,
  className,
}: JourneyExperienceProps) {
  const stage = getJourneyExperienceStage(state)
  const summary = getJourneyExperienceSummary(state)
  const currentStep = STAGE_INDEX[stage]

  return (
    <section
      aria-label="Путь первого разговора"
      className={cn('space-y-3 rounded-2xl border border-white/10 bg-surface-container-low p-3', className)}
      data-stage={stage}
    >
      <ol aria-label="Прогресс настройки" className="grid grid-cols-4 gap-1.5">
        {STEPS.map((step, index) => {
          const complete = index < currentStep
          const active = index === currentStep

          return (
            <li
              key={step.stage}
              aria-current={active ? 'step' : undefined}
              className="min-w-0"
            >
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                    complete && 'border-primary bg-primary text-on-primary',
                    active && 'border-primary text-primary',
                    !complete && !active && 'border-white/15 text-on-surface-variant',
                  )}
                >
                  {complete ? <Check className="size-3" /> : index + 1}
                </span>
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={cn('h-px min-w-0 flex-1', complete ? 'bg-primary' : 'bg-white/10')}
                  />
                )}
              </div>
              <span className={cn('mt-1 block truncate text-[10px]', active ? 'font-medium text-on-surface' : 'text-on-surface-variant')}>
                {step.label}
                <span className="sr-only">
                  {' — '}
                  {complete ? 'завершено' : active ? 'текущий шаг' : 'предстоит'}
                </span>
              </span>
            </li>
          )
        })}
      </ol>

      <JourneyGroundedSummary summary={summary} />

      <div className="flex flex-wrap gap-2 pt-0.5">
        {onDraftRequest && (
          <button
            type="button"
            onClick={() => onDraftRequest(DRAFT_REQUEST[stage])}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-on-primary transition-colors hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low"
          >
            <MessageCircle className="size-3.5" aria-hidden />
            {stage === 'ready' ? 'Обсудить шаг' : 'Продолжить с AI'}
          </button>
        )}
        {onOpenBoard && (
          <button
            type="button"
            onClick={onOpenBoard}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-white/5 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Map className="size-3.5" aria-hidden />
            Открыть доску
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </section>
  )
}

function JourneyGroundedSummary({ summary }: { summary: JourneyExperienceSummary }) {
  const goalDetails = [summary.goal?.metric, summary.goal?.target, summary.goal?.deadline]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' · ')

  return (
    <div className="grid gap-2 sm:grid-cols-3" aria-label="Подтверждённый контекст">
      <SummaryItem
        icon={Circle}
        title="Точка A"
        value={summary.facts.length ? summary.facts.map((fact) => `${fact.label}: ${fact.value}`).join(' · ') : 'Пока нет подтверждённых фактов'}
      />
      <SummaryItem
        icon={Target}
        title="Точка B"
        value={summary.goal ? goalDetails || summary.goal.title : 'Уточните измеримую цель'}
        detail={summary.goal && goalDetails ? summary.goal.title : undefined}
      />
      <SummaryItem
        icon={ChevronRight}
        title="Следующий шаг"
        value={summary.nextRoadmapItem?.title ?? 'Появится после Точки B'}
        detail={summary.nextRoadmapItem?.horizon}
      />
    </div>
  )
}

function SummaryItem({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof Circle
  title: string
  value: string
  detail?: string
}) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-container-highest/50 px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">
        <Icon className="size-3" aria-hidden />
        {title}
      </p>
      <p className="mt-1 line-clamp-2 text-xs font-medium text-on-surface">{value}</p>
      {detail && <p className="mt-0.5 truncate text-[10px] text-on-surface-variant">{detail}</p>}
    </div>
  )
}
