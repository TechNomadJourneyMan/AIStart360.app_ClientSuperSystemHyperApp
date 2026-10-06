/**
 * Provider management service (094): validation, SSRF guard, encryption
 * required, masking, audit (written first, secrets redacted), verification.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)
const auditLog = vi.hoisted(() => ({ entries: [] as Array<{ actor: unknown; entry: Record<string, unknown>; opts: unknown }>, fail: false }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (actor: unknown, entry: Record<string, unknown>, _req: unknown, opts: { required?: boolean } = {}) => {
    if (auditLog.fail) {
      if (opts.required) throw new Error('Audit log unavailable — action refused')
      return false
    }
    auditLog.entries.push({ actor, entry, opts })
    return true
  },
}))

import { decryptSecret } from '@/lib/crypto/secrets'
import { invalidateProviderCache, resolveTarget } from '@/lib/ai/providers/router'
import {
  addCredential,
  createProvider,
  deleteCredential,
  deleteProvider,
  getBudgets,
  listProviders,
  ProviderServiceError,
  rotateCredential,
  setBudgets,
  setRoute,
  updateCredential,
  updateProvider,
  upsertModel,
  verifyCredential,
  type ProviderActor,
} from '@/lib/ai/providers/service'
import { fakeDb, resetFakeDb, seedModel, seedProvider } from './providers-fake-store'

const staff: ProviderActor = { kind: 'staff', id: '11111111-1111-4111-8111-111111111111', label: 'owner@aistart360.app', role: 'super_admin' }
const bot: ProviderActor = { kind: 'telegram', id: '424242', label: '@owner' }
const SECRET = 'alem-SECRET-key-0123456789-wxyz'

const savedEnv = { key: process.env.SECRETS_ENCRYPTION_KEY, node: process.env.NODE_ENV, or: process.env.OPENROUTER_API_KEY }

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  delete process.env.OPENROUTER_API_KEY
  resetFakeDb()
  invalidateProviderCache()
  auditLog.entries = []
  auditLog.fail = false
})

afterEach(() => {
  if (savedEnv.key === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
  else process.env.SECRETS_ENCRYPTION_KEY = savedEnv.key
  if (savedEnv.or === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedEnv.or
  vi.unstubAllEnvs()
})

const alemInput = { key: 'alem2', name: 'Alem Plus', baseUrl: 'https://llm.alem.ai/v1' }

async function expectError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(ProviderServiceError)
  await p.catch((e: ProviderServiceError) => expect(e.code).toBe(code))
}

describe('providers: validation and SSRF guard', () => {
  it('creates an OpenAI-compatible provider with defaults and audits it first', async () => {
    const p = await createProvider(staff, alemInput)
    expect(p).toMatchObject({ key: 'alem2', kind: 'openai_compatible', base_url: 'https://llm.alem.ai/v1', chat_path: '/chat/completions', embeddings_path: '/embeddings', enabled: true })
    expect(auditLog.entries[0]).toMatchObject({ entry: { action: 'ai.provider.create', entityType: 'ai_provider' }, opts: { required: true } })
  })

  it('rejects non-https URLs, credentials in URLs, bad slugs, unsafe paths and secret headers', async () => {
    await expectError(createProvider(staff, { ...alemInput, baseUrl: 'http://llm.alem.ai/v1' }), 'URL_REJECTED')
    await expectError(createProvider(staff, { ...alemInput, baseUrl: 'https://u:p@llm.alem.ai/v1' }), 'URL_REJECTED')
    await expectError(createProvider(staff, { ...alemInput, baseUrl: 'ftp://llm.alem.ai' }), 'URL_REJECTED')
    await expectError(createProvider(staff, { ...alemInput, key: 'Bad Key!' }), 'VALIDATION')
    await expectError(createProvider(staff, { ...alemInput, chatPath: '/../admin' }), 'VALIDATION')
    await expectError(createProvider(staff, { ...alemInput, extraHeaders: { Authorization: 'Bearer x' } }), 'VALIDATION')
    await expectError(createProvider(staff, { ...alemInput, extraHeaders: { 'X-Api-Key': 'x' } }), 'VALIDATION')
    await expectError(createProvider(staff, { ...alemInput, kind: 'openrouter' }), 'VALIDATION')
    expect(fakeDb.providers).toHaveLength(0)
    expect(auditLog.entries).toHaveLength(0)
  })

  it('allows http://localhost only outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await expect(createProvider(staff, { ...alemInput, baseUrl: 'http://localhost:8000/v1' })).resolves.toMatchObject({ base_url: 'http://localhost:8000/v1' })
    vi.stubEnv('NODE_ENV', 'production')
    await expectError(createProvider(staff, { ...alemInput, key: 'local2', baseUrl: 'http://127.0.0.1:8000/v1' }), 'URL_REJECTED')
  })

  it('in production refuses IP literals and hosts that resolve to private addresses', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const publicDns = async () => ['93.184.216.34']
    const internalDns = async () => ['10.0.0.5']
    await expectError(createProvider(staff, { ...alemInput, baseUrl: 'https://169.254.169.254/latest' }, { resolve: publicDns }), 'URL_REJECTED')
    await expectError(createProvider(staff, { ...alemInput, baseUrl: 'https://internal.example.com/v1' }, { resolve: internalDns }), 'URL_REJECTED')
    await expect(createProvider(staff, alemInput, { resolve: publicDns })).resolves.toMatchObject({ key: 'alem2' })
  })

  it('refuses a duplicate key and a missing actor', async () => {
    await createProvider(staff, alemInput)
    await expectError(createProvider(staff, alemInput), 'CONFLICT')
    await expectError(createProvider({ kind: 'staff', id: '' }, { ...alemInput, key: 'other' }), 'VALIDATION')
  })

  it('an unavailable audit log blocks the change', async () => {
    auditLog.fail = true
    await expect(createProvider(staff, alemInput)).rejects.toThrow(/Audit log unavailable/)
    expect(fakeDb.providers).toHaveLength(0)
  })

  it('updates only the given fields; deleting cascades keys, models and routes', async () => {
    const p = await createProvider(staff, { ...alemInput, rerankPath: '/rerank' })
    const u = await updateProvider(staff, p.id, { name: 'Alem', dailyBudgetUsd: 3, rerankPath: null })
    expect(u).toMatchObject({ name: 'Alem', daily_budget_usd: 3, rerank_path: null, base_url: 'https://llm.alem.ai/v1' })
    await addCredential(staff, p.id, 'main', SECRET)
    const m = await upsertModel(staff, { providerId: p.id, modelId: 'alemllm', capability: 'chat' })
    await setRoute(staff, 'chat', 'light', m.id)
    await deleteProvider(staff, p.id)
    expect([fakeDb.providers, fakeDb.credentials, fakeDb.models, fakeDb.routes].map((x) => x.length)).toEqual([0, 0, 0, 0])
  })
})

describe('credentials: encryption, masking, audit redaction', () => {
  it('refuses to store a key when SECRETS_ENCRYPTION_KEY is not configured', async () => {
    const p = await createProvider(staff, alemInput)
    delete process.env.SECRETS_ENCRYPTION_KEY
    await expectError(addCredential(staff, p.id, 'main', SECRET), 'ENCRYPTION_NOT_CONFIGURED')
    expect(fakeDb.credentials).toHaveLength(0)
    expect(auditLog.entries.map((e) => e.entry.action)).not.toContain('ai.credential.create')
  })

  it('stores only ciphertext and returns only a mask', async () => {
    const p = await createProvider(staff, alemInput)
    const masked = await addCredential(bot, p.id, 'Alem main', SECRET)
    expect(masked).toMatchObject({ label: 'Alem main', secret_hint: 'wxyz', masked: '••••wxyz', enabled: true })
    expect(masked).not.toHaveProperty('secret_ciphertext')

    const stored = fakeDb.credentials[0].secret_ciphertext
    expect(stored).toMatch(/^v1:/)
    expect(stored).not.toContain(SECRET)
    expect(decryptSecret(stored)).toBe(SECRET)

    const view = JSON.stringify(await listProviders())
    expect(view).not.toContain(SECRET)
    expect(view).not.toContain(stored)
    expect(view).toContain('••••wxyz')
  })

  it('never writes a secret to the audit log (add, rotate, delete); Telegram actors are prefixed', async () => {
    const p = await createProvider(staff, alemInput)
    const c = await addCredential(bot, p.id, 'main', SECRET)
    const NEW = 'rotated-secret-ABCDEFGH-9876'
    const rotated = await rotateCredential(staff, c.id, NEW)
    expect(rotated.secret_hint).toBe('9876')
    expect(decryptSecret(fakeDb.credentials[0].secret_ciphertext)).toBe(NEW)
    await updateCredential(staff, c.id, { enabled: false, label: 'old' })
    await deleteCredential(staff, c.id)

    const all = JSON.stringify(auditLog.entries)
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain(NEW)
    expect(all).not.toContain('v1:')
    const create = auditLog.entries.find((e) => e.entry.action === 'ai.credential.create')!
    expect(create.actor).toMatchObject({ id: 'telegram:424242', kind: 'telegram' })
    expect(create.opts).toEqual({ required: true })
    expect(auditLog.entries.map((e) => e.entry.action)).toEqual([
      'ai.provider.create', 'ai.credential.create', 'ai.credential.rotate', 'ai.credential.update', 'ai.credential.delete',
    ])
  })

  it('rejects keys with whitespace and too-short keys', async () => {
    const p = await createProvider(staff, alemInput)
    await expectError(addCredential(staff, p.id, 'main', 'short'), 'VALIDATION')
    await expectError(addCredential(staff, p.id, 'main', 'has space inside key'), 'VALIDATION')
  })
})

describe('verifyCredential', () => {
  it('calls the bound chat model with max_tokens 1 and records success', async () => {
    const p = await createProvider(staff, alemInput)
    const c = await addCredential(staff, p.id, 'main', SECRET)
    await upsertModel(staff, { providerId: p.id, modelId: 'alemllm', capability: 'chat' })
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'p' } }] }), { status: 200 }))
    const r = await verifyCredential(staff, c.id, { fetchImpl: f as unknown as typeof fetch })
    expect(r).toMatchObject({ ok: true, error: null, checkedWith: 'chat', model: 'alemllm', credential: { last_verify_ok: true } })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://llm.alem.ai/v1/chat/completions')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'alemllm', max_tokens: 1 })
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`)
  })

  it('stores a sanitised error without the key', async () => {
    const p = await createProvider(staff, alemInput)
    const c = await addCredential(staff, p.id, 'main', SECRET)
    await upsertModel(staff, { providerId: p.id, modelId: 'alemllm', capability: 'chat' })
    const f = vi.fn(async () => new Response(`{"error":"Invalid key ${SECRET}"}`, { status: 401 }))
    const r = await verifyCredential(staff, c.id, { fetchImpl: f as unknown as typeof fetch })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/HTTP 401 \(ключ не принят провайдером\)/)
    expect(r.error).not.toContain(SECRET)
    expect(fakeDb.credentials[0]).toMatchObject({ last_verify_ok: false })
    expect(fakeDb.credentials[0].last_verify_error).not.toContain(SECRET)
    expect(JSON.stringify(auditLog.entries)).not.toContain(SECRET)
  })

  it('uses GET /models when the key serves no chat/embeddings model', async () => {
    const p = await createProvider(staff, { ...alemInput, rerankPath: '/rerank' })
    const c = await addCredential(staff, p.id, 'reranker', SECRET)
    await upsertModel(staff, { providerId: p.id, modelId: 'rr', capability: 'rerank', credentialId: c.id })
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'rr' }] }), { status: 200 }))
    const r = await verifyCredential(staff, c.id, { fetchImpl: f as unknown as typeof fetch })
    expect(r).toMatchObject({ ok: true, checkedWith: 'models' })
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://llm.alem.ai/v1/models')
  })
})

describe('models, routes, budgets', () => {
  it('validates routes: chat needs a tier, capabilities must match, model must belong to a known provider', async () => {
    const p = await createProvider(staff, alemInput)
    const chat = await upsertModel(staff, { providerId: p.id, modelId: 'alemllm', capability: 'chat' })
    const emb = await upsertModel(staff, { providerId: p.id, modelId: 'emb-1', capability: 'embeddings' })
    await expectError(setRoute(staff, 'chat', null, chat.id), 'VALIDATION')
    await expectError(setRoute(staff, 'embeddings', 'light', emb.id), 'VALIDATION')
    await expectError(setRoute(staff, 'chat', 'light', emb.id), 'VALIDATION')
    await expectError(upsertModel(staff, { providerId: p.id, modelId: 'rr', capability: 'rerank' }), 'VALIDATION')
    await expectError(upsertModel(staff, { providerId: p.id, modelId: 'bad id with spaces', capability: 'chat' }), 'VALIDATION')
    await expect(setRoute(staff, 'chat', 'light', chat.id)).resolves.toMatchObject({ capability: 'chat', tier: 'light' })
    await expect(setRoute(staff, 'chat', 'light', null)).resolves.toBeNull()
    expect(fakeDb.routes).toHaveLength(0)
  })

  it('a key bound to a model must belong to the same provider', async () => {
    const a = await createProvider(staff, alemInput)
    const b = await createProvider(staff, { ...alemInput, key: 'other' })
    const cb = await addCredential(staff, b.id, 'b', SECRET)
    await expectError(upsertModel(staff, { providerId: a.id, modelId: 'x', capability: 'chat', credentialId: cb.id }), 'VALIDATION')
  })

  it('mutations take effect in the router immediately (cache invalidated)', async () => {
    process.env.OPENROUTER_API_KEY = 'or-env'
    const p = await createProvider(staff, alemInput)
    await addCredential(staff, p.id, 'main', SECRET)
    const m = await upsertModel(staff, { providerId: p.id, modelId: 'alemllm', capability: 'chat' })
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'fb' })).toMatchObject({ ok: true, target: { providerKey: 'openrouter' } })
    await setRoute(staff, 'chat', 'light', m.id)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'fb' })).toMatchObject({ ok: true, target: { providerKey: 'alem2', apiKey: SECRET } })
    await setRoute(staff, 'chat', 'light', null)
    expect(await resolveTarget('chat', { tier: 'light', fallbackModel: 'fb' })).toMatchObject({ ok: true, target: { providerKey: 'openrouter' } })
  })

  it('budgets: editable with env fallback, per-provider budget', async () => {
    vi.stubEnv('AGENT_PLATFORM_DAILY_BUDGET_USD', '50')
    seedProvider({ key: 'alem' })
    expect((await getBudgets()).platform).toEqual({ dailyUsd: 50, source: 'env', configured: null })
    const b = await setBudgets(staff, { platformDailyUsd: 20, providers: { alem: 5 } })
    expect(b.platform).toEqual({ dailyUsd: 20, source: 'db', configured: 20 })
    expect(b.providers.find((p) => p.key === 'alem')).toMatchObject({ dailyBudgetUsd: 5 })
    const cleared = await setBudgets(staff, { platformDailyUsd: null })
    expect(cleared.platform.source).toBe('env')
    expect(cleared.providers.find((p) => p.key === 'alem')).toMatchObject({ dailyBudgetUsd: 5 })
    await expectError(setBudgets(staff, { platformDailyUsd: -1 }), 'VALIDATION')
    await expectError(setBudgets(staff, { providers: { nope: 1 } }), 'NOT_FOUND')
    expect(auditLog.entries.filter((e) => e.entry.action === 'ai.budgets.update')).toHaveLength(2)
  })

  it('listProviders exposes models and the routes they serve', async () => {
    const p = seedProvider({ key: 'alem' })
    const m = seedModel({ provider_id: p.id, model_id: 'alemllm', capability: 'chat' })
    await setRoute(staff, 'chat', 'premium', m.id)
    const [view] = await listProviders()
    expect(view.routes).toEqual([{ capability: 'chat', tier: 'premium', model_id: m.id, model: 'alemllm' }])
  })
})
