/**
 * The existing entry points go through the provider router (094) without
 * changing their signatures: callLlm / callLlmJson, chatWithOpenRouter,
 * embedWithOpenRouter and generateObjectViaOpenRouter use the owner's Alem
 * route when configured and OpenRouter (as before) when not.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)
const ledger = vi.hoisted(() => ({ left: 10 as number | null, records: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ai/usage-ledger', () => ({
  platformBudgetLeft: async () => ledger.left,
  recordUsage: async (r: Record<string, unknown>) => { ledger.records.push(r) },
}))

import { encryptSecret } from '@/lib/crypto/secrets'
import { callLlm, callLlmJson, hasLlmKey } from '@/lib/ai/gateway'
import { chatWithOpenRouter, embedWithOpenRouter } from '@/lib/ai/openrouter'
import { generateObjectViaOpenRouter } from '@/lib/ai/structured'
import { invalidateProviderCache, resolveTarget } from '@/lib/ai/providers/router'
import { fakeDb, resetFakeDb, seedCredential, seedModel, seedProvider, seedRoute } from './providers-fake-store'

const ALEM_KEY = 'alem-test-key-0000-1111'
const saved = { key: process.env.SECRETS_ENCRYPTION_KEY, or: process.env.OPENROUTER_API_KEY, privacy: process.env.AI_PRIVACY_MODE }

const ok = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], ...extra }), { status: 200 })

let fetchSpy: ReturnType<typeof vi.fn>
const call = (i = 0) => fetchSpy.mock.calls[i] as unknown as [string, RequestInit]
const body = (i = 0) => JSON.parse(call(i)[1].body as string)

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  process.env.OPENROUTER_API_KEY = 'or-env-key'
  delete process.env.AI_PRIVACY_MODE
  resetFakeDb()
  invalidateProviderCache()
  ledger.left = 10
  ledger.records = []
  fetchSpy = vi.fn(async () => ok('ответ', { model: 'alemllm', usage: { prompt_tokens: 100, completion_tokens: 20 } }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const [k, v] of [['SECRETS_ENCRYPTION_KEY', saved.key], ['OPENROUTER_API_KEY', saved.or], ['AI_PRIVACY_MODE', saved.privacy]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function configureAlem(opts: { tiers?: Array<'light' | 'standard' | 'premium'>; prices?: boolean; budget?: number; embeddings?: boolean } = {}) {
  const alem = seedProvider({ key: 'alem', name: 'Alem Plus', base_url: 'https://llm.alem.ai/v1', daily_budget_usd: opts.budget ?? null })
  seedCredential({ provider_id: alem.id, secret_ciphertext: encryptSecret(ALEM_KEY), secret_hint: '1111' })
  const chat = seedModel({
    provider_id: alem.id, model_id: 'alemllm', capability: 'chat',
    price_in_per_mtok: opts.prices ? 1 : null, price_out_per_mtok: opts.prices ? 2 : null,
  })
  for (const t of opts.tiers ?? ['light', 'standard', 'premium']) seedRoute('chat', t, chat.id)
  if (opts.embeddings) {
    const emb = seedModel({ provider_id: alem.id, model_id: 'alem-embedder', capability: 'embeddings' })
    seedRoute('embeddings', null, emb.id)
  }
  return alem
}

describe('callLlm (agents)', () => {
  it('uses the Alem route when configured: URL, key, body without OpenRouter fields, usage.provider', async () => {
    configureAlem({ prices: true })
    const r = await callLlm({ tier: 'standard', system: 's', user: 'u', maxTokens: 10, label: 'agent:test' })
    expect(r).toMatchObject({
      ok: true, text: 'ответ',
      usage: { model: 'alemllm', provider: 'alem', tokensIn: 100, tokensOut: 20, costSource: 'model_price' },
    })
    expect(r.ok && r.usage.costUsd).toBeCloseTo((100 * 1 + 20 * 2) / 1_000_000, 12)
    expect(call()[0]).toBe('https://llm.alem.ai/v1/chat/completions')
    expect((call()[1].headers as Record<string, string>).Authorization).toBe(`Bearer ${ALEM_KEY}`)
    expect(body()).toMatchObject({ model: 'alemllm', max_tokens: 10, temperature: 0.2 })
    expect(body()).not.toHaveProperty('provider')
    expect(body()).not.toHaveProperty('usage')
  })

  it('estimates the cost when Alem reports none and the model has no prices', async () => {
    configureAlem()
    const r = await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(r).toMatchObject({ ok: true, usage: { costSource: 'estimate', provider: 'alem' } })
  })

  it('falls back to OpenRouter (pre-094 behaviour) when nothing is configured', async () => {
    fetchSpy.mockResolvedValue(ok('x', { model: 'anthropic/claude-haiku-4.5', usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 } }))
    const r = await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(r).toMatchObject({ ok: true, usage: { provider: 'openrouter', costSource: 'provider', costUsd: 0.0001 } })
    expect(call()[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(body()).toMatchObject({ model: 'anthropic/claude-haiku-4.5', provider: { data_collection: 'deny' }, usage: { include: true } })
  })

  it('only routes the configured tiers; an explicit model is honoured', async () => {
    configureAlem({ tiers: ['light'] })
    await callLlm({ tier: 'premium', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(call(0)[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    await callLlm({ tier: 'light', model: 'openai/gpt-4o-mini', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(call(1)[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(body(1).model).toBe('openai/gpt-4o-mini')
  })

  it('works with an Alem key only (no OPENROUTER_API_KEY)', async () => {
    delete process.env.OPENROUTER_API_KEY
    configureAlem()
    expect(await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 10, label: 't' })).toMatchObject({ ok: true })
    expect(hasLlmKey()).toBe(true)
  })

  it('refuses with BUDGET_EXCEEDED once the provider budget is spent, without calling it', async () => {
    configureAlem({ budget: 1 })
    fakeDb.spendToday.alem = 1
    const r = await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(r).toMatchObject({ ok: false, error: 'BUDGET_EXCEEDED' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('callLlmJson validates Alem JSON with the schema', async () => {
    configureAlem()
    fetchSpy.mockResolvedValue(ok('{"score": 7}'))
    const r = await callLlmJson({ tier: 'standard', system: 's', user: 'u', maxTokens: 10, label: 't', schema: z.object({ score: z.number() }) })
    expect(r).toMatchObject({ ok: true, data: { score: 7 } })
    expect(body().response_format).toEqual({ type: 'json_object' })
  })
})

describe('chatWithOpenRouter / generateObjectViaOpenRouter / embedWithOpenRouter (features)', () => {
  it('chat follows the complexity tier route and records spend under the provider', async () => {
    configureAlem({ tiers: ['light'], prices: true })
    expect(await chatWithOpenRouter({ user: 'u', complexity: 'low', label: 'test.feature', companyId: 'c1' })).toBe('ответ')
    expect(call()[0]).toBe('https://llm.alem.ai/v1/chat/completions')
    expect(body()).not.toHaveProperty('provider')
    expect(ledger.records).toEqual([expect.objectContaining({
      source: 'feature:test.feature', model: 'alemllm', providerKey: 'alem', costSource: 'model_price', companyId: 'c1',
    })])
  })

  it('chat without configuration is unchanged: OpenRouter, privacy, provider cost', async () => {
    fetchSpy.mockResolvedValue(ok('ok', { model: 'anthropic/claude-haiku-4.5', usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.002 } }))
    expect(await chatWithOpenRouter({ user: 'u', complexity: 'low', label: 'f' })).toBe('ok')
    expect(call()[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(body()).toMatchObject({ model: 'anthropic/claude-haiku-4.5', provider: { data_collection: 'deny' }, usage: { include: true } })
    expect(ledger.records[0]).toMatchObject({ providerKey: 'openrouter', costSource: 'provider', costUsd: 0.002 })
  })

  it('structured generation routes through the same chat path', async () => {
    configureAlem()
    fetchSpy.mockResolvedValue(ok('{"title":"Отчёт"}'))
    const out = await generateObjectViaOpenRouter({ system: 's', user: 'u', schema: z.object({ title: z.string() }), complexity: 'high', label: 'test.structured' })
    expect(out).toEqual({ title: 'Отчёт' })
    expect(call()[0]).toBe('https://llm.alem.ai/v1/chat/completions')
  })

  it('embeddings use the embeddings route when configured, OpenRouter otherwise', async () => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2] }], usage: { prompt_tokens: 3 } }), { status: 200 }))
    expect(await embedWithOpenRouter(['a'])).toEqual([[1, 2]])
    expect(call(0)[0]).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(body(0)).toEqual({ model: 'openai/text-embedding-3-small', input: ['a'], dimensions: 1536 })

    configureAlem({ embeddings: true })
    invalidateProviderCache()
    expect(await embedWithOpenRouter(['a'])).toEqual([[1, 2]])
    expect(call(1)[0]).toBe('https://llm.alem.ai/v1/embeddings')
    expect(body(1)).toEqual({ model: 'alem-embedder', input: ['a'] })
    expect(ledger.records.at(-1)).toMatchObject({ source: 'feature:embeddings', providerKey: 'alem', model: 'alem-embedder' })
  })

  it('returns null without any key, as before', async () => {
    delete process.env.OPENROUTER_API_KEY
    expect(await chatWithOpenRouter({ user: 'u' })).toBeNull()
    expect(await embedWithOpenRouter(['a'])).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).ok).toBe(false)
  })
})
