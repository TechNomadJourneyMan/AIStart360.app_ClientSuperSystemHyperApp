/**
 * Cost accounting gaps (review findings #27, #57, #66):
 *   - the pre-call budget estimate prices the model actually called, and an
 *     unknown model at the premium rate (not the agent's cheap tier rate);
 *   - a call whose cost the provider did not report is recorded at an
 *     estimate, never $0;
 *   - a timed-out attempt (possibly generated and billed) counts its worst case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)
const ledger = vi.hoisted(() => ({ left: 10 as number | null, records: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ai/usage-ledger', () => ({
  platformBudgetLeft: async () => ledger.left,
  recordUsage: async (r: Record<string, unknown>) => { ledger.records.push(r) },
  budgetFailsClosed: () => false,
}))

import { callLlm, estimateCostUsd } from '@/lib/ai/gateway'
import { chatWithOpenRouter } from '@/lib/ai/openrouter'
import { invalidateProviderCache } from '@/lib/ai/providers/router'
import { resetFakeDb } from './providers-fake-store'

const HAIKU = 'anthropic/claude-haiku-4.5'
const OPUS = 'anthropic/claude-opus-4.8'

const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
const answer = (usage: Record<string, number>) =>
  new Response(JSON.stringify({ model: HAIKU, choices: [{ message: { content: 'ok' } }], usage }), { status: 200 })

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'k'
  resetFakeDb()
  invalidateProviderCache()
  ledger.left = 10
  ledger.records = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENROUTER_API_KEY
  delete process.env.AI_PRICE_TABLE
})

describe('pre-call estimate', () => {
  const input = 'x'.repeat(3500) // 1000 tokens

  it('prices an expensive override by its model, not by the agent tier', () => {
    const haikuOnLight = estimateCostUsd('light', HAIKU, input, 1000)
    const opusOnLight = estimateCostUsd('light', OPUS, input, 1000)
    expect(haikuOnLight).toBeCloseTo((1000 * 1 + 1000 * 5) / 1e6, 9)
    expect(opusOnLight).toBeCloseTo((1000 * 15 + 1000 * 75) / 1e6, 9)
  })

  it('prices an unknown model id at the premium rate', () => {
    expect(estimateCostUsd('light', 'vendor/unknown-model', input, 1000)).toBeCloseTo((1000 * 15 + 1000 * 75) / 1e6, 9)
  })

  it('AI_PRICE_TABLE still sets a model price', () => {
    process.env.AI_PRICE_TABLE = JSON.stringify({ 'vendor/cheap': { in: 0.1, out: 0.2 } })
    expect(estimateCostUsd('premium', 'vendor/cheap', input, 1000)).toBeCloseTo((1000 * 0.1 + 1000 * 0.2) / 1e6, 9)
  })
})

describe('gateway: timed-out attempts', () => {
  it('adds the worst case of a timed-out attempt to the successful retry', async () => {
    const f = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce(answer({ prompt_tokens: 10, completion_tokens: 2, cost: 0.0001 }))
    const r = await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 1000, label: 't', fetchImpl: f as unknown as typeof fetch })
    expect(r.ok).toBe(true)
    // 1000 output tokens at the Haiku estimate ($5/Mtok) for the lost attempt.
    expect(r.usage!.costUsd).toBeGreaterThan(0.0001 + 0.004)
  }, 10_000)

  it('returns usage (not null) when every attempt timed out', async () => {
    const f = vi.fn().mockRejectedValue(timeout())
    const r = await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 1000, label: 't', fetchImpl: f as unknown as typeof fetch })
    expect(r).toMatchObject({ ok: false, error: 'TIMEOUT' })
    expect(r.usage).not.toBeNull()
    expect(r.usage!.costUsd).toBeGreaterThan(0.008)
    expect(r.usage!.costSource).toBe('estimate')
  }, 10_000)
})

describe('chatWithOpenRouter: spend ledger', () => {
  it('records an estimate, not $0, when OpenRouter omits usage.cost', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ prompt_tokens: 3000, completion_tokens: 1000 })))
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', model: HAIKU, label: 't' })).toBe('ok')
    expect(ledger.records).toHaveLength(1)
    expect(ledger.records[0]).toMatchObject({ costSource: 'estimate', ok: true })
    expect(ledger.records[0].costUsd).toBeCloseTo((3000 * 1 + 1000 * 5) / 1e6, 9)
  })

  it('records the worst case of a timed-out call as a failed row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => { throw timeout() }))
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', model: HAIKU, maxTokens: 1000, label: 't', companyId: 'c1' })).toBeNull()
    expect(ledger.records).toHaveLength(1)
    expect(ledger.records[0]).toMatchObject({ ok: false, costSource: 'estimate', companyId: 'c1', source: 'feature:t' })
    expect(Number(ledger.records[0].costUsd)).toBeGreaterThan(0.004)
  })
})
