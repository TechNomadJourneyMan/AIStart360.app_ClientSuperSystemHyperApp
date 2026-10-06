/**
 * The shared OpenRouter client used by features outside the agent runtime:
 * provider privacy, the platform daily AI budget, and spend recording.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ledger = vi.hoisted(() => ({ left: 10 as number | null, records: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ai/usage-ledger', () => ({
  platformBudgetLeft: async () => ledger.left,
  recordUsage: async (r: Record<string, unknown>) => { ledger.records.push(r) },
}))

import { chatWithOpenRouter } from '@/lib/ai/openrouter'

const fetchSpy = vi.fn()

beforeEach(() => {
  ledger.left = 10
  ledger.records = []
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.AI_PRIVACY_MODE
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({
    model: 'anthropic/claude-sonnet-4.5',
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0006 },
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENROUTER_API_KEY
})

const body = () => JSON.parse(fetchSpy.mock.calls[0][1].body as string)

describe('chatWithOpenRouter controls', () => {
  it('forbids providers to keep the data and asks for the real cost', async () => {
    expect(await chatWithOpenRouter({ user: 'u', label: 'test.feature' })).toBe('ok')
    expect(body().provider).toEqual({ data_collection: 'deny' })
    expect(body().usage).toEqual({ include: true })
  })

  it('keeps require_parameters for strict schemas and adds the privacy rule', async () => {
    process.env.AI_PRIVACY_MODE = 'strict'
    await chatWithOpenRouter({ user: 'u', jsonSchema: { name: 's', schema: { type: 'object' } } })
    expect(body().provider).toEqual({ require_parameters: true, data_collection: 'deny', zdr: true })
  })

  it('records the provider-reported cost under the feature label', async () => {
    await chatWithOpenRouter({ user: 'u', label: 'test.feature', companyId: 'c1' })
    expect(ledger.records).toEqual([expect.objectContaining({
      source: 'feature:test.feature', model: 'anthropic/claude-sonnet-4.5', tokensIn: 100, tokensOut: 20,
      costUsd: 0.0006, costSource: 'provider', companyId: 'c1',
    })])
  })

  it('does not call the model once the platform budget for today is spent', async () => {
    ledger.left = 0
    expect(await chatWithOpenRouter({ user: 'u' })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still works when the budget cannot be determined (database unavailable)', async () => {
    ledger.left = null
    expect(await chatWithOpenRouter({ user: 'u' })).toBe('ok')
  })
})
