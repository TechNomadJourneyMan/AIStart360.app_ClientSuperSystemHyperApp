/**
 * Part A1: model discovery and its heuristics, binding keys to models,
 * candidate ordering, the explicit-but-unavailable model, failover with the
 * circuit breaker, embeddings without failover, hasLlmKey.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)
const ledger = vi.hoisted(() => ({ left: 10 as number | null, records: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ai/usage-ledger', () => ({
  platformBudgetLeft: async () => ledger.left,
  recordUsage: async (r: Record<string, unknown>) => { ledger.records.push(r) },
  budgetFailsClosed: () => false,
}))
const audit = vi.hoisted(() => ({ entries: [] as Array<{ action: unknown; opts: unknown }> }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: Record<string, unknown>, _req: unknown, opts: unknown = {}) => {
    audit.entries.push({ action: entry.action, opts })
    return true
  },
}))

import { encryptSecret } from '@/lib/crypto/secrets'
import { callLlm, hasLlmKey } from '@/lib/ai/gateway'
import { chatWithOpenRouter, embedWithOpenRouter } from '@/lib/ai/openrouter'
import { modelIdsOf } from '@/lib/ai/providers/client'
import { classifyModelId, discoverAllModels, discoverCredentialModels } from '@/lib/ai/providers/discovery'
import { addCredential, discoverModels, verifyCredential } from '@/lib/ai/providers/service'
import { isFailoverWorthy, runWithFailover } from '@/lib/ai/providers/failover'
import { healthOf, isHealthy, markFailure, UNHEALTHY_FOR_MS } from '@/lib/ai/providers/health'
import { hasConfiguredChatRoute, invalidateProviderCache, resolveCandidates, resolveTarget } from '@/lib/ai/providers/router'
import type { ProviderTarget } from '@/lib/ai/providers/types'
import { fakeDb, resetFakeDb, seedCredential, seedModel, seedProvider, seedRoute } from './providers-fake-store'

const saved = { key: process.env.SECRETS_ENCRYPTION_KEY, or: process.env.OPENROUTER_API_KEY, alem: process.env.ALEM_API_KEY }
const publicDns = async () => ['93.184.216.34']

let fetchSpy: ReturnType<typeof vi.fn>
const url = (i: number) => (fetchSpy.mock.calls[i] as unknown as [string, RequestInit])[0]
const req = (i: number) => (fetchSpy.mock.calls[i] as unknown as [string, RequestInit])[1]
const body = (i: number) => JSON.parse(req(i).body as string)
const auth = (i: number) => (req(i).headers as Record<string, string>).Authorization
const ok = (content: string, model = 'm') =>
  new Response(JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 })

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  delete process.env.OPENROUTER_API_KEY
  delete process.env.ALEM_API_KEY
  resetFakeDb()
  invalidateProviderCache()
  ledger.left = 10
  ledger.records = []
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

/** Production-like Alem: one key per model, models without a bound key, routes to AlemLLM. */
function seedAlemPerModelKeys() {
  const p = seedProvider({ key: 'o66', name: 'Alem LLM', base_url: 'https://llm.alem.ai/v1', ocr_mode: 'chat_vision' })
  const keys = {
    qwen: seedCredential({ provider_id: p.id, label: 'Qwen', secret_ciphertext: encryptSecret('key-qwen-000000') }),
    alem: seedCredential({ provider_id: p.id, label: 'Alem LLM', secret_ciphertext: encryptSecret('key-alem-111111') }),
    emb: seedCredential({ provider_id: p.id, label: 'Embedder', secret_ciphertext: encryptSecret('key-embd-222222') }),
    stt: seedCredential({ provider_id: p.id, label: 'Speech to Text', secret_ciphertext: encryptSecret('key-sttx-333333') }),
  }
  const chat = seedModel({ provider_id: p.id, model_id: 'AlemLLM', capability: 'chat' })
  const emb = seedModel({ provider_id: p.id, model_id: 'Embedder', capability: 'embeddings' })
  for (const t of ['light', 'standard', 'premium'] as const) seedRoute('chat', t, chat.id)
  seedRoute('embeddings', null, emb.id)
  return { p, keys, chat, emb }
}

const LISTS: Record<string, string[]> = {
  'key-qwen-000000': ['Qwen3-8B'],
  'key-alem-111111': ['AlemLLM'],
  'key-embd-222222': ['Embedder'],
  'key-sttx-333333': ['speech-to-text'],
}
const modelsFetch = (async (_url: string, init: RequestInit) => {
  const key = String((init.headers as Record<string, string>).Authorization).replace('Bearer ', '')
  return new Response(JSON.stringify({ object: 'list', data: (LISTS[key] ?? []).map((id) => ({ id, object: 'model' })) }), { status: 200 })
}) as unknown as typeof fetch

// ── discovery ───────────────────────────────────────────────────────────────

describe('discovery', () => {
  it('classifies model ids by name', () => {
    expect(classifyModelId('text-embedding-3-small')).toEqual({ capability: 'embeddings', vision: null })
    expect(classifyModelId('Embedder')).toMatchObject({ capability: 'embeddings' })
    expect(classifyModelId('bge-reranker-v2')).toMatchObject({ capability: 'rerank' })
    expect(classifyModelId('Reranker')).toMatchObject({ capability: 'rerank' })
    expect(classifyModelId('whisper-large-v3')).toMatchObject({ capability: 'transcribe' })
    expect(classifyModelId('kaz-stt')).toMatchObject({ capability: 'transcribe' })
    expect(classifyModelId('Speech-to-Text')).toMatchObject({ capability: 'transcribe' })
    expect(classifyModelId('deepseek-ocr')).toMatchObject({ capability: 'ocr' })
    expect(classifyModelId('Qwen2.5-VL-72B')).toEqual({ capability: 'chat', vision: true })
    expect(classifyModelId('llama-3.2-vision')).toEqual({ capability: 'chat', vision: true })
    expect(classifyModelId('AlemLLM')).toEqual({ capability: 'chat', vision: null })
    expect(classifyModelId('gpt-oss-120b')).toEqual({ capability: 'chat', vision: null })
    expect(classifyModelId('tts-1')).toBeNull()
    expect(classifyModelId('dall-e-3')).toBeNull()
  })

  it('reads OpenAI / LiteLLM model lists defensively', () => {
    expect(modelIdsOf({ data: [{ id: 'a' }, { id: ' b ' }, { id: 'a' }, { nope: 1 }, { id: '' }] })).toEqual(['a', 'b'])
    expect(modelIdsOf(['x', 'y'])).toEqual(['x', 'y'])
    expect(modelIdsOf({ models: [{ name: 'z' }] })).toEqual(['z'])
    expect(modelIdsOf(null)).toEqual([])
  })

  it('stores the list per key, adds new models bound to the key that serves them, binds the owner\'s models', async () => {
    const { keys, chat, emb } = seedAlemPerModelKeys()
    const out = await discoverAllModels({ fetchImpl: modelsFetch, resolve: publicDns })
    expect(out.every((r) => r.ok)).toBe(true)
    expect(fakeDb.credentials.find((c) => c.id === keys.alem.id)?.discovered_models).toEqual(['AlemLLM'])

    // The owner's rows are only bound (unambiguous: exactly one key lists them), never re-classified.
    expect(fakeDb.models.find((m) => m.id === chat.id)).toMatchObject({ credential_id: keys.alem.id, model_id: 'AlemLLM' })
    expect(fakeDb.models.find((m) => m.id === emb.id)).toMatchObject({ credential_id: keys.emb.id })
    // New models: discovered and bound to their key.
    expect(fakeDb.models.find((m) => m.model_id === 'Qwen3-8B')).toMatchObject({ capability: 'chat', source: 'discovered', credential_id: keys.qwen.id })
    expect(fakeDb.models.find((m) => m.model_id === 'speech-to-text')).toMatchObject({ capability: 'transcribe', credential_id: keys.stt.id })
    expect(fakeDb.models).toHaveLength(4)
  })

  it('does not bind while another key has not been discovered (ambiguous)', async () => {
    const { keys, chat } = seedAlemPerModelKeys()
    await discoverCredentialModels(keys.alem.id, { fetchImpl: modelsFetch, resolve: publicDns })
    expect(fakeDb.models.find((m) => m.id === chat.id)?.credential_id).toBeNull()
    // …but the router already prefers the key that listed the model.
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'x' })).toMatchObject({ ok: true, target: { model: 'AlemLLM', apiKey: 'key-alem-111111' } })
  })

  it('a key without GET /models stays usable; the error is stored on the key', async () => {
    const { keys } = seedAlemPerModelKeys()
    const r = await discoverCredentialModels(keys.qwen.id, { fetchImpl: (async () => new Response('no', { status: 404 })) as typeof fetch, resolve: publicDns })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('HTTP 404') })
    expect(fakeDb.credentials.find((c) => c.id === keys.qwen.id)).toMatchObject({ discovery_error: expect.stringContaining('404') })
    expect(fakeDb.credentials.find((c) => c.id === keys.qwen.id)?.discovered_models).toBeUndefined()
  })

  it('service: «Обнаружить модели» is audited first; add/verify discover when asked', async () => {
    const { p, keys } = seedAlemPerModelKeys()
    audit.entries = []
    const staff = { kind: 'staff' as const, id: '00000000-0000-4000-8000-000000000001', label: 'owner' }
    const res = await discoverModels(staff, { providerId: p.id }, { fetchImpl: modelsFetch, resolve: publicDns })
    expect(res).toHaveLength(4)
    expect(audit.entries[0]).toEqual({ action: 'ai.models.discover', opts: { required: true } })

    const added = await addCredential(staff, p.id, 'Reranker', 'key-rerank-4444', { discover: { fetchImpl: (async () => new Response(JSON.stringify({ data: [{ id: 'Reranker' }] }), { status: 200 })) as unknown as typeof fetch, resolve: publicDns } })
    expect(added.discovered_models).toEqual(['Reranker'])
    expect(fakeDb.models.find((m) => m.model_id === 'Reranker')).toMatchObject({ capability: 'rerank', source: 'discovered' })

    const v = await verifyCredential(staff, keys.alem.id, { fetchImpl: modelsFetch, resolve: publicDns, discover: true })
    expect(v.discovery).toMatchObject({ ok: true, ids: ['AlemLLM'] })
    // Off by default under the test runner (no network in unit tests).
    const silent = await verifyCredential(staff, keys.alem.id, { fetchImpl: modelsFetch, resolve: publicDns })
    expect(silent.discovery).toBeNull()
  })

  it('a rediscovered model is rebound when its key was disabled; disabled keys are skipped', async () => {
    const { keys } = seedAlemPerModelKeys()
    await discoverAllModels({ fetchImpl: modelsFetch, resolve: publicDns })
    const second = seedCredential({ provider_id: keys.qwen.provider_id, label: 'Qwen 2', secret_ciphertext: encryptSecret('key-qwen-000000') })
    keys.qwen.enabled = false
    const out = await discoverAllModels({ fetchImpl: modelsFetch, resolve: publicDns })
    expect(out.map((r) => r.credentialLabel)).not.toContain('Qwen')
    expect(fakeDb.models.find((m) => m.model_id === 'Qwen3-8B')?.credential_id).toBe(second.id)
  })
})

// ── candidates ──────────────────────────────────────────────────────────────

describe('resolveCandidates', () => {
  it('keyFor: a model without a bound key uses the key whose discovery listed it, not the first key', async () => {
    seedAlemPerModelKeys()
    fakeDb.credentials[0].discovered_models = ['Qwen3-8B']
    fakeDb.credentials[1].discovered_models = ['AlemLLM']
    invalidateProviderCache()
    expect(await resolveTarget('chat', { tier: 'standard', fallbackModel: 'x' })).toMatchObject({ ok: true, target: { apiKey: 'key-alem-111111' } })
  })

  it('without discovery data keeps the old rule (first enabled key)', async () => {
    seedAlemPerModelKeys()
    expect(await resolveTarget('chat', { tier: 'standard', fallbackModel: 'x' })).toMatchObject({ ok: true, target: { apiKey: 'key-qwen-000000' } })
  })

  it('orders route → other models (tier hint first, manual before discovered) → built-in OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key'
    const p = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    const routed = seedModel({ provider_id: p.id, model_id: 'routed', capability: 'chat' })
    seedModel({ provider_id: p.id, model_id: 'disc-any', capability: 'chat', source: 'discovered' })
    seedModel({ provider_id: p.id, model_id: 'manual-any', capability: 'chat' })
    seedModel({ provider_id: p.id, model_id: 'premium-hint', capability: 'chat', tier_hint: 'premium' })
    seedModel({ provider_id: p.id, model_id: 'light-hint', capability: 'chat', tier_hint: 'light' })
    seedModel({ provider_id: p.id, model_id: 'off', capability: 'chat', enabled: false })
    seedModel({ provider_id: p.id, model_id: 'emb', capability: 'embeddings' })
    seedRoute('chat', 'light', routed.id)
    const r = await resolveCandidates('chat', { tier: 'light', fallbackModel: 'anthropic/claude-haiku-4.5' })
    expect(r.ok && r.candidates.map((t) => t.model)).toEqual([
      'routed', 'light-hint', 'manual-any', 'disc-any', 'premium-hint', 'anthropic/claude-haiku-4.5',
    ])
  })

  it('an explicit model that is unavailable (no OpenRouter key) becomes a chat model of the matching tier', async () => {
    const p = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    const light = seedModel({ provider_id: p.id, model_id: 'kaz-light', capability: 'chat' })
    const std = seedModel({ provider_id: p.id, model_id: 'alem-std', capability: 'chat' })
    seedRoute('chat', 'light', light.id)
    seedRoute('chat', 'standard', std.id)
    // haiku is a light model: no tier given → its known tier.
    expect(await resolveTarget('chat', { model: 'anthropic/claude-haiku-4.5', fallbackModel: 'anthropic/claude-haiku-4.5' }))
      .toMatchObject({ ok: true, target: { model: 'kaz-light' } })
    expect(await resolveTarget('chat', { model: 'anthropic/claude-sonnet-4.5', fallbackModel: 'anthropic/claude-sonnet-4.5' }))
      .toMatchObject({ ok: true, target: { model: 'alem-std' } })
    // And through the real entry point: no OpenRouter call, Alem answers.
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', model: 'anthropic/claude-haiku-4.5' })).toBe('ответ')
    expect(url(0)).toBe('https://llm.example.com/v1/chat/completions')
    expect(body(0).model).toBe('kaz-light')
  })

  it('tools / vision filters: known-incapable models are skipped, capable ones first', async () => {
    const p = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    seedModel({ provider_id: p.id, model_id: 'no-tools', capability: 'chat', supports_tools: false })
    seedModel({ provider_id: p.id, model_id: 'unknown', capability: 'chat' })
    seedModel({ provider_id: p.id, model_id: 'vision', capability: 'chat', supports_vision: true, supports_tools: true })
    const t = await resolveCandidates('chat', { tier: 'standard', requireTools: true })
    expect(t.ok && t.candidates.map((x) => x.model)).toEqual(['vision', 'unknown'])
    const v = await resolveCandidates('chat', { tier: 'standard', requireVision: true })
    expect(v.ok && v.candidates[0].model).toBe('vision')
  })

  it('rerank / OCR need provider support; transcribe resolves discovered models', async () => {
    const p = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    seedModel({ provider_id: p.id, model_id: 'Reranker', capability: 'rerank' })
    seedModel({ provider_id: p.id, model_id: 'stt', capability: 'transcribe' })
    expect(await resolveTarget('rerank')).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' })
    expect(await resolveTarget('transcribe')).toMatchObject({ ok: true, target: { model: 'stt' } })
  })

  it('unhealthy targets go last; healthy order otherwise', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key'
    const p = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    const m = seedModel({ provider_id: p.id, model_id: 'routed', capability: 'chat' })
    seedRoute('chat', 'standard', m.id)
    const first = await resolveCandidates('chat', { tier: 'standard', fallbackModel: 'fb' })
    if (!first.ok) throw new Error('expected candidates')
    markFailure(first.candidates[0], 'HTTP 503')
    const second = await resolveCandidates('chat', { tier: 'standard', fallbackModel: 'fb' })
    expect(second.ok && second.candidates.map((t) => t.model)).toEqual(['fb', 'routed'])
  })

  it('hasLlmKey: any usable chat model counts, a route is not required', async () => {
    expect(hasLlmKey()).toBe(false)
    const p = seedProvider({ key: 'o66' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    seedModel({ provider_id: p.id, model_id: 'Qwen3-8B', capability: 'chat', source: 'discovered' })
    await resolveTarget('chat', { tier: 'light' }) // warm the cache
    expect(hasConfiguredChatRoute()).toBe(true)
    expect(hasLlmKey()).toBe(true)
  })

  it('hasLlmKey is false when the only chat model has no usable key', async () => {
    const p = seedProvider({ key: 'o66' })
    seedModel({ provider_id: p.id, model_id: 'AlemLLM', capability: 'chat' })
    await resolveTarget('chat', { tier: 'light' })
    expect(hasLlmKey()).toBe(false)
  })
})

// ── failover ────────────────────────────────────────────────────────────────

describe('failover', () => {
  function twoProviders() {
    process.env.OPENROUTER_API_KEY = 'or-key'
    const a = seedProvider({ key: 'alem', base_url: 'https://a.example.com/v1' })
    seedCredential({ provider_id: a.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    const b = seedProvider({ key: 'backup', base_url: 'https://b.example.com/v1' })
    seedCredential({ provider_id: b.id, secret_ciphertext: encryptSecret('backup-key-000') })
    const m = seedModel({ provider_id: a.id, model_id: 'primary', capability: 'chat' })
    seedModel({ provider_id: b.id, model_id: 'secondary', capability: 'chat' })
    for (const t of ['light', 'standard', 'premium'] as const) seedRoute('chat', t, m.id)
  }

  it('classifies failover-worthy errors', () => {
    const f = (status: number | null, retryable = true) => ({ ok: false as const, code: 'PROVIDER_ERROR' as const, status, message: '', retryable, detail: null })
    for (const s of [401, 403, 404, 408, 429, 500, 502, 503]) expect(isFailoverWorthy(f(s))).toBe(true)
    expect(isFailoverWorthy(f(400, false))).toBe(false)
    expect(isFailoverWorthy(f(422, false))).toBe(false)
    expect(isFailoverWorthy(f(null, true))).toBe(true) // timeout / network
  })

  it('callLlm moves to the next candidate on 5xx and marks the failed target unhealthy for 5 minutes', async () => {
    twoProviders()
    fetchSpy.mockResolvedValueOnce(new Response('busy', { status: 503 }))
    const r = await callLlm({ tier: 'standard', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(r).toMatchObject({ ok: true, usage: { provider: 'backup', model: 'm', attempts: 2 } })
    expect(url(0)).toBe('https://a.example.com/v1/chat/completions')
    expect(url(1)).toBe('https://b.example.com/v1/chat/completions')
    const failed = { providerKey: 'alem', model: 'primary', credentialId: fakeDb.credentials[0].id }
    expect(isHealthy(failed)).toBe(false)
    expect(healthOf(failed)).toMatchObject({ lastError: 'HTTP 503', failures: 1 })
    const until = healthOf(failed)!.unhealthyUntil!
    expect(until - Date.now()).toBeGreaterThan(UNHEALTHY_FOR_MS - 5_000)

    // Next call starts with the healthy backup.
    fetchSpy.mockClear()
    await callLlm({ tier: 'standard', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(url(0)).toBe('https://b.example.com/v1/chat/completions')
  })

  it('401 / 429 / timeout fail over; a 400 does not', async () => {
    twoProviders()
    fetchSpy.mockResolvedValueOnce(new Response('bad key', { status: 401 }))
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', complexity: 'high' })).toBe('ответ')
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    resetFakeDb(); invalidateProviderCache(); fetchSpy.mockReset(); ledger.records = []
    twoProviders()
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' })
    fetchSpy.mockRejectedValueOnce(timeout).mockResolvedValueOnce(ok('ok'))
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', complexity: 'high', label: 'lbl' })).toBe('ok')
    // Ledger per attempt as before: the timed-out one (worst case) and the answer.
    expect(ledger.records.map((r) => [r.providerKey, r.ok])).toEqual([['alem', false], ['backup', true]])

    resetFakeDb(); invalidateProviderCache(); fetchSpy.mockReset()
    twoProviders()
    fetchSpy.mockResolvedValueOnce(new Response('bad request', { status: 400 }))
    expect(await chatWithOpenRouter({ feature: 'ai_chat', user: 'u', complexity: 'high' })).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('all candidates down → the last error', async () => {
    twoProviders()
    fetchSpy.mockImplementation(async () => new Response('down', { status: 502 }))
    const r = await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 10, label: 't' })
    expect(r).toMatchObject({ ok: false, error: 'PROVIDER_ERROR' })
    expect(fetchSpy).toHaveBeenCalledTimes(3) // primary, secondary, built-in OpenRouter
  })

  it('a lone candidate is retried once on a retryable error (pre-A1 behaviour)', async () => {
    vi.useFakeTimers()
    try {
      const target = { providerKey: 'x', model: 'y', credentialId: null } as unknown as ProviderTarget
      const attempt = vi.fn()
        .mockResolvedValueOnce({ ok: false, code: 'RATE_LIMITED', status: 429, message: 'HTTP 429', retryable: true, detail: null })
        .mockResolvedValueOnce({ ok: true })
      const p = runWithFailover([target], attempt, { retryAlone: true, retryDelayMs: 10 })
      await vi.advanceTimersByTimeAsync(20)
      expect(await p).toMatchObject({ ok: true, attempts: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('embeddings never switch models: one candidate, the routed one, even when it fails', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key'
    const p = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    const emb = seedModel({ provider_id: p.id, model_id: 'Embedder', capability: 'embeddings' })
    seedModel({ provider_id: p.id, model_id: 'other-embed', capability: 'embeddings' })
    seedRoute('embeddings', null, emb.id)
    const c = await resolveCandidates('embeddings', { fallbackModel: 'openai/text-embedding-3-small' })
    expect(c.ok && c.candidates.map((t) => t.model)).toEqual(['Embedder'])
    markFailure(c.ok ? c.candidates[0] : ({} as ProviderTarget), 'HTTP 503')
    const again = await resolveCandidates('embeddings', { fallbackModel: 'openai/text-embedding-3-small' })
    expect(again.ok && again.candidates.map((t) => t.model)).toEqual(['Embedder'])

    fetchSpy.mockResolvedValue(new Response('down', { status: 503 }))
    expect(await embedWithOpenRouter(['a'], { feature: 'doc_embed' })).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('embeddings without a route: the single embeddings model, never a guess among several', async () => {
    const p = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-0000') })
    seedModel({ provider_id: p.id, model_id: 'only-embed', capability: 'embeddings' })
    expect(await resolveTarget('embeddings', { fallbackModel: 'openai/text-embedding-3-small' })).toMatchObject({ ok: true, target: { model: 'only-embed' } })
    seedModel({ provider_id: p.id, model_id: 'second-embed', capability: 'embeddings' })
    invalidateProviderCache()
    expect((await resolveTarget('embeddings', { fallbackModel: 'openai/text-embedding-3-small' })).ok).toBe(false)
  })

  it('uses the per-model key on the wire', async () => {
    const { keys } = seedAlemPerModelKeys()
    await discoverAllModels({ fetchImpl: modelsFetch, resolve: publicDns })
    fetchSpy.mockClear()
    await callLlm({ tier: 'light', system: 's', user: 'u', maxTokens: 5, label: 't' })
    expect(auth(0)).toBe('Bearer key-alem-111111')
    expect(keys.alem.id).toBeTruthy()
  })
})
