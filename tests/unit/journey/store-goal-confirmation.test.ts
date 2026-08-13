import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JourneyExperience } from '@/components/journey/JourneyExperience'
import {
  confirmDraftJourneyGoal,
  deterministicOrchestrator,
} from '@/lib/journey/demo'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import {
  isExplicitStorePointBConfirmation,
  STORE_POINT_B_CONFIRMATION_MESSAGE,
} from '@/lib/journey/store-goal-contract'
import {
  getLatestCompleteStoreDraftGoal,
  requireStoreGoalConfirmation,
} from '@/lib/journey/store-goal-confirmation'
import type { StoreOverview } from '@/lib/store/types'

const GOAL = 'Хочу увеличить выручку до 50 млн ₸ за 6 месяцев'

describe('Store Point B explicit confirmation policy', () => {
  it('keeps a first measurable Store goal as a draft without a transformation plan', () => {
    const current = storeState()
    const ordinaryJourneyResult = deterministicOrchestrator(current, GOAL)
    expect(ordinaryJourneyResult.phase).toBe('ready')
    expect(ordinaryJourneyResult.goals[0]?.status).toBe('confirmed')

    const draftState = requireStoreGoalConfirmation(current, ordinaryJourneyResult)
    const draft = getLatestCompleteStoreDraftGoal(draftState)

    expect(draft).toMatchObject({
      title: GOAL,
      metric: 'Выручка',
      target: '50 млн ₸',
      deadline: '6 месяцев',
      status: 'draft',
    })
    expect(draftState.phase).toBe('partial')
    expect(draftState.roadmap).toEqual(current.roadmap)
    expect(draftState.widgets).toEqual(current.widgets)
    expect(draftState.widgets.some((widget) => widget.kind === 'point_b_goals')).toBe(false)
    expect(draftState.suggestions).toContainEqual(expect.objectContaining({
      label: 'Подтвердить Точку B',
      value: STORE_POINT_B_CONFIRMATION_MESSAGE,
    }))
    expect(draftState.messages.at(-1)?.text).toContain('отдельного подтверждения')
  })

  it('builds the canonical plan only after confirming the existing draft', () => {
    const current = storeState()
    const draftState = requireStoreGoalConfirmation(
      current,
      deterministicOrchestrator(current, GOAL),
    )
    const draft = getLatestCompleteStoreDraftGoal(draftState)
    if (!draft) throw new Error('draft missing')

    const confirmed = confirmDraftJourneyGoal(
      draftState,
      draft.id,
      STORE_POINT_B_CONFIRMATION_MESSAGE,
    )

    expect(confirmed.phase).toBe('ready')
    expect(confirmed.goals).toContainEqual(expect.objectContaining({
      id: draft.id,
      status: 'confirmed',
    }))
    expect(confirmed.goals.some((goal) => goal.status === 'draft')).toBe(false)
    expect(confirmed.roadmap.length).toBeGreaterThan(1)
    expect(confirmed.widgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'point_b_goals' }),
      expect.objectContaining({ kind: 'roadmap_actions' }),
    ]))
    expect(confirmed.messages.at(-2)?.text).toBe(STORE_POINT_B_CONFIRMATION_MESSAGE)
  })

  it('blocks a same-id draft-to-confirmed flip before explicit confirmation', () => {
    const current = storeState()
    const firstDraft = requireStoreGoalConfirmation(
      current,
      deterministicOrchestrator(current, GOAL),
    )
    const draft = getLatestCompleteStoreDraftGoal(firstDraft)
    if (!draft) throw new Error('draft missing')
    const attemptedFlip = {
      ...firstDraft,
      phase: 'ready' as const,
      goals: firstDraft.goals.map((goal) => goal.id === draft.id
        ? { ...goal, title: 'Подменённая цель', target: '999 млн ₸', status: 'confirmed' as const }
        : goal),
      roadmap: deterministicOrchestrator(firstDraft, GOAL).roadmap,
    }

    const protectedState = requireStoreGoalConfirmation(firstDraft, attemptedFlip)
    expect(protectedState.phase).toBe('partial')
    expect(protectedState.goals).toContainEqual(draft)
    expect(protectedState.goals.some((goal) => goal.status === 'confirmed')).toBe(false)
    expect(protectedState.roadmap).toEqual(firstDraft.roadmap)
  })

  it('preserves a reviewed draft and strips a later AI plan before confirmation', () => {
    const current = storeState()
    const draftState = requireStoreGoalConfirmation(
      current,
      deterministicOrchestrator(current, GOAL),
    )
    const draft = getLatestCompleteStoreDraftGoal(draftState)
    if (!draft) throw new Error('draft missing')
    const arbitraryPlan = deterministicOrchestrator(current, GOAL)
    const proposed = {
      ...draftState,
      phase: 'ready' as const,
      goals: draftState.goals.map((goal) => goal.id === draft.id
        ? { ...goal, title: 'Переписано AI', target: '999 млн ₸' }
        : goal),
      roadmap: arbitraryPlan.roadmap,
      widgets: arbitraryPlan.widgets,
    }

    const protectedState = requireStoreGoalConfirmation(draftState, proposed)
    expect(protectedState.phase).toBe('partial')
    expect(protectedState.goals).toContainEqual(draft)
    expect(protectedState.goals).not.toContainEqual(expect.objectContaining({ title: 'Переписано AI' }))
    expect(protectedState.roadmap).toEqual(draftState.roadmap)
    expect(protectedState.widgets).toEqual(draftState.widgets)
  })

  it('requires an unambiguous Point B phrase and renders a clear confirmation action', () => {
    expect(isExplicitStorePointBConfirmation(STORE_POINT_B_CONFIRMATION_MESSAGE)).toBe(true)
    expect(isExplicitStorePointBConfirmation('Подтверждаю точку Б.')).toBe(true)
    expect(isExplicitStorePointBConfirmation('Да')).toBe(false)
    expect(isExplicitStorePointBConfirmation('Подтверждаю')).toBe(false)

    const current = storeState()
    const draftState = requireStoreGoalConfirmation(
      current,
      deterministicOrchestrator(current, GOAL),
    )
    const html = renderToStaticMarkup(createElement(JourneyExperience, {
      state: draftState,
      context: 'store',
      onConfirmGoal: () => undefined,
      onDraftRequest: () => undefined,
    }))

    expect(html).toContain('Черновик Точки B')
    expect(html).toContain('Точка B · черновик')
    expect(html).toContain('Показатель')
    expect(html).toContain('Цель')
    expect(html).toContain('Срок')
    expect(html).toContain('Подтвердить Точку B')
    expect(html).toContain('Изменить формулировку')
  })
})

function storeState() {
  return buildStoreJourneyState(overview(), {
    workspaceId: 'journey-store-confirmation-test',
    now: '2026-08-13T08:00:00.000Z',
  })
}

function overview(): StoreOverview {
  return {
    source: 'operational',
    confidence: 'complete',
    companyName: 'HONOR / MyHonor',
    period: { from: '2026-07-01', to: '2026-07-31' },
    asOf: '2026-08-07',
    versionLabel: 'Продажи · 12.08.2026',
    availability: { sales: true, inventory: true, prices: true },
    metrics: {
      revenue: 28_053_253,
      cost: 17_139_974.46,
      grossProfit: 10_913_278.54,
      grossMarginPct: 38.902024,
      listRevenue: 42_082_620,
      discount: 14_029_367,
      discountRatePct: 33.337668,
      units: 1_324,
      returns: 9,
    },
    catalog: { products: 1_365, activeProducts: 1_365, latest: [] },
    inventory: {
      availableUnits: 62_039,
      reservedUnits: 0,
      inventoryCost: 221_500_000,
      inventoryRetail: 365_000_000,
      warehouses: [],
    },
    channels: [],
    alerts: [],
    limitations: [],
  }
}
