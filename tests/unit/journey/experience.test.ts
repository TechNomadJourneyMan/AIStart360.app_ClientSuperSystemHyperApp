import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEmptyWorkspace } from '@/components/journey/model'
import {
  JourneyExperience,
  getCurrentConfirmedJourneyGoal,
  getJourneyExperienceStage,
  getJourneyExperienceSummary,
  isJourneyConversationFirst,
} from '@/components/journey/JourneyExperience'

function state() {
  return createEmptyWorkspace('journey-experience-test')
}

const confirmedFact = {
  id: 'fact-business',
  label: 'Формат',
  value: 'Магазин помидоров',
  category: 'business' as const,
  sourceLabel: 'Пользователь',
  status: 'confirmed' as const,
}

const measurableGoal = {
  id: 'goal-stores',
  title: 'Открыть пять магазинов помидоров',
  metric: 'Количество магазинов',
  target: '5 магазинов',
  deadline: '31 декабря 2027',
  status: 'confirmed' as const,
}

const roadmapItem = {
  id: 'roadmap-economics',
  title: 'Подтвердить экономику первой точки',
  description: 'Собрать подтверждённые продажи и затраты.',
  horizon: '0–30 дней',
  progress: 0,
  status: 'next' as const,
}

describe('Journey first-conversation experience', () => {
  it('moves through describe, confirm, goal and ready using only confirmed state', () => {
    const empty = state()
    expect(getJourneyExperienceStage(empty)).toBe('describe')

    const awaitingConfirmation = {
      ...empty,
      facts: [{ ...confirmedFact, id: 'fact-pending', status: 'pending' as const }],
    }
    expect(getJourneyExperienceStage(awaitingConfirmation)).toBe('confirm')

    const pointA = { ...empty, facts: [confirmedFact] }
    expect(getJourneyExperienceStage(pointA)).toBe('goal')

    const ready = { ...pointA, goals: [measurableGoal], roadmap: [roadmapItem], phase: 'ready' as const }
    expect(getJourneyExperienceStage(ready)).toBe('ready')
  })

  it('keeps conversation first until a ready state, excluding non-actionable loading and error states', () => {
    expect(isJourneyConversationFirst(state())).toBe(true)
    expect(isJourneyConversationFirst({ ...state(), phase: 'analyzing' })).toBe(true)
    expect(isJourneyConversationFirst({ ...state(), phase: 'loading' })).toBe(false)
    expect(isJourneyConversationFirst({ ...state(), phase: 'error' })).toBe(false)
    expect(isJourneyConversationFirst({
      ...state(),
      phase: 'ready',
      facts: [confirmedFact],
      goals: [measurableGoal],
      roadmap: [roadmapItem],
    })).toBe(false)
  })

  it('trusts the derived stage when a stale ready phase still has a pending fact', () => {
    const staleReady = {
      ...state(),
      phase: 'ready' as const,
      facts: [{ ...confirmedFact, id: 'fact-pending', status: 'pending' as const }],
      goals: [measurableGoal],
      roadmap: [roadmapItem],
    }

    expect(getJourneyExperienceStage(staleReady)).toBe('confirm')
    expect(isJourneyConversationFirst(staleReady)).toBe(true)
  })

  it('does not expose rejected facts in the chat summary', () => {
    const summary = getJourneyExperienceSummary({
      ...state(),
      facts: [
        confirmedFact,
        {
          ...confirmedFact,
          id: 'fact-rejected',
          label: 'Отклонённый факт',
          value: 'Нельзя показывать',
          status: 'rejected',
        },
      ],
    })

    expect(summary.facts).toEqual([confirmedFact])
    expect(summary.facts.some((fact) => fact.status === 'rejected')).toBe(false)
  })

  it('keeps Point B target alongside metric and deadline in the grounded summary', () => {
    const summary = getJourneyExperienceSummary({ ...state(), goals: [measurableGoal] })

    expect(summary.goal).toMatchObject({
      metric: 'Количество магазинов',
      target: '5 магазинов',
      deadline: '31 декабря 2027',
    })
  })

  it('selects the latest confirmed goal as the current Point B revision', () => {
    const currentGoal = {
      ...measurableGoal,
      id: 'goal-current',
      title: 'Открыть семь магазинов помидоров',
      target: '7 магазинов',
      deadline: '31 декабря 2028',
    }
    const withRevisions = {
      ...state(),
      goals: [
        measurableGoal,
        { ...measurableGoal, id: 'goal-draft', target: '10 магазинов', status: 'draft' as const },
        currentGoal,
      ],
    }

    expect(getCurrentConfirmedJourneyGoal(withRevisions)).toEqual(currentGoal)
    expect(getJourneyExperienceSummary(withRevisions).goal).toEqual(currentGoal)
  })

  it('prioritizes the explicit next roadmap item over insertion order', () => {
    const summary = getJourneyExperienceSummary({
      ...state(),
      roadmap: [{ ...roadmapItem, id: 'later', status: 'planned' }, roadmapItem],
    })

    expect(summary.nextRoadmapItem).toEqual(roadmapItem)
  })

  it('announces the current, completed and upcoming progress states', () => {
    const markup = renderToStaticMarkup(createElement(JourneyExperience, {
      state: { ...state(), facts: [{ ...confirmedFact, status: 'pending' }] },
    }))

    expect(markup).toContain('aria-current="step"')
    expect(markup).toContain('завершено')
    expect(markup).toContain('текущий шаг')
    expect(markup).toContain('предстоит')
  })
})
