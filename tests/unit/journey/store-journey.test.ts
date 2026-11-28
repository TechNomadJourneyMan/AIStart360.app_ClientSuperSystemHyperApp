import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreOverview } from '@/lib/store/types'

const s = vi.hoisted(() => ({
  authorize: vi.fn(), overview: vi.fn(), load: vi.fn(), save: vi.fn(), ai: false,
  orchestrate: vi.fn(), client: { marker: 'session-client' },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => s.client }))
vi.mock('@/lib/store/request', () => ({ authorizeStore: s.authorize }))
vi.mock('@/lib/store/loader', () => ({ loadStoreOverview: s.overview }))
vi.mock('@/lib/ai/structured', () => ({ hasOpenRouterKey: () => s.ai }))
vi.mock('@/lib/journey/orchestrator', () => ({ orchestrateJourneyTurn: s.orchestrate }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimited: async () => false, isRateLimitedKey: async () => false }))
vi.mock('@/lib/journey/store-persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/journey/store-persistence')>(),
  loadStoreJourneyOverlay: s.load, saveStoreJourneyOverlay: s.save,
}))

import { getStoreJourney, patchStoreJourney, postStoreJourneyChat, reviewedStoreProposal, validatedStorePlan } from '@/lib/journey/store-handlers'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import { emptyStoreOverlay, storeJourneyWorkspaceId } from '@/lib/journey/store-persistence'
import { rehydrateStoreJourney } from '@/lib/journey/store-context'

function overview(): StoreOverview {
  return {
    source: 'operational', confidence: 'partial', companyName: 'Тестовый магазин',
    period: { from: '2026-07-01', to: '2026-07-31' }, asOf: '2026-07-31', versionLabel: 'published',
    availability: { sales: true, inventory: true, prices: false },
    metrics: { revenue: 0, cost: 0, grossProfit: 0, grossMarginPct: null, listRevenue: 0, discount: 0, discountRatePct: null, units: 0, returns: 0 },
    catalog: { products: 0, activeProducts: 0, latest: [] },
    inventory: { availableUnits: 0, reservedUnits: 0, inventoryCost: null, inventoryRetail: null, warehouses: [] },
    channels: [], alerts: [], limitations: ['Нет подтверждённого прайса'],
  }
}
function request(body?: unknown, headers: Record<string, string> = {}) {
  return new Request('https://portal.test/api/v1/journey/store?companyId=co-1', {
    method: body ? 'PATCH' : 'GET', headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  s.ai = false
  s.authorize.mockResolvedValue({ ok: true, userId: 'u-1', company: { id: 'co-1', name: 'Тестовый магазин' } })
  s.overview.mockResolvedValue(overview())
  s.load.mockResolvedValue({ overlay: emptyStoreOverlay('co-1'), revision: 0 })
  s.save.mockResolvedValue(1)
})

describe('Store Journey access and state boundaries', () => {
  it.each([401, 403])('does not load facts or saved state after an access rejection (%s)', async (status) => {
    s.authorize.mockResolvedValue({ ok: false, error: { status, code: 'denied', message: 'Нет доступа' } })
    const response = await getStoreJourney(request())
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toContain('private, no-store')
    expect(s.overview).not.toHaveBeenCalled()
    expect(s.load).not.toHaveBeenCalled()
  })

  it('uses the exact authorized user/company for both facts and isolated state, never a browser workspace id', async () => {
    const response = await getStoreJourney(request())
    const body = await response.json()
    expect(s.authorize).toHaveBeenCalledWith(s.client, 'co-1')
    expect(s.overview).toHaveBeenCalledWith(s.client, 'u-1', 'co-1')
    expect(s.load).toHaveBeenCalledWith('u-1', 'co-1')
    expect(body.state.workspaceId).toBe(storeJourneyWorkspaceId('u-1', 'co-1'))
    expect(JSON.stringify(body)).not.toMatch(/accessToken|access_token|credential/i)
  })

  it('rejects client-supplied business state instead of persisting invented metrics', async () => {
    const response = await patchStoreJourney(request({ action: 'layout', revision: 0, layout: [], state: { facts: [{ value: 'fake revenue' }] } }))
    expect(response.status).toBe(400)
    expect(s.save).not.toHaveBeenCalled()
  })

  it('rejects unknown module IDs and stale revisions before writing', async () => {
    const unknown = await patchStoreJourney(request({ action: 'layout', revision: 0, layout: [{ id: 'widget:private-other', collapsed: false, hidden: false, focused: false, position: { x: 100, y: 500 } }] }))
    expect(unknown.status).toBe(400)
    const stale = await patchStoreJourney(request({ action: 'layout', revision: 2, layout: [] }))
    expect(stale.status).toBe(409)
    expect(s.save).not.toHaveBeenCalled()
  })

  it('rejects cross-origin writes before performing any account read', async () => {
    const response = await patchStoreJourney(request({ action: 'layout', revision: 0, layout: [] }, { origin: 'https://other.test' }))
    expect(response.status).toBe(403)
    expect(s.authorize).not.toHaveBeenCalled()
  })

  it('requires a complete reviewable goal, saves it as a draft, and copies no financial facts into the overlay', async () => {
    const response = await patchStoreJourney(request({ action: 'draft-goal', revision: 0, goal: { metric: 'Валовая маржа', target: '35%', deadline: '2026-12-31' } }))
    expect(response.status).toBe(200)
    const saved = s.save.mock.calls[0][2]
    expect(saved.goals[0]).toMatchObject({ metric: 'Валовая маржа', target: '35%', deadline: '2026-12-31', status: 'draft' })
    expect(saved).not.toHaveProperty('facts')
    expect(saved).not.toHaveProperty('widgets')
    expect(saved.roadmap).toEqual([])
    const invalid = await patchStoreJourney(request({ action: 'draft-goal', revision: 0, goal: { metric: 'Маржа', target: 'больше', deadline: '2026-02-31' } }))
    expect(invalid.status).toBe(400)
  })

  it('confirms only the latest persisted exact draft, never a substituted body goal', async () => {
    const overlay = emptyStoreOverlay('co-1')
    overlay.goals = [{ id: 'goal-old', title: 'Маржа 30%', metric: 'Маржа', target: '30%', deadline: '2026-12-31', status: 'draft' },
      { id: 'goal-new', title: 'Маржа 35%', metric: 'Маржа', target: '35%', deadline: '2026-12-31', status: 'draft' }]
    s.load.mockResolvedValue({ overlay, revision: 4 })
    expect((await patchStoreJourney(request({ action: 'confirm-goal', revision: 4, goalId: 'goal-old' }))).status).toBe(409)
    expect(s.save).not.toHaveBeenCalled()
    expect((await patchStoreJourney(request({ action: 'confirm-goal', revision: 4, goalId: 'goal-new' }))).status).toBe(200)
    expect(s.save.mock.calls[0][2].goals[1].status).toBe('confirmed')
    expect(s.save.mock.calls[0][3]).toBe(4)
    overlay.goals[1].status = 'confirmed'
    s.save.mockClear()
    expect((await patchStoreJourney(request({ action: 'confirm-goal', revision: 4, goalId: 'goal-old' }))).status).toBe(409)
    expect(s.save).not.toHaveBeenCalled()
  })

  it('does not use demo AI text or pretend to save a chat when the provider is unavailable', async () => {
    const response = await postStoreJourneyChat(request({ revision: 0, message: 'Разбери магазин' }))
    expect(response.status).toBe(503)
    expect(s.orchestrate).not.toHaveBeenCalled()
    expect(s.save).not.toHaveBeenCalled()
  })

  it('builds an AI plan only after confirming the exact stored goal, without accepting model metrics or completed work', async () => {
    s.ai = true
    const overlay = emptyStoreOverlay('co-1')
    overlay.goals = [{ id: 'goal-new', title: 'Маржа 35%', metric: 'Маржа', target: '35%', deadline: '2026-12-31', status: 'draft' }]
    s.load.mockResolvedValue({ overlay, revision: 4 })
    s.orchestrate.mockImplementation(async (current) => ({ mode: 'live', state: {
      ...current, facts: [], goals: [{ ...current.goals[0], target: '999%' }],
      widgets: current.widgets.map((widget: { kind: string }) => widget.kind === 'finance_cashflow' ? { ...widget, data: { metrics: [{ label: 'Выручка', value: '999999' }] } } : widget),
      roadmap: [
        { id: 'ai-step-2', title: 'Проверить результат', description: 'Сверить фактические данные после действия.', horizon: '2026-12-31', progress: 90, status: 'done', dependsOn: ['ai-step-1'] },
        { id: 'ai-step-1', title: 'Проверить структуру себестоимости', description: 'Сверить опубликованную себестоимость и выбрать действие.', horizon: '2026-12-01', progress: 100, status: 'done' },
      ],
    } }))
    const response = await patchStoreJourney(request({ action: 'confirm-goal', revision: 4, goalId: 'goal-new' }))
    expect(response.status).toBe(200)
    expect(s.orchestrate.mock.calls[0][0].goals[0].status).toBe('confirmed')
    const saved = s.save.mock.calls[0][2]
    expect(saved.goals[0].target).toBe('35%')
    expect(saved.roadmap.map((item: { progress: number }) => item.progress)).toEqual([0, 0])
    expect(saved.roadmap[0].title).toBe('Проверить структуру себестоимости')
    expect(saved.roadmap[1].dependsOn).toEqual([saved.roadmap[0].id])
    expect(saved.planModules).toEqual(['point_b_goals', 'roadmap_actions', 'tasks_reminders'])
    expect(saved).not.toHaveProperty('facts')
    const body = await response.json()
    expect(body.state.widgets).toHaveLength(7)
    expect(body.state.widgets.find((widget: { kind: string }) => widget.kind === 'finance_cashflow').data.metrics[0].value).not.toBe('999999')
    expect(body.state.messages.at(-1).text).toContain('Шагов в плане: 2')
  })

  it('keeps the exact confirmed goal and an honest manual step if AI fails', async () => {
    s.ai = true
    const overlay = emptyStoreOverlay('co-1')
    overlay.goals = [{ id: 'goal-new', title: 'Маржа 35%', metric: 'Маржа', target: '35%', deadline: '2026-12-31', status: 'draft' }]
    s.load.mockResolvedValue({ overlay, revision: 4 })
    s.orchestrate.mockRejectedValue(new Error('provider unavailable'))
    const response = await patchStoreJourney(request({ action: 'confirm-goal', revision: 4, goalId: 'goal-new' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.state.goals[0]).toMatchObject({ status: 'confirmed', target: '35%' })
    expect(body.state.messages.at(-1).text).toContain('AI не подготовил проверяемый план')
    expect(s.save.mock.calls[0][2].roadmap[0].title).toBe('Определить первый шаг к цели')
  })

  it('saves layouts for projected plan modules and marks work done only on an explicit user action', async () => {
    const overlay = emptyStoreOverlay('co-1')
    overlay.goals = [{ id: 'goal-new', title: 'Маржа 35%', metric: 'Маржа', target: '35%', deadline: '2026-12-31', status: 'confirmed' }]
    overlay.roadmap = [{ id: 'plan-1', title: 'Сверить данные', description: 'Сверить источник.', horizon: '2026-12-01', progress: 0, status: 'next' }]
    s.load.mockResolvedValue({ overlay, revision: 4 })
    const layout = [{ id: 'widget:store:plan:tasks_reminders', collapsed: false, hidden: false, focused: false, position: { x: 100, y: 800 } }]
    expect((await patchStoreJourney(request({ action: 'layout', revision: 4, layout }))).status).toBe(200)
    expect(s.save.mock.calls[0][2].layout).toEqual(layout)
    s.save.mockClear()
    const response = await patchStoreJourney(request({ action: 'roadmap-status', revision: 4, itemId: 'plan-1', done: true }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.state.widgets.find((widget: { kind: string }) => widget.kind === 'tasks_reminders').data.items[0].done).toBe(true)
    expect(s.save.mock.calls[0][2].roadmap[0]).toMatchObject({ status: 'done', progress: 100 })
    expect(s.orchestrate).not.toHaveBeenCalled()
  })

  it('never turns a cyclic AI proposal into an executable plan', () => {
    const current = buildStoreJourneyState(overview(), { workspaceId: 'test-store-workspace' })
    const proposed = { ...current, roadmap: [
      { id: 'a', title: 'A', description: '', horizon: 'Неделя', progress: 0, status: 'next' as const, dependsOn: ['b'] },
      { id: 'b', title: 'B', description: '', horizon: 'Неделя', progress: 0, status: 'next' as const, dependsOn: ['a'] },
    ] }
    expect(validatedStorePlan(current, proposed)).toEqual([])
  })

  it('cannot let AI approve goals, replace facts or create an unconfirmed transformation plan', () => {
    const current = buildStoreJourneyState(overview(), { workspaceId: 'test-store-workspace' })
    const proposed = { ...current, facts: [], roadmap: [], goals: [{ id: 'goal-ai', title: 'Маржа 40%', metric: 'Маржа', target: '40%', deadline: '2026-12-31', status: 'confirmed' as const }] }
    const overlay = reviewedStoreProposal(emptyStoreOverlay('co-1'), current, proposed)
    expect(overlay.goals[0].status).toBe('draft')
    expect(overlay.roadmap).toEqual([])
    const rehydrated = rehydrateStoreJourney(current, { overlay, revision: 1 })
    expect(rehydrated.facts).toEqual(current.facts)
    expect(rehydrated.widgets).toEqual(current.widgets)
  })
})

describe('Store Journey real-data projection', () => {
  it('preserves observed zero while showing missing margin as unknown, with period and source', () => {
    const state = buildStoreJourneyState(overview(), { workspaceId: 'test-store-workspace' })
    expect(state.facts.find((fact) => fact.id === 'fact:store:revenue')?.value).toContain('0')
    expect(state.facts.find((fact) => fact.id === 'fact:store:gross-margin')).toBeUndefined()
    expect(state.facts[0].sourceLabel).toContain('2026')
    expect(state.widgets).toHaveLength(4)
    expect(state.goals).toEqual([])
  })

  it('does not turn an empty source into zero facts or invent a target', () => {
    const state = buildStoreJourneyState({ ...overview(), source: 'empty' }, { workspaceId: 'test-store-workspace' })
    expect(state.facts).toEqual([])
    expect(state.goals).toEqual([])
    expect(state.phase).toBe('empty')
  })

  it('derives distinct identities for two companies and two actors', () => {
    const ids = [storeJourneyWorkspaceId('u1', 'co1'), storeJourneyWorkspaceId('u1', 'co2'), storeJourneyWorkspaceId('u2', 'co1')]
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe(storeJourneyWorkspaceId('u1', 'co1'))
  })
})
