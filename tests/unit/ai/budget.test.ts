import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __setAiBudgetDeps,
  AI_BUDGET_MESSAGE,
  AI_BUDGET_UNAVAILABLE_MESSAGE,
  AiBudgetExceededError,
  AiBudgetUnavailableError,
  assertAiBudget,
  guardAiBudget,
  isAiBudgetError,
  type AiBudgetDeps,
} from '@/lib/ai/budget'
import { currentAiActor, runWithAiActor } from '@/lib/ai/usage'

const USER = '11111111-2222-3333-4444-555555555555'

function deps(over: Partial<AiBudgetDeps> = {}): AiBudgetDeps {
  return {
    readTier: async () => 'free',
    readLimitUsd: async (tier) => (tier === 'staff' ? 20 : tier === 'pro' ? 5 : 0.5),
    readSpentTodayUsd: async () => 0,
    ...over,
  }
}

afterEach(() => __setAiBudgetDeps(null))

describe('assertAiBudget', () => {
  it('passes under the limit', async () => {
    __setAiBudgetDeps(deps({ readSpentTodayUsd: async () => 0.49 }))
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
  })

  it('throws a typed 429 error once the free daily limit is spent', async () => {
    __setAiBudgetDeps(deps({ readSpentTodayUsd: async () => 0.5 }))
    const err = await assertAiBudget(USER, 'ai_chat').catch((e) => e)
    expect(err).toBeInstanceOf(AiBudgetExceededError)
    expect(err).toMatchObject({ status: 429, tier: 'free', limitUsd: 0.5, message: AI_BUDGET_MESSAGE })
  })

  it('uses the tier limit (staff = 20)', async () => {
    __setAiBudgetDeps(deps({ readTier: async () => 'staff', readSpentTodayUsd: async () => 6 }))
    await expect(assertAiBudget(USER, 'assistant_ask')).resolves.toBeUndefined()
  })

  // R-146: a broken meter no longer lets a free user spend without limit.
  it('fails CLOSED for a free user when the meter is broken (typed 503 «unavailable», still an AI-budget error)', async () => {
    __setAiBudgetDeps(deps({ readSpentTodayUsd: async () => { throw new Error('rpc missing') } }))
    const err = await assertAiBudget(USER, 'ai_chat').catch((e) => e)
    expect(err).toBeInstanceOf(AiBudgetUnavailableError)
    expect(isAiBudgetError(err)).toBe(true)
    expect(err).toMatchObject({ status: 503, code: 'ai_budget_unavailable', tier: 'free', message: AI_BUDGET_UNAVAILABLE_MESSAGE })
  })

  it('fails closed when the limit setting or the tier cannot be read, or reads as not-a-number', async () => {
    __setAiBudgetDeps(deps({ readLimitUsd: async () => { throw new Error('settings down') } }))
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
    __setAiBudgetDeps(deps({ readTier: async () => { throw new Error('profiles down') } }))
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
    __setAiBudgetDeps(deps({ readSpentTodayUsd: async () => Number.NaN }))
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
  })

  it('stays open for paid (pro) and staff users when the meter is broken, and says so loudly', async () => {
    const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const tier of ['pro', 'staff'] as const) {
      __setAiBudgetDeps(deps({ readTier: async () => tier, readSpentTodayUsd: async () => { throw new Error('rpc missing') } }))
      await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
    }
    expect(loud).toHaveBeenCalledTimes(2)
    expect(String(loud.mock.calls[0][0])).toMatch(/fail-open/i)
    loud.mockRestore()
  })

  it('does not meter actors without a user id, but still sets the request actor', async () => {
    const readSpent = vi.fn(async () => 999)
    __setAiBudgetDeps(deps({ readSpentTodayUsd: readSpent }))
    await runWithAiActor({}, async () => {
      await assertAiBudget({ actorId: 'journey:anon' }, 'journey')
      expect(currentAiActor()).toMatchObject({ actorId: 'journey:anon' })
    })
    expect(readSpent).not.toHaveBeenCalled()
  })

  it('attributes later AI calls of the same request to the user', async () => {
    __setAiBudgetDeps(deps())
    await runWithAiActor({}, async () => {
      await assertAiBudget(USER, 'ai_chat')
      await Promise.resolve()
      expect(currentAiActor()?.userId).toBe(USER)
    })
  })
})

describe('guardAiBudget', () => {
  it('returns the Russian 429 response when over budget', async () => {
    __setAiBudgetDeps(deps({ readSpentTodayUsd: async () => 1 }))
    const res = await guardAiBudget(USER, 'assistant_converse')
    expect(res?.status).toBe(429)
    await expect(res!.json()).resolves.toMatchObject({ ok: false, error: 'Дневной лимит ИИ исчерпан, попробуйте завтра', code: 'ai_budget_exceeded' })
  })

  it('returns null under budget', async () => {
    __setAiBudgetDeps(deps())
    await expect(guardAiBudget(USER, 'assistant_converse')).resolves.toBeNull()
  })

  it('returns 503 «не удалось проверить лимит» for a free user when the meter is broken', async () => {
    __setAiBudgetDeps(deps({ readSpentTodayUsd: async () => { throw new Error('rpc missing') } }))
    const res = await guardAiBudget(USER, 'assistant_converse')
    expect(res?.status).toBe(503)
    await expect(res!.json()).resolves.toMatchObject({ ok: false, error: AI_BUDGET_UNAVAILABLE_MESSAGE, code: 'ai_budget_unavailable' })
  })
})

// ── Route level: the assistant «ask» route answers 429 before any LLM call ──

const answerUserQuestion = vi.fn()
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } } }) } }),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false, isRateLimited: async () => false }))
vi.mock('@/lib/access/gate', () => ({ gateFeature: async () => null }))
vi.mock('@/lib/assistant/context', () => ({ buildAssistantContext: async () => ({}) }))
vi.mock('@/lib/assistant/answer', () => ({ answerUserQuestion: (...a: unknown[]) => answerUserQuestion(...a) }))
vi.mock('@/lib/assistant/escalation/adapter', () => ({ createExpertCase: vi.fn(async () => null) }))

describe('POST /api/v1/assistant/ask — budget', () => {
  beforeEach(() => answerUserQuestion.mockReset())

  it('answers 429 «Дневной лимит ИИ исчерпан» and never calls the model', async () => {
    __setAiBudgetDeps(deps({ readSpentTodayUsd: async () => 3 }))
    const { POST } = await import('@/app/api/v1/assistant/ask/route')
    const res = await POST(new NextRequest('http://x/api/v1/assistant/ask', {
      method: 'POST', body: JSON.stringify({ question: 'Как дела?' }),
    }) as never)
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe(AI_BUDGET_MESSAGE)
    expect(answerUserQuestion).not.toHaveBeenCalled()
  })
})
