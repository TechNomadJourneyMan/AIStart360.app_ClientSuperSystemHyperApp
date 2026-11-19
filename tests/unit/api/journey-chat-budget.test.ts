/**
 * POST /api/v1/journey/chat — the AI budget gate (R-146 / R-150 class): the turn reaches the model
 * only when the budget check says yes. A spent budget → 429; the meter unavailable (free tier) →
 * 503; ANY other error of the check → 503 as well (it used to fall through as «allowed»).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const USER = '11111111-2222-3333-4444-555555555555'
const m = vi.hoisted(() => ({
  assert: vi.fn(async (..._a: unknown[]) => {}),
  orchestrate: vi.fn(async (..._a: unknown[]) => ({ state: {}, mode: 'llm', fallbackReason: null })),
}))

vi.mock('@/lib/journey/http', () => ({
  resolveJourneyActor: async () => USER,
  withJourneyRequestIdentity: (_req: Request, body: unknown) => body,
  identityFromRequest: () => ({ workspaceId: 'ws-1', accessToken: 't'.repeat(40) }),
  journeyErrorResponse: () => new Response(JSON.stringify({ error: { code: 'X' } }), { status: 500 }),
}))
vi.mock('@/lib/journey/schema', () => ({ journeyChatRequestSchema: { parse: (v: unknown) => v } }))
vi.mock('@/lib/journey/orchestrator', () => ({ orchestrateJourneyTurn: m.orchestrate }))
vi.mock('@/lib/journey/policy', () => ({ enforceJourneyStatePolicy: (s: unknown) => s }))
vi.mock('@/lib/journey/persistence', () => ({
  loadJourneyState: vi.fn(async () => null),
  saveJourneyState: vi.fn(async (_i: unknown, state: unknown) => ({ state: { ...(state as object), messages: [], provider: { mode: 'llm' } }, persistence: 'ok' })),
  appendJourneyMessages: vi.fn(async () => {}),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimited: async () => false, isRateLimitedKey: async () => false }))
vi.mock('@/lib/ai/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/budget')>()),
  assertAiBudget: m.assert,
}))

const { POST } = await import('@/app/api/v1/journey/chat/route')
const { AiBudgetExceededError, AiBudgetUnavailableError, AI_BUDGET_MESSAGE, AI_BUDGET_UNAVAILABLE_MESSAGE } = await import('@/lib/ai/budget')

const chat = () => POST(new Request('http://x/api/v1/journey/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'Привет', state: { messages: [] } }),
}))

beforeEach(() => {
  m.assert.mockReset()
  m.orchestrate.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/v1/journey/chat — AI budget', () => {
  it('a spent budget → 429, the model is not called', async () => {
    m.assert.mockRejectedValueOnce(new AiBudgetExceededError('journey', 'free', 1, 0.5))
    const res = await chat()
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatchObject({ code: 'AI_BUDGET_EXCEEDED', message: AI_BUDGET_MESSAGE })
    expect(m.orchestrate).not.toHaveBeenCalled()
  })

  it('the meter unavailable for a free user → 503, the model is not called', async () => {
    m.assert.mockRejectedValueOnce(new AiBudgetUnavailableError('journey', 'free'))
    const res = await chat()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatchObject({ code: 'AI_BUDGET_UNAVAILABLE', message: AI_BUDGET_UNAVAILABLE_MESSAGE })
    expect(m.orchestrate).not.toHaveBeenCalled()
  })

  it('an unknown error of the budget check is a refusal (503), never «allowed»', async () => {
    m.assert.mockRejectedValueOnce(new Error('boom'))
    const res = await chat()
    expect(res.status).toBe(503)
    expect(m.orchestrate).not.toHaveBeenCalled()
  })

  it('within budget the turn goes to the model', async () => {
    const res = await chat()
    expect(res.status).toBe(200)
    expect(m.orchestrate).toHaveBeenCalledTimes(1)
  })
})
