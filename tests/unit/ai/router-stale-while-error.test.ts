/**
 * BE-09 — the AI router cached an EMPTY configuration for 60 s whenever the database was
 * unreachable, and every call in that minute went to the hard-coded Claude through OpenRouter
 * (the owner's Alem/Qwen routes ignored). Now: the last good configuration is kept while loads
 * fail (stale-while-error), an empty one is never cached, a load that hangs is bounded.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)

import { encryptSecret } from '@/lib/crypto/secrets'
import { invalidateProviderCache, resolveTarget, ROUTER_CACHE_TTL_MS, ROUTER_ERROR_RETRY_MS } from '@/lib/ai/providers/router'
import { fakeDb, resetFakeDb, seedCredential, seedModel, seedProvider, seedRoute } from './providers-fake-store'

const saved: Record<string, string | undefined> = {}
const ENV = ['OPENROUTER_API_KEY', 'SECRETS_ENCRYPTION_KEY', 'AI_ROUTER_LOAD_TIMEOUT_MS'] as const

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  process.env.OPENROUTER_API_KEY = 'or-key'
  delete process.env.AI_ROUTER_LOAD_TIMEOUT_MS
  resetFakeDb()
  invalidateProviderCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

function seedAlemRoute() {
  const alem = seedProvider({ key: 'alem', name: 'Alem Plus', base_url: 'https://llm.alem.ai/v1' })
  seedCredential({ provider_id: alem.id, secret_ciphertext: encryptSecret('alem-secret-key-1234') })
  const model = seedModel({ provider_id: alem.id, model_id: 'qwen3', capability: 'chat' })
  seedRoute('chat', 'light', model.id)
}

const connectionLost = () => Object.assign(new Error("Can't reach database server at db:5432"), { code: 'P1001' })

describe('BE-09 router: stale-while-error', () => {
  it('keeps the last good configuration when a reload fails', async () => {
    seedAlemRoute()
    const t0 = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ ok: true, target: { providerKey: 'alem' } })

    fakeDb.loadError = connectionLost()
    now.mockReturnValue(t0 + ROUTER_CACHE_TTL_MS + 1)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ ok: true, target: { providerKey: 'alem' } })
    expect(fakeDb.loads).toBe(2)
  })

  it('retries a failed reload soon (not after a full TTL) and picks the fresh configuration up', async () => {
    const t0 = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    fakeDb.loadError = connectionLost()
    // Nothing loaded yet: the built-in OpenRouter answers this call…
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ ok: true, target: { providerKey: 'openrouter' } })
    expect(ROUTER_ERROR_RETRY_MS).toBeLessThan(ROUTER_CACHE_TTL_MS)

    // …but the empty configuration is not cached: once the database is back, the next load sees the route.
    fakeDb.loadError = null
    seedAlemRoute()
    now.mockReturnValue(t0 + ROUTER_ERROR_RETRY_MS + 1)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ ok: true, target: { providerKey: 'alem' } })
    expect(fakeDb.loads).toBe(2)
  })

  it('does not hammer a database that is down: one load per retry interval', async () => {
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(t0)
    fakeDb.loadError = connectionLost()
    for (let i = 0; i < 5; i++) await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    expect(fakeDb.loads).toBe(1)
  })

  it('bounds a load that hangs (AI_ROUTER_LOAD_TIMEOUT_MS) and keeps the last good configuration', async () => {
    seedAlemRoute()
    const t0 = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })).toMatchObject({ target: { providerKey: 'alem' } })
    process.env.AI_ROUTER_LOAD_TIMEOUT_MS = '30'
    fakeDb.loadDelayMs = 500
    now.mockReturnValue(t0 + ROUTER_CACHE_TTL_MS + 1)
    const started = performance.now()
    const res = await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    expect(performance.now() - started).toBeLessThan(400)
    expect(res).toMatchObject({ ok: true, target: { providerKey: 'alem' } })
  })

  it('a configuration that is really not there (094 not applied) is cached as before', async () => {
    fakeDb.loadError = new Error('relation "public.ai_providers" does not exist')
    await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    await resolveTarget('chat', { tier: 'light', fallbackModel: 'm' })
    expect(fakeDb.loads).toBe(1)
  })
})
