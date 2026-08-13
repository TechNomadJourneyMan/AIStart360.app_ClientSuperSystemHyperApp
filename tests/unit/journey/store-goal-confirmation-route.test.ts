import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deterministicOrchestrator } from '@/lib/journey/demo'
import { redactStoreJourneyState } from '@/lib/journey/store-context'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import { STORE_POINT_B_CONFIRMATION_MESSAGE } from '@/lib/journey/store-goal-contract'
import { requireStoreGoalConfirmation } from '@/lib/journey/store-goal-confirmation'
import type { JourneyState } from '@/lib/journey/schema'
import type { StoreOverview } from '@/lib/store/types'

const ACTOR = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
const WORKSPACE = `journey-store-user-${ACTOR}`
const GOAL = 'Хочу увеличить выручку до 50 млн ₸ за 6 месяцев'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  append: vi.fn(),
  orchestrate: vi.fn(),
}))

vi.mock('@/lib/journey/store-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/store-context')>(
    '@/lib/journey/store-context',
  )
  return { ...actual, resolveStoreJourneyContext: mocks.context }
})

vi.mock('@/lib/journey/persistence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/persistence')>(
    '@/lib/journey/persistence',
  )
  return {
    ...actual,
    loadJourneyState: mocks.load,
    saveJourneyState: mocks.save,
    appendJourneyMessages: mocks.append,
  }
})

vi.mock('@/lib/journey/orchestrator', () => ({ orchestrateJourneyTurn: mocks.orchestrate }))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimited: vi.fn().mockResolvedValue(false),
  isRateLimitedKey: vi.fn().mockResolvedValue(false),
}))

import { PATCH } from '@/app/api/v1/journey/store/route'
import { POST } from '@/app/api/v1/journey/store/chat/route'

describe('POST /api/v1/journey/store/chat Point B confirmation', () => {
  let live: JourneyState

  beforeEach(() => {
    vi.clearAllMocks()
    const storeOverview = overview()
    live = buildStoreJourneyState(storeOverview, { workspaceId: WORKSPACE })
    mocks.context.mockResolvedValue({ userId: ACTOR, overview: storeOverview })
    mocks.load.mockResolvedValue({
      state: redactStoreJourneyState(schemaSafeState(live)),
      persistence: { mode: 'database', label: 'Сохранено' },
    })
    mocks.save.mockImplementation(async (_identity, state: JourneyState) => ({
      state,
      persistence: { mode: 'database', label: 'Сохранено' },
    }))
    mocks.append.mockResolvedValue(undefined)
    mocks.orchestrate.mockImplementation(async (state: JourneyState, message: string) => ({
      state: schemaSafeState(deterministicOrchestrator(state, message)),
      mode: 'demo' as const,
      fallbackReason: 'missing_key' as const,
    }))
  })

  it('returns and persists a draft on the first measurable-goal turn', async () => {
    const response = await POST(request(schemaSafeState(live), GOAL))
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(mocks.orchestrate).toHaveBeenCalledTimes(1)
    expect(body.state.phase).toBe('partial')
    expect(body.state.goals).toContainEqual(expect.objectContaining({
      title: GOAL,
      status: 'draft',
    }))
    expect(body.state.roadmap.every((item: { title: string }) => (
      live.roadmap.some((liveItem) => liveItem.title === item.title)
    ))).toBe(true)
    expect(body.state.widgets.some((widget: { kind: string }) => widget.kind === 'point_b_goals')).toBe(false)
    expect(body.state.messages.at(-1)?.text).toContain('Точка B записана как черновик')

    const persisted = mocks.save.mock.calls[0]?.[1] as JourneyState
    expect(persisted.goals.at(-1)?.status).toBe('draft')
    expect(persisted.roadmap.every((item) => (
      live.roadmap.some((liveItem) => liveItem.title === item.title)
    ))).toBe(true)
  })

  it('confirms the persisted draft and builds A→B without another AI turn', async () => {
    const generatedDraft = requireStoreGoalConfirmation(live, deterministicOrchestrator(live, GOAL))
    const draft = schemaSafeState(generatedDraft)
    const redactedDraft = redactStoreJourneyState(draft)
    mocks.load.mockResolvedValue({
      state: redactedDraft,
      persistence: { mode: 'database', label: 'Сохранено' },
    })
    const response = await POST(request(draft, STORE_POINT_B_CONFIRMATION_MESSAGE))
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(mocks.orchestrate).not.toHaveBeenCalled()
    expect(body.state.phase).toBe('ready')
    expect(body.state.goals.at(-1)).toEqual(expect.objectContaining({ status: 'confirmed' }))
    expect(body.state.roadmap.some((item: { id: string }) => !item.id.startsWith('roadmap:store:'))).toBe(true)
    expect(body.state.widgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'point_b_goals', collapsed: true }),
      expect.objectContaining({ kind: 'roadmap_actions', collapsed: true }),
    ]))
    expect(body.state.widgets.filter((widget: { id: string; collapsed: boolean }) => (
      widget.id.startsWith('widget:store:') && !widget.collapsed
    ))).toHaveLength(4)
    expect(body.state.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      text: STORE_POINT_B_CONFIRMATION_MESSAGE,
    }))
  })

  it('rejects a confirmation when no reviewed draft was persisted', async () => {
    const response = await POST(request(live, STORE_POINT_B_CONFIRMATION_MESSAGE))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('STORE_GOAL_CONFIRMATION_REQUIRED')
    expect(mocks.orchestrate).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not skip a newer incomplete draft to confirm an older goal', async () => {
    const complete = requireStoreGoalConfirmation(live, deterministicOrchestrator(live, GOAL))
    const withNewerIncomplete = schemaSafeState({
      ...complete,
      goals: [
        ...complete.goals,
        {
          id: 'goal-newer-incomplete',
          title: 'Увеличить продажи',
          status: 'draft' as const,
        },
      ],
    })
    mocks.load.mockResolvedValue({
      state: redactStoreJourneyState(withNewerIncomplete),
      persistence: { mode: 'database', label: 'Сохранено' },
    })

    const response = await POST(request(withNewerIncomplete, STORE_POINT_B_CONFIRMATION_MESSAGE))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('STORE_GOAL_CONFIRMATION_REQUIRED')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('ignores a confirmed goal smuggled through PATCH', async () => {
    const confirmed = schemaSafeState(deterministicOrchestrator(live, GOAL))
    const response = await PATCH(request(confirmed, '', 'PATCH'))
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.state.phase).toBe('partial')
    expect(body.state.goals).toEqual([])
    expect(body.state.widgets.some((widget: { kind: string }) => widget.kind === 'point_b_goals')).toBe(false)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('ignores a draft with a transformation plan smuggled through PATCH', async () => {
    const planned = schemaSafeState(deterministicOrchestrator(live, GOAL))
    const draftWithPlan = schemaSafeState({
      ...planned,
      phase: 'partial',
      goals: planned.goals.map((goal) => ({ ...goal, status: 'draft' as const })),
    })
    const response = await PATCH(request(draftWithPlan, '', 'PATCH'))
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.state.goals).toEqual([])
    expect(body.state.roadmap.every((item: { id: string }) => item.id.startsWith('roadmap:store:')))
      .toBe(true)
    expect(body.state.widgets.some((widget: { kind: string }) => (
      widget.kind === 'point_b_goals' || widget.kind === 'roadmap_actions'
    ))).toBe(false)

    const persisted = mocks.save.mock.calls[0]?.[1] as JourneyState
    expect(persisted.goals).toEqual([])
    expect(persisted.roadmap).toEqual([])
    expect(persisted.widgets.some((widget) => (
      widget.kind === 'point_b_goals' || widget.kind === 'roadmap_actions'
    ))).toBe(false)
  })

  it('ignores a browser-smuggled confirmed goal as chat context', async () => {
    const smuggled = schemaSafeState(deterministicOrchestrator(live, GOAL))
    const question = 'Какие данные нужны для первого шага?'
    const response = await POST(request(smuggled, question))
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(mocks.orchestrate).toHaveBeenCalledTimes(1)
    const orchestratorState = mocks.orchestrate.mock.calls[0]?.[0] as JourneyState
    expect(orchestratorState.goals).toEqual([])
    expect(body.state.goals).toEqual([])
  })

  it('strips a later AI roadmap while the persisted Point B is still a draft', async () => {
    const draft = schemaSafeState(requireStoreGoalConfirmation(
      live,
      deterministicOrchestrator(live, GOAL),
    ))
    mocks.load.mockResolvedValue({
      state: redactStoreJourneyState(draft),
      persistence: { mode: 'database', label: 'Сохранено' },
    })
    mocks.orchestrate.mockImplementationOnce(async (state: JourneyState) => {
      const planned = schemaSafeState(deterministicOrchestrator(live, GOAL))
      return {
        state: {
          ...planned,
          goals: state.goals,
          messages: state.messages,
        },
        mode: 'demo' as const,
        fallbackReason: 'missing_key' as const,
      }
    })

    const response = await POST(request(draft, 'Какие варианты действий есть?'))
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.state.goals).toEqual(draft.goals)
    expect(body.state.roadmap.every((item: { id: string }) => item.id.startsWith('roadmap:store:')))
      .toBe(true)
    expect(body.state.widgets.some((widget: { kind: string }) => (
      widget.kind === 'point_b_goals' || widget.kind === 'roadmap_actions'
    ))).toBe(false)
  })
})

function request(state: JourneyState, message: string, method = 'POST'): Request {
  return new Request('https://example.test/api/v1/journey/store/chat', {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: 'aistart_journey_store_device=store-device-token-with-24-characters',
      'x-journey-workspace-id': WORKSPACE,
    },
    body: JSON.stringify({
      workspaceId: WORKSPACE,
      state,
      ...(message ? { message } : {}),
    }),
  })
}

function schemaSafeState(state: JourneyState): JourneyState {
  const goalIds = new Map(state.goals.map((goal, index) => [goal.id, `goal-test-${index}`]))
  const roadmapIds = new Map(state.roadmap.map((item, index) => [
    item.id,
    item.id.startsWith('roadmap:store:') ? item.id : `roadmap-test-${index}`,
  ]))
  const goals = state.goals.map((goal) => ({ ...goal, id: goalIds.get(goal.id)! }))
  const roadmap = state.roadmap.map((item) => ({
    ...item,
    id: roadmapIds.get(item.id)!,
    ...(item.dependsOn
      ? { dependsOn: item.dependsOn.map((id) => roadmapIds.get(id) ?? id) }
      : {}),
  }))
  const widgets = state.widgets.map((widget) => {
    if (widget.kind === 'point_b_goals') return { ...widget, data: { goals } }
    if (widget.kind === 'roadmap_actions') {
      return {
        ...widget,
        data: {
          items: widget.data.items.map((item) => ({
            ...item,
            id: roadmapIds.get(item.id) ?? `roadmap-widget-${roadmapIds.size}`,
            ...(item.dependsOn
              ? { dependsOn: item.dependsOn.map((id) => roadmapIds.get(id) ?? `roadmap-dependency`) }
              : {}),
          })),
        },
      }
    }
    if (widget.kind === 'tasks_reminders') {
      return {
        ...widget,
        data: {
          items: widget.data.items.map((item, index) => ({ ...item, id: `task-test-${index}` })),
        },
      }
    }
    return widget
  })
  return {
    ...state,
    messages: state.messages.map((message, index) => ({
      ...message,
      id: message.id.startsWith('message:store:') ? message.id : `message-test-${index}`,
    })),
    goals,
    roadmap,
    widgets,
  } as JourneyState
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
