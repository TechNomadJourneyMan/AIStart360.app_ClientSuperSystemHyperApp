/**
 * PO decision 2026-11-02 (migration 137): Claude is the default chat model;
 * the llm.alem.ai models — Qwen (`AlemLLM`) and Alem (`alemllm`) — are the
 * cheap light tier and the fallback. On a snapshot that mirrors production
 * after 137: the candidate chain of every tier, failover on 402 (OpenRouter
 * out of credits), the 400 that rejects the model / output format (fails
 * over) vs a generic 400 (stops), and the structured retry one tier up.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)
vi.mock('@/lib/ai/usage-ledger', () => ({
  platformBudgetLeft: async () => 10,
  recordUsage: async () => undefined,
  budgetFailsClosed: () => false,
}))

import { encryptSecret } from '@/lib/crypto/secrets'
import { callLlm } from '@/lib/ai/gateway'
import { escalateComplexity } from '@/lib/ai/complexity'
import { chatWithOpenRouter, OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import { generateObjectViaOpenRouter } from '@/lib/ai/structured'
import type { ClientFailure } from '@/lib/ai/providers/client'
import { isFailoverWorthy, isModelOrFormatRejection } from '@/lib/ai/providers/failover'
import { healthOf, isHealthy } from '@/lib/ai/providers/health'
import { invalidateProviderCache, resolveCandidates } from '@/lib/ai/providers/router'
import { resetFakeDb, seedCredential, seedModel, seedProvider, seedRoute } from './providers-fake-store'

const SONNET = OPENROUTER_MODELS.sonnet
const HAIKU = OPENROUTER_MODELS.haiku
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions'
const ALEM_URL = 'https://llm.alem.ai/v1/chat/completions'
const saved = { key: process.env.SECRETS_ENCRYPTION_KEY, or: process.env.OPENROUTER_API_KEY, alem: process.env.ALEM_API_KEY }

let fetchSpy: ReturnType<typeof vi.fn>
const url = (i: number) => (fetchSpy.mock.calls[i] as unknown as [string, RequestInit])[0]
const body = (i: number) => JSON.parse((fetchSpy.mock.calls[i] as unknown as [string, RequestInit])[1].body as string)
const ok = (content: string, model = 'm') =>
  new Response(JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 })
const http = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message, code: status } }), { status })

/**
 * Production after 137. Models are seeded in the order the store lists them
 * (ORDER BY capability, model_id): the Alem rows come before Claude, so the
 * order of the chains is the router's doing, not the listing's.
 */
function seedAfter137() {
  const or = seedProvider({ key: 'openrouter', name: 'OpenRouter', kind: 'openrouter', base_url: 'https://openrouter.ai/api/v1' })
  const alem = seedProvider({ key: 'alem', name: 'Alem Plus', base_url: 'https://llm.alem.ai/v1' })
  const qwen = seedProvider({ key: 'o66krtxb5ti0mjr', name: 'Qwen, by Chat', base_url: 'https://llm.alem.ai/v1' })
  const orKey = seedCredential({ provider_id: or.id, label: 'OpenRouter', secret_ciphertext: encryptSecret('or-key-0000') })
  const alemKey = seedCredential({ provider_id: alem.id, label: 'Alem', secret_ciphertext: encryptSecret('alem-key-1111') })
  const qwenKey = seedCredential({ provider_id: qwen.id, label: 'Qwen', secret_ciphertext: encryptSecret('qwen-key-2222') })
  const embKey = seedCredential({ provider_id: qwen.id, label: 'Embedder', secret_ciphertext: encryptSecret('embd-key-3333') })

  const qwenChat = seedModel({ provider_id: qwen.id, credential_id: qwenKey.id, model_id: 'AlemLLM', capability: 'chat', label: 'Qwen, by Chat', tier_hint: 'light' })
  seedModel({ provider_id: alem.id, credential_id: alemKey.id, model_id: 'alemllm', capability: 'chat', label: 'Alem LLM', tier_hint: 'light' })
  const haiku = seedModel({ provider_id: or.id, credential_id: orKey.id, model_id: HAIKU, capability: 'chat', label: 'Claude Haiku 4.5', tier_hint: 'standard' })
  const sonnet = seedModel({ provider_id: or.id, credential_id: orKey.id, model_id: SONNET, capability: 'chat', label: 'Claude Sonnet 4.5', tier_hint: 'premium' })
  const emb = seedModel({ provider_id: qwen.id, credential_id: embKey.id, model_id: 'Embedder', capability: 'embeddings' })

  seedRoute('chat', 'light', qwenChat.id)
  seedRoute('chat', 'premium', sonnet.id)
  seedRoute('chat', 'standard', haiku.id)
  seedRoute('embeddings', null, emb.id)
  return { orKey, haiku, sonnet }
}

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  process.env.OPENROUTER_API_KEY = 'or-env-key'
  delete process.env.ALEM_API_KEY
  resetFakeDb()
  invalidateProviderCache()
  fetchSpy = vi.fn(async () => ok('ответ'))
  vi.stubGlobal('fetch', fetchSpy)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const [k, v] of [['SECRETS_ENCRYPTION_KEY', saved.key], ['OPENROUTER_API_KEY', saved.or], ['ALEM_API_KEY', saved.alem]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

// ── candidate chains ────────────────────────────────────────────────────────

describe('chains after 137', () => {
  const chain = async (tier: 'light' | 'standard' | 'premium', fallbackModel: string) => {
    const r = await resolveCandidates('chat', { tier, fallbackModel })
    if (!r.ok) throw new Error(r.message)
    return r.candidates.map((t) => `${t.providerKey}:${t.model}`)
  }

  it('premium: Sonnet → Haiku → Qwen → Alem → built-in', async () => {
    seedAfter137()
    expect(await chain('premium', OPENROUTER_MODELS.opus48)).toEqual([
      `openrouter:${SONNET}`, `openrouter:${HAIKU}`, 'o66krtxb5ti0mjr:AlemLLM', 'alem:alemllm', `openrouter:${OPENROUTER_MODELS.opus48}`,
    ])
  })

  it('standard: Haiku → Sonnet → Qwen → Alem (the stronger tier first at the same distance)', async () => {
    seedAfter137()
    // The built-in fallback (Sonnet, same key) is the Sonnet row: not repeated.
    expect(await chain('standard', SONNET)).toEqual([
      `openrouter:${HAIKU}`, `openrouter:${SONNET}`, 'o66krtxb5ti0mjr:AlemLLM', 'alem:alemllm',
    ])
  })

  it('light (cheap tier): Qwen → Alem → Haiku → Sonnet', async () => {
    seedAfter137()
    expect(await chain('light', HAIKU)).toEqual([
      'o66krtxb5ti0mjr:AlemLLM', 'alem:alemllm', `openrouter:${HAIKU}`, `openrouter:${SONNET}`,
    ])
  })

  it('Point A complexities: summary (high) goes to Haiku, blocks (medium) and hypotheses (low) to Qwen', async () => {
    seedAfter137()
    await chatWithOpenRouter({ feature: 'point_a_analysis', user: 'u', complexity: 'high' })
    await chatWithOpenRouter({ feature: 'point_a_analysis', user: 'u', complexity: 'medium' })
    await chatWithOpenRouter({ feature: 'point_a_hypothesis', user: 'u', complexity: 'low' })
    expect([0, 1, 2].map((i) => body(i).model)).toEqual([HAIKU, 'AlemLLM', 'AlemLLM'])
  })
})

// ── 402: no OpenRouter credits ──────────────────────────────────────────────

describe('402 fails over', () => {
  it('is failover-worthy', () => {
    const f: ClientFailure = { ok: false, code: 'PROVIDER_ERROR', status: 402, message: 'HTTP 402', retryable: false, detail: null }
    expect(isFailoverWorthy(f)).toBe(true)
  })

  it('credits ran out: Haiku and Sonnet answer 402, Qwen answers; both Claude targets go behind for 5 minutes', async () => {
    const { orKey } = seedAfter137()
    const noCredits = () => http(402, 'Insufficient credits. Add more using https://openrouter.ai/settings/credits')
    fetchSpy.mockResolvedValueOnce(noCredits()).mockResolvedValueOnce(noCredits())
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', complexity: 'high' })).toBe('ответ')
    expect([url(0), url(1), url(2)]).toEqual([OR_URL, OR_URL, ALEM_URL])
    expect([body(0).model, body(1).model, body(2).model]).toEqual([HAIKU, SONNET, 'AlemLLM'])

    const haiku = { providerKey: 'openrouter', model: HAIKU, credentialId: orKey.id }
    expect(isHealthy(haiku)).toBe(false)
    expect(healthOf(haiku)?.lastError).toBe('HTTP 402 (нет кредитов / оплаты)')
    expect(isHealthy({ providerKey: 'openrouter', model: SONNET, credentialId: orKey.id })).toBe(false)

    // The next standard call starts with the healthy Kazakh models.
    fetchSpy.mockClear()
    await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', complexity: 'high' })
    expect(url(0)).toBe(ALEM_URL)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('callLlm (agents) fails over on 402 too', async () => {
    seedAfter137()
    fetchSpy.mockResolvedValueOnce(http(402, 'Insufficient credits'))
    const r = await callLlm({ tier: 'premium', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(r).toMatchObject({ ok: true, usage: { provider: 'openrouter', attempts: 2 } })
    expect([body(0).model, body(1).model]).toEqual([SONNET, HAIKU])
  })
})

// ── 400: the model or the output format vs the prompt ───────────────────────

describe('400 that rejects the model or the output format', () => {
  const f400 = (detail: string | null, status = 400): ClientFailure =>
    ({ ok: false, code: 'PROVIDER_ERROR', status, message: `HTTP ${status}`, retryable: false, detail })

  it('classifies the provider text', () => {
    for (const d of [
      '{"error":{"message":"Claude is not a valid model ID","code":400}}',
      '{"error":{"message":"The model `x` does not exist"}}',
      '{"object":"error","message":"response_format json_schema is not supported by this model"}',
      '{"error":{"message":"Invalid schema for response_format \'point_a\'"}}',
      'Structured outputs are unsupported for this endpoint',
      'model_not_found',
    ]) expect(isModelOrFormatRejection(f400(d))).toBe(true)
    for (const d of [
      '{"error":{"message":"messages: field required"}}',
      '{"error":{"message":"Invalid request: max_tokens must be a positive integer"}}',
      null,
    ]) expect(isModelOrFormatRejection(f400(d))).toBe(false)
    // Only a 400: other statuses keep their own rule.
    expect(isModelOrFormatRejection(f400('model not supported', 422))).toBe(false)
  })

  it('an invalid model id fails over to the next candidate (not marked unhealthy)', async () => {
    const { orKey } = seedAfter137()
    fetchSpy.mockResolvedValueOnce(http(400, `${HAIKU} is not a valid model ID`))
    expect(await chatWithOpenRouter({ feature: 'point_a_analysis', user: 'u', complexity: 'high' })).toBe('ответ')
    expect([body(0).model, body(1).model]).toEqual([HAIKU, SONNET])
    expect(isHealthy({ providerKey: 'openrouter', model: HAIKU, credentialId: orKey.id })).toBe(true)
  })

  it('a json_schema the cheap model rejects goes to the next one; the detail is not logged for a privacy-sensitive call', async () => {
    seedAfter137()
    fetchSpy.mockResolvedValueOnce(http(400, 'response_format json_schema is not supported; prompt was: SECRET-CLIENT-TEXT'))
    const out = await chatWithOpenRouter({
      feature: 'ai_chat', user: 'u', complexity: 'low', privacySensitive: true,
      jsonSchema: { name: 's', schema: { type: 'object' } },
    })
    expect(out).toBe('ответ')
    expect(body(0)).toMatchObject({ model: 'AlemLLM', response_format: { type: 'json_schema' } })
    expect(body(1).model).toBe('alemllm')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('SECRET-CLIENT-TEXT')
  })

  it('a generic 400 (bad prompt) still stops the chain', async () => {
    seedAfter137()
    fetchSpy.mockResolvedValueOnce(http(400, 'messages: field required'))
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', complexity: 'high' })).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockClear()
    fetchSpy.mockResolvedValueOnce(http(400, 'messages: field required'))
    expect(await callLlm({ tier: 'standard', system: 's', user: 'u', maxTokens: 10, label: 't' })).toMatchObject({ ok: false })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('callLlm fails over on a model rejection', async () => {
    seedAfter137()
    fetchSpy.mockResolvedValueOnce(http(400, 'Claude is not a valid model ID'))
    expect(await callLlm({ tier: 'standard', system: 's', user: 'u', maxTokens: 10, label: 't' })).toMatchObject({ ok: true, usage: { attempts: 2 } })
  })
})

// ── structured output: the retry goes one tier up ───────────────────────────

describe('structured retry one tier up', () => {
  it('escalateComplexity: low / medium → high (light → standard); high and max stay', () => {
    expect((['low', 'medium', 'high', 'max'] as const).map((c) => escalateComplexity(c))).toEqual(['high', 'high', 'high', 'max'])
  })

  it('a broken Qwen answer is redone by Claude Haiku', async () => {
    seedAfter137()
    fetchSpy
      .mockResolvedValueOnce(ok('Конечно! Вот анализ без JSON.', 'AlemLLM'))
      .mockResolvedValueOnce(ok('{"title":"Финансы"}', HAIKU))
    const out = await generateObjectViaOpenRouter({
      feature: 'point_a_analysis', label: 'point-a:blocksA', complexity: 'medium', maxTokens: 2000,
      system: 's', user: 'u', schema: z.object({ title: z.string() }),
    })
    expect(out).toEqual({ title: 'Финансы' })
    expect([url(0), body(0).model]).toEqual([ALEM_URL, 'AlemLLM'])
    expect([url(1), body(1).model]).toEqual([OR_URL, HAIKU])
  })

  it('a schema-invalid answer escalates too; an explicit model never does', async () => {
    seedAfter137()
    fetchSpy
      .mockResolvedValueOnce(ok('{"title":7}', 'AlemLLM'))
      .mockResolvedValueOnce(ok('{"title":"ok"}', HAIKU))
    await generateObjectViaOpenRouter({ feature: 'ai_chat', complexity: 'low', maxTokens: 500, system: 's', user: 'u', schema: z.object({ title: z.string() }) })
    expect([body(0).model, body(1).model]).toEqual(['AlemLLM', HAIKU])

    fetchSpy.mockReset()
    fetchSpy.mockImplementation(async () => ok('{"title":7}', 'AlemLLM'))
    expect(await generateObjectViaOpenRouter({
      feature: 'ai_chat', model: 'AlemLLM', complexity: 'low', maxTokens: 500, system: 's', user: 'u', schema: z.object({ title: z.string() }),
    })).toBeNull()
    expect([body(0).model, body(1).model]).toEqual(['AlemLLM', 'AlemLLM'])
  })
})
