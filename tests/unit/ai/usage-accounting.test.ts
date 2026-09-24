import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatWithOpenRouter, embedWithOpenRouter, OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import { estimateCostUsd, priceFor } from '@/lib/ai/pricing'
import {
  __setAiUsageSink,
  buildAiUsageRow,
  recordAiCacheHit,
  runWithAiActor,
  type AiUsageRow,
} from '@/lib/ai/usage'
import { summarizeAiUsage } from '@/lib/ai/usage-summary'

const USER = '11111111-2222-3333-4444-555555555555'
const originalKey = process.env.OPENROUTER_API_KEY

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('pricing', () => {
  it('prices known models per 1M tokens', () => {
    // Sonnet 4.5: $3 in / $15 out → 1000 in + 500 out = 0.003 + 0.0075
    expect(estimateCostUsd(OPENROUTER_MODELS.sonnet, 1000, 500)).toBeCloseTo(0.0105, 6)
    expect(estimateCostUsd(OPENROUTER_MODELS.haiku, 1_000_000, 0)).toBe(1)
    expect(estimateCostUsd('openai/text-embedding-3-small', 1_000_000, 0)).toBe(0.02)
  })

  it('returns null for an unknown model and tolerates dated suffixes', () => {
    expect(estimateCostUsd('acme/unknown-model', 100, 100)).toBeNull()
    expect(priceFor('anthropic/claude-haiku-4.5-20251001')).toEqual(priceFor(OPENROUTER_MODELS.haiku))
  })
})

describe('usage recording', () => {
  let rows: AiUsageRow[]

  beforeEach(() => {
    rows = []
    __setAiUsageSink(async (row) => { rows.push(row) })
    process.env.OPENROUTER_API_KEY = 'test-key'
  })

  afterEach(() => {
    __setAiUsageSink(null)
    vi.unstubAllGlobals()
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalKey
  })

  it('records tokens, estimated cost, feature and the explicit user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    })))
    const out = await chatWithOpenRouter({ feature: 'ai_chat', model: OPENROUTER_MODELS.sonnet, user: 'q', userId: USER })
    expect(out).toBe('ok')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      feature: 'ai_chat',
      model: OPENROUTER_MODELS.sonnet,
      user_id: USER,
      prompt_tokens: 1000,
      completion_tokens: 500,
      ok: true,
    })
    expect(rows[0].cost_usd).toBeCloseTo(0.0105, 6)
    expect(rows[0].latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('asks OpenRouter for exact usage and prefers the provider-reported cost', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.123456 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await chatWithOpenRouter({ feature: 'assistant_ask', user: 'q' })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.usage).toEqual({ include: true })
    expect(rows[0].cost_usd).toBe(0.123456)
  })

  it('records a failed call with ok=false and attributes it to the request actor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    const out = await runWithAiActor({ userId: USER }, () =>
      chatWithOpenRouter({ feature: 'point_a_analysis', model: OPENROUTER_MODELS.haiku, user: 'q' }),
    )
    expect(out).toBeNull()
    expect(rows[0]).toMatchObject({ feature: 'point_a_analysis', ok: false, user_id: USER, prompt_tokens: 0 })
  })

  it('records embeddings under their feature', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{ embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 2000, total_tokens: 2000 },
    })))
    await embedWithOpenRouter(['текст'], { feature: 'doc_embed', userId: USER })
    expect(rows[0]).toMatchObject({ feature: 'doc_embed', model: 'openai/text-embedding-3-small', prompt_tokens: 2000 })
    expect(rows[0].cost_usd).toBeCloseTo(0.00004, 8)
  })

  it('never lets a failing sink break the AI call', async () => {
    __setAiUsageSink(async () => { throw new Error('db down') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'still ok' } }] })))
    await expect(chatWithOpenRouter({ feature: 'journey', user: 'q' })).resolves.toBe('still ok')
  })

  it('keeps non-UUID actors out of user_id and writes cache hits at zero cost', async () => {
    expect(buildAiUsageRow({ feature: 'journey', model: 'x', ok: true, userId: 'journey-anon' }))
      .toMatchObject({ user_id: null, actor_id: 'journey-anon' })
    await recordAiCacheHit('point_a_analysis', { userId: USER })
    expect(rows[0]).toMatchObject({ model: 'cache_hit', cost_usd: 0, prompt_tokens: 0, user_id: USER })
  })
})

describe('usage summary', () => {
  it('folds feature × model rows and counts cache hits separately', () => {
    const s = summarizeAiUsage([
      { feature: 'point_a_analysis', model: OPENROUTER_MODELS.sonnet, calls: 4, failed_calls: 1, prompt_tokens: 100, completion_tokens: 50, cost_usd: '0.5', avg_latency_ms: 10 },
      { feature: 'point_a_analysis', model: 'cache_hit', calls: 3, failed_calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, avg_latency_ms: 0 },
      { feature: 'ai_chat', model: OPENROUTER_MODELS.haiku, calls: 2, failed_calls: 0, prompt_tokens: 10, completion_tokens: 5, cost_usd: 0.01, avg_latency_ms: 5 },
    ])
    expect(s.total_cost_usd).toBe(0.51)
    expect(s.total_calls).toBe(6)
    expect(s.cache_hits).toBe(3)
    expect(s.features[0]).toMatchObject({ feature: 'point_a_analysis', calls: 4, cache_hits: 3, failed_calls: 1, label: 'Точка А: AI-анализ' })
  })
})
