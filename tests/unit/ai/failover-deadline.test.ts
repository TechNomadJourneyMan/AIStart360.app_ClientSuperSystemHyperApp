/**
 * R-016 — the AI failover had no common deadline: up to 4 attempts × 45–60 s = up to 240 s for
 * one user action. runWithFailover now shares one budget between the attempts, hands each attempt
 * the time it may take, and stops with a TIMEOUT failure (which callers already turn into their
 * «ИИ недоступен» answer) when the budget is spent. R-225 (part): provider fetches do not follow
 * redirects.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ClientFailure } from '@/lib/ai/providers/client'
import type { ProviderTarget } from '@/lib/ai/providers/types'

beforeAll(() => {
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage
})

const { runWithFailover, aiDeadlineMs, AI_DEADLINE_DEFAULTS } = await import('@/lib/ai/providers/failover')
const { runWithDeadline } = await import('@/lib/runtime/deadline')
const { chatCompletion } = await import('@/lib/ai/providers/client')

const target = (key: string) => ({ providerKey: key, model: `${key}-model`, credentialId: null } as unknown as ProviderTarget)
const timeout: ClientFailure = { ok: false, code: 'TIMEOUT', status: null, message: 'таймаут', retryable: true, detail: null }

/** A clock the attempts move forward: each attempt "takes" the whole time it was given. */
function clock() {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('R-016 runWithFailover deadline', () => {
  it('shares one budget between the attempts: their timeouts never add up past it', async () => {
    const c = clock()
    const given: number[] = []
    const attempt = vi.fn(async (_t: ProviderTarget, budget: { timeoutMs: number }) => {
      given.push(budget.timeoutMs)
      c.advance(budget.timeoutMs)
      return timeout
    })
    const run = await runWithFailover([target('a'), target('b'), target('c'), target('d')], attempt, {
      deadlineMs: 45_000, attemptTimeoutMs: 20_000, now: c.now,
    })
    expect(run.ok).toBe(false)
    expect(given.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(45_000)
    expect(given).toEqual([20_000, 20_000, 5_000])
    if (!run.ok) {
      expect(run.failure).toMatchObject({ code: 'TIMEOUT', status: null, retryable: false })
      expect(run.failure?.message).toMatch(/лимит времени/)
    }
  })

  it('does not start an attempt with less than minAttemptMs left', async () => {
    const c = clock()
    const attempt = vi.fn(async (_t: ProviderTarget, budget: { timeoutMs: number }) => {
      c.advance(budget.timeoutMs)
      return timeout
    })
    await runWithFailover([target('a'), target('b')], attempt, { deadlineMs: 10_500, attemptTimeoutMs: 10_000, minAttemptMs: 1_000, now: c.now })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('without a deadline gives each attempt its own timeout (previous behaviour)', async () => {
    const given: number[] = []
    await runWithFailover([target('a'), target('b')], async (_t, budget) => {
      given.push(budget.timeoutMs)
      return timeout
    }, { attemptTimeoutMs: 60_000 })
    expect(given).toEqual([60_000, 60_000])
  })

  it('honours the ambient deadline of the request (withDeadline / runWithDeadline)', async () => {
    const given: number[] = []
    await runWithDeadline('route', 3_000, () => runWithFailover([target('a')], async (_t, budget) => {
      given.push(budget.timeoutMs)
      return { ok: true as const }
    }, { deadlineMs: 45_000, attemptTimeoutMs: 45_000 }))
    expect(given[0]).toBeLessThanOrEqual(3_000)
  })

  it('a success inside the budget is returned as before', async () => {
    const run = await runWithFailover([target('a'), target('b')], async (t) => (t.providerKey === 'a' ? timeout : { ok: true as const }), { deadlineMs: 45_000, attemptTimeoutMs: 20_000 })
    expect(run).toMatchObject({ ok: true, attempts: 2 })
  })
})

describe('R-016 aiDeadlineMs', () => {
  it('is 45 s for a user call and longer for background work, never below the caller\'s own attempt timeout', () => {
    expect(AI_DEADLINE_DEFAULTS.userMs).toBe(45_000)
    expect(AI_DEADLINE_DEFAULTS.backgroundMs).toBeGreaterThan(AI_DEADLINE_DEFAULTS.userMs)
    expect(aiDeadlineMs('user', 30_000, {})).toBe(45_000)
    expect(aiDeadlineMs('user', 90_000, {})).toBe(90_000)
    expect(aiDeadlineMs('user', 30_000, { AI_CALL_DEADLINE_MS: '20000' })).toBe(30_000)
    expect(aiDeadlineMs('background', 60_000, { AI_BACKGROUND_DEADLINE_MS: '200000' })).toBe(200_000)
  })
})

describe('R-225 provider fetch does not follow redirects', () => {
  it('sends redirect: manual and treats a 3xx as a provider error, not a success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }))
    const t = {
      providerKey: 'x', model: 'm', kind: 'openai_compatible', baseUrl: 'https://llm.example.com/v1', chatPath: '/chat/completions',
      apiKey: 'k-123456789', extraHeaders: {},
    } as unknown as ProviderTarget
    const res = await chatCompletion(t, { messages: [{ role: 'user', content: 'hi' }], maxTokens: 5, fetchImpl })
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe('manual')
    expect(res).toMatchObject({ ok: false, status: 302, retryable: false })
  })
})
