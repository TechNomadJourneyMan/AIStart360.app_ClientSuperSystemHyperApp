/**
 * Provider router (094): which provider/model/key serves a call, the built-in
 * OpenRouter fallback, env key fallbacks, cache and invalidation, budgets.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)

import { encryptSecret } from '@/lib/crypto/secrets'
import {
  effectiveBudgets,
  hasConfiguredChatRoute,
  invalidateProviderCache,
  providerBudgetRefusal,
  resolveCandidates,
  resolveTarget,
  ROUTER_CACHE_TTL_MS,
} from '@/lib/ai/providers/router'
import { fakeDb, resetFakeDb, seedCredential, seedModel, seedProvider, seedRoute } from './providers-fake-store'

const ENV = ['OPENROUTER_API_KEY', 'ALEM_API_KEY', 'SECRETS_ENCRYPTION_KEY', 'AGENT_PLATFORM_DAILY_BUDGET_USD', 'AGENT_COMPANY_DAILY_BUDGET_USD'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  for (const k of ENV) delete process.env[k]
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  resetFakeDb()
  invalidateProviderCache()
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

function seedAlem(opts: { withKey?: boolean; price?: boolean } = {}) {
  const alem = seedProvider({ key: 'alem', name: 'Alem Plus', base_url: 'https://llm.alem.ai/v1' })
  const cred = opts.withKey === false ? null : seedCredential({ provider_id: alem.id, secret_ciphertext: encryptSecret('alem-secret-key-1234') })
  const model = seedModel({
    provider_id: alem.id, model_id: 'alemllm', capability: 'chat',
    price_in_per_mtok: opts.price ? 0.5 : null, price_out_per_mtok: opts.price ? 1.5 : null,
  })
  return { alem, cred, model }
}

describe('resolveTarget — built-in fallback (nothing configured)', () => {
  it('uses OpenRouter with OPENROUTER_API_KEY and the fallback model', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    const r = await resolveTarget('chat', { tier: 'light', fallbackModel: 'anthropic/claude-haiku-4.5' })
    expect(r).toMatchObject({
      ok: true,
      target: { origin: 'env', providerKey: 'openrouter', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-4.5', apiKey: 'or-env-key' },
    })
  })

  it('reports NO_API_KEY with the historical message when there is no key at all', async () => {
    const r = await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    expect(r).toEqual({ ok: false, code: 'NO_API_KEY', message: 'OPENROUTER_API_KEY не задан' })
  })

  it('rerank and OCR have no built-in fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'k'
    expect(await resolveTarget('rerank')).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' })
    expect(await resolveTarget('ocr')).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' })
  })

  it('an owner-entered OpenRouter key wins over the env key', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    const or = seedProvider({ key: 'openrouter', kind: 'openrouter', base_url: 'https://openrouter.ai/api/v1' })
    seedCredential({ provider_id: or.id, secret_ciphertext: encryptSecret('or-db-key-123456') })
    const r = await resolveTarget('chat', { tier: 'standard', fallbackModel: 'anthropic/claude-sonnet-4.5' })
    expect(r).toMatchObject({ ok: true, target: { providerKey: 'openrouter', apiKey: 'or-db-key-123456', origin: 'env' } })
  })

  it('a disabled OpenRouter provider is not used as the fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    seedProvider({ key: 'openrouter', kind: 'openrouter', enabled: false })
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ ok: false, code: 'NO_API_KEY' })
  })
})

describe('resolveTarget — configured routes', () => {
  it('routes a chat tier to Alem with the decrypted key', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    const { model, cred } = seedAlem({ price: true })
    seedRoute('chat', 'light', model.id)
    const r = await resolveTarget('chat', { tier: 'light', fallbackModel: 'anthropic/claude-haiku-4.5' })
    expect(r).toMatchObject({
      ok: true,
      target: {
        origin: 'db', providerKey: 'alem', kind: 'openai_compatible', baseUrl: 'https://llm.alem.ai/v1',
        chatPath: '/chat/completions', model: 'alemllm', apiKey: 'alem-secret-key-1234', credentialId: cred!.id,
        priceInPerMtok: 0.5, priceOutPerMtok: 1.5,
      },
    })
    // A1: other tiers use any usable chat model before the built-in OpenRouter…
    expect(await resolveTarget('chat', { tier: 'premium', fallbackModel: 'x/premium' })).toMatchObject({ ok: true, target: { providerKey: 'alem', model: 'alemllm' } })
    // …which stays the last candidate.
    const c = await resolveCandidates('chat', { tier: 'premium', fallbackModel: 'x/premium' })
    expect(c.ok && c.candidates.map((t) => `${t.providerKey}/${t.model}`)).toEqual(['alem/alemllm', 'openrouter/x/premium'])
  })

  it('an explicit model id picks the provider that registered it, otherwise OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    seedAlem()
    expect(await resolveTarget('chat', { model: 'alemllm', fallbackModel: 'alemllm' })).toMatchObject({ ok: true, target: { providerKey: 'alem' } })
    expect(await resolveTarget('chat', { model: 'openai/gpt-4o', fallbackModel: 'openai/gpt-4o' }))
      .toMatchObject({ ok: true, target: { providerKey: 'openrouter', model: 'openai/gpt-4o' } })
  })

  it('falls back to ALEM_API_KEY when the Alem provider has no stored key', async () => {
    const { model } = seedAlem({ withKey: false })
    seedRoute('chat', 'standard', model.id)
    process.env.ALEM_API_KEY = 'alem-env-key-9999'
    const r = await resolveTarget('chat', { tier: 'standard', fallbackModel: 'm' })
    expect(r).toMatchObject({ ok: true, target: { providerKey: 'alem', apiKey: 'alem-env-key-9999', credentialId: null } })
  })

  it('an unusable route (no key / disabled) falls back to the built-in behaviour', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { model, alem } = seedAlem({ withKey: false })
    seedRoute('chat', 'light', model.id)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'fb' })).toMatchObject({ ok: true, target: { providerKey: 'openrouter', model: 'fb' } })

    seedCredential({ provider_id: alem.id, secret_ciphertext: encryptSecret('alem-secret-key-1234') })
    alem.enabled = false
    invalidateProviderCache()
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'fb' })).toMatchObject({ ok: true, target: { providerKey: 'openrouter' } })
  })

  it('a model bound to a disabled key is not served with another key', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const alem = seedProvider({ key: 'alem' })
    seedCredential({ provider_id: alem.id, secret_ciphertext: encryptSecret('general-key-0000') })
    const ocrKey = seedCredential({ provider_id: alem.id, enabled: false, secret_ciphertext: encryptSecret('ocr-key-11111111') })
    const m = seedModel({ provider_id: alem.id, model_id: 'emb', capability: 'embeddings', credential_id: ocrKey.id })
    seedRoute('embeddings', null, m.id)
    expect(await resolveTarget('embeddings', { fallbackModel: 'openai/text-embedding-3-small' }))
      .toMatchObject({ ok: true, target: { providerKey: 'openrouter', model: 'openai/text-embedding-3-small' } })
  })

  it('skips a credential that cannot be decrypted (rotated SECRETS_ENCRYPTION_KEY)', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env-key'
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { model } = seedAlem()
    seedRoute('chat', 'light', model.id)
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'fb' })).toMatchObject({ ok: true, target: { providerKey: 'openrouter' } })
  })

  it('routes rerank to the configured model', async () => {
    const p = seedProvider({ key: 'alem', rerank_path: '/rerank' })
    seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('rerank-key-12345') })
    const m = seedModel({ provider_id: p.id, model_id: 'reranker-x', capability: 'rerank' })
    seedRoute('rerank', null, m.id)
    expect(await resolveTarget('rerank')).toMatchObject({ ok: true, target: { model: 'reranker-x', rerankPath: '/rerank', apiKey: 'rerank-key-12345' } })
  })
})

describe('router cache', () => {
  it('loads the configuration once per TTL and reloads after invalidation', async () => {
    process.env.OPENROUTER_API_KEY = 'k'
    await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    expect(fakeDb.loads).toBe(1)

    // A route added in the DB is not seen until the cache is invalidated…
    const { model } = seedAlem()
    seedRoute('chat', 'light', model.id)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ ok: true, target: { providerKey: 'openrouter' } })
    invalidateProviderCache()
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ ok: true, target: { providerKey: 'alem' } })
    expect(fakeDb.loads).toBe(2)
  })

  it('expires after the TTL (≤ 60 s)', async () => {
    expect(ROUTER_CACHE_TTL_MS).toBeLessThanOrEqual(60_000)
    process.env.OPENROUTER_API_KEY = 'k'
    const t0 = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    now.mockReturnValue(t0 + ROUTER_CACHE_TTL_MS + 1)
    await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    expect(fakeDb.loads).toBe(2)
  })

  it('hasConfiguredChatRoute answers from the warm cache only', async () => {
    const { model } = seedAlem()
    seedRoute('chat', 'standard', model.id)
    expect(hasConfiguredChatRoute()).toBe(false) // cold: starts loading
    await resolveTarget('chat', { tier: 'standard', fallbackModel: 'm' })
    expect(hasConfiguredChatRoute()).toBe(true)
  })
})

describe('budgets', () => {
  it('editable budgets win over env; env is the fallback', async () => {
    process.env.AGENT_PLATFORM_DAILY_BUDGET_USD = '40'
    process.env.AGENT_COMPANY_DAILY_BUDGET_USD = '4'
    expect(await effectiveBudgets()).toMatchObject({ platformDailyUsd: 40, companyDailyUsd: 4, source: { platform: 'env', company: 'env' } })
    fakeDb.budgets = { platform_daily_usd: 12, company_daily_usd: null, updated_by: 'x', updated_at: new Date() }
    invalidateProviderCache()
    expect(await effectiveBudgets()).toMatchObject({ platformDailyUsd: 12, companyDailyUsd: 4, source: { platform: 'db', company: 'env' } })
  })

  it('refuses a provider whose daily budget is spent', async () => {
    const { model, alem } = seedAlem()
    alem.daily_budget_usd = 2
    seedRoute('chat', 'light', model.id)
    const r = await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    if (!r.ok) throw new Error('expected a target')
    expect(await providerBudgetRefusal(r.target)).toBeNull()
    fakeDb.spendToday.alem = 2.5
    expect(await providerBudgetRefusal(r.target)).toMatch(/бюджет провайдера Alem Plus/)
  })
})
