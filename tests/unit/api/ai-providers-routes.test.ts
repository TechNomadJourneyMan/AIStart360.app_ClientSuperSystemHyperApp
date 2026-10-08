/**
 * /api/giga-admin/ai-providers/* — LLM providers, API keys, models, routes,
 * budgets and spend in the GIGA panel. The real service runs on the in-memory
 * store (tests/unit/ai/providers-fake-store.ts):
 *   - a role without the permission gets 403 and nothing is read, written or
 *     audited (mutations: settings.manage; reads: agents.view);
 *   - an API key goes in only through «add» / «rotate» and never comes out:
 *     not in any response body, not in errors, not in the audit journal;
 *   - ProviderServiceError → its status and Russian message; other failures →
 *     500 with a generic message; an unavailable audit journal → 503;
 *   - body / query validation answers 400 before the service is called.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  role: 'super_admin' as string,
  audits: [] as Array<{ actor: unknown; entry: Record<string, unknown> }>,
  auditFail: false,
  storeCalls: 0,
  /** Per-test replacement of a store function (e.g. a failing insert). */
  override: {} as Record<string, (...a: any[]) => unknown>,
}))

vi.mock('@/lib/ai/providers/store', async () => {
  const { fakeStoreModule } = await import('../ai/providers-fake-store')
  // Count every store access: a refused request must not reach it.
  return Object.fromEntries(Object.entries(fakeStoreModule).map(([k, fn]) => [k, (...a: unknown[]) => {
    s.storeCalls++
    return (s.override[k] ?? (fn as (...x: unknown[]) => unknown))(...a)
  }]))
})
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'staff-owner', kind: 'session', role: s.role as StaffRole, email: 'owner@aistart360.test' })),
    STAFF_COOKIE_NAME: 'x',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (actor: unknown, entry: Record<string, unknown>, _req: unknown, opts: { required?: boolean } = {}) => {
    if (s.auditFail) {
      if (opts.required) throw new Error('Audit log unavailable — action refused')
      return false
    }
    s.audits.push({ actor, entry })
    return true
  },
}))

import { decryptSecret } from '@/lib/crypto/secrets'
import { invalidateProviderCache } from '@/lib/ai/providers/router'
import { fakeDb, resetFakeDb, seedCredential, seedModel, seedProvider } from '../ai/providers-fake-store'

const list = await import('@/app/api/giga-admin/ai-providers/route')
const one = await import('@/app/api/giga-admin/ai-providers/[id]/route')
const creds = await import('@/app/api/giga-admin/ai-providers/[id]/credentials/route')
const cred = await import('@/app/api/giga-admin/ai-providers/credentials/[credentialId]/route')
const rotate = await import('@/app/api/giga-admin/ai-providers/credentials/[credentialId]/rotate/route')
const verify = await import('@/app/api/giga-admin/ai-providers/credentials/[credentialId]/verify/route')
const models = await import('@/app/api/giga-admin/ai-providers/models/route')
const model = await import('@/app/api/giga-admin/ai-providers/models/[modelId]/route')
const routes = await import('@/app/api/giga-admin/ai-providers/routes/route')
const budgets = await import('@/app/api/giga-admin/ai-providers/budgets/route')
const spend = await import('@/app/api/giga-admin/ai-providers/spend/route')
const discover = await import('@/app/api/giga-admin/ai-providers/discover/route')
const status = await import('@/app/api/giga-admin/ai-providers/status/route')

const SECRET = 'sk-alem-SUPERSECRET-0123456789abcdef'
const SECRET2 = 'sk-alem-ROTATED-fedcba9876543210zz'
const ZERO = '00000000-0000-4000-8000-000000000000'

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })

async function json(res: Response): Promise<{ status: number; text: string; body: Record<string, any> }> {
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

const ENV = ['SECRETS_ENCRYPTION_KEY', 'AGENT_PLATFORM_DAILY_BUDGET_USD', 'AGENT_COMPANY_DAILY_BUDGET_USD'] as const
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  delete process.env.AGENT_PLATFORM_DAILY_BUDGET_USD
  delete process.env.AGENT_COMPANY_DAILY_BUDGET_USD
  resetFakeDb()
  invalidateProviderCache()
  s.role = 'super_admin'
  s.audits = []
  s.auditFail = false
  s.storeCalls = 0
  s.override = {}
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function seedAlem() {
  const p = seedProvider({ key: 'alem', name: 'Alem Plus', base_url: 'https://llm.alem.ai/v1' })
  const m = seedModel({ provider_id: p.id, model_id: 'alemllm', capability: 'chat' })
  return { p, m }
}

// ─── Permissions ─────────────────────────────────────────────────────────────

const NO_SETTINGS: StaffRole[] = ['admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support']
const NO_AGENTS_VIEW: StaffRole[] = ['super_expert', 'content_manager', 'support']

describe('permissions: refused before the service is called', () => {
  const ID = '11111111-2222-4333-8444-555555555555'
  const mutations: Array<{ name: string; call: () => Promise<Response> }> = [
    { name: 'create provider', call: () => list.POST(req('/api/giga-admin/ai-providers', 'POST', { key: 'x1', name: 'X', baseUrl: 'https://x.example.com' })) },
    { name: 'update provider', call: () => one.PATCH(req(`/api/giga-admin/ai-providers/${ID}`, 'PATCH', { enabled: false }), { params: { id: ID } }) },
    { name: 'delete provider', call: () => one.DELETE(req(`/api/giga-admin/ai-providers/${ID}`, 'DELETE'), { params: { id: ID } }) },
    { name: 'add key', call: () => creds.POST(req(`/api/giga-admin/ai-providers/${ID}/credentials`, 'POST', { label: 'k', secret: SECRET }), { params: { id: ID } }) },
    { name: 'update key', call: () => cred.PATCH(req(`/api/giga-admin/ai-providers/credentials/${ID}`, 'PATCH', { enabled: false }), { params: { credentialId: ID } }) },
    { name: 'delete key', call: () => cred.DELETE(req(`/api/giga-admin/ai-providers/credentials/${ID}`, 'DELETE'), { params: { credentialId: ID } }) },
    { name: 'rotate key', call: () => rotate.POST(req(`/api/giga-admin/ai-providers/credentials/${ID}/rotate`, 'POST', { secret: SECRET }), { params: { credentialId: ID } }) },
    { name: 'verify key', call: () => verify.POST(req(`/api/giga-admin/ai-providers/credentials/${ID}/verify`, 'POST'), { params: { credentialId: ID } }) },
    { name: 'upsert model', call: () => models.POST(req('/api/giga-admin/ai-providers/models', 'POST', { providerId: ID, modelId: 'm', capability: 'chat' })) },
    { name: 'delete model', call: () => model.DELETE(req(`/api/giga-admin/ai-providers/models/${ID}`, 'DELETE'), { params: { modelId: ID } }) },
    { name: 'set route', call: () => routes.PUT(req('/api/giga-admin/ai-providers/routes', 'PUT', { capability: 'chat', tier: 'light', modelRowId: null })) },
    { name: 'set budgets', call: () => budgets.PUT(req('/api/giga-admin/ai-providers/budgets', 'PUT', { platformDailyUsd: 1 })) },
    { name: 'discover models', call: () => discover.POST(req('/api/giga-admin/ai-providers/discover', 'POST', {})) },
  ]

  for (const m of mutations) {
    it(`${m.name}: 403 for every role without settings.manage`, async () => {
      for (const role of NO_SETTINGS) {
        s.role = role
        const res = await m.call()
        expect(res.status, `${m.name} as ${role}`).toBe(403)
        expect(await res.text()).not.toContain(SECRET)
      }
      expect(s.storeCalls).toBe(0)
      expect(s.audits).toHaveLength(0)
    })
  }

  const reads: Array<{ name: string; call: () => Promise<Response> }> = [
    { name: 'list providers', call: () => list.GET(req('/api/giga-admin/ai-providers')) },
    { name: 'one provider', call: () => one.GET(req(`/api/giga-admin/ai-providers/${ID}`), { params: { id: ID } }) },
    { name: 'routes', call: () => routes.GET(req('/api/giga-admin/ai-providers/routes')) },
    { name: 'budgets', call: () => budgets.GET(req('/api/giga-admin/ai-providers/budgets')) },
    { name: 'spend', call: () => spend.GET(req('/api/giga-admin/ai-providers/spend?days=7')) },
    { name: 'status', call: () => status.GET(req('/api/giga-admin/ai-providers/status')) },
  ]
  for (const r of reads) {
    it(`${r.name}: 403 without agents.view`, async () => {
      for (const role of NO_AGENTS_VIEW) {
        s.role = role
        expect((await r.call()).status, `${r.name} as ${role}`).toBe(403)
      }
      expect(s.storeCalls).toBe(0)
    })
  }

  it('analyst (agents.view, no settings.manage) reads providers, routes, budgets and spend', async () => {
    seedAlem()
    s.role = 'analyst'
    for (const r of reads.filter((x) => x.name !== 'one provider')) expect((await r.call()).status, r.name).toBe(200)
  })
})

describe('discovery and «who answers now»', () => {
  it('discover: GET /models with the key, models added, audited; status shows the answering model without keys', async () => {
    const { p } = seedAlem()
    seedCredential({ provider_id: p.id, label: 'main', secret_ciphertext: (await import('@/lib/crypto/secrets')).encryptSecret(SECRET) })
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'alemllm' }, { id: 'alem-embedder' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const r = await json(await discover.POST(req('/api/giga-admin/ai-providers/discover', 'POST', { providerId: p.id })))
    expect(r.status).toBe(200)
    expect(r.body.results).toEqual([expect.objectContaining({ ok: true, ids: ['alemllm', 'alem-embedder'], added: 1 })])
    expect((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://llm.alem.ai/v1/models')
    expect(s.audits.map((a) => a.entry.action)).toEqual(['ai.models.discover'])
    expect(fakeDb.models.find((m) => m.model_id === 'alem-embedder')).toMatchObject({ capability: 'embeddings', source: 'discovered' })

    s.role = 'analyst'
    const st = await json(await status.GET(req('/api/giga-admin/ai-providers/status')))
    expect(st.status).toBe(200)
    expect(st.body.slots.find((x: { capability: string; tier: string | null }) => x.capability === 'chat' && x.tier === 'light'))
      .toMatchObject({ current: { providerKey: 'alem', model: 'alemllm', healthy: true, credentialLabel: 'main' } })
    expect(st.body.slots.find((x: { capability: string }) => x.capability === 'rerank')).toMatchObject({ current: null, problem: expect.any(String) })
    expect(st.text).not.toContain(SECRET)
  })

  it('discover validates the body', async () => {
    expect((await discover.POST(req('/api/giga-admin/ai-providers/discover', 'POST', { providerId: 'nope' }))).status).toBe(400)
    expect(s.storeCalls).toBe(0)
  })
})

// ─── Secrets ─────────────────────────────────────────────────────────────────

describe('API key never leaves the server', () => {
  it('add → stored encrypted, response masked; list / one provider show only the mask; audit has no secret', async () => {
    const { p } = seedAlem()
    const add = await json(await creds.POST(req(`/api/giga-admin/ai-providers/${p.id}/credentials`, 'POST', { label: 'Основной', secret: SECRET }), { params: { id: p.id } }))
    expect(add.status).toBe(201)
    expect(add.body.credential.masked).toBe(`••••${SECRET.slice(-4)}`)
    expect(add.text).not.toContain(SECRET)
    expect(add.body.credential).not.toHaveProperty('secret_ciphertext')
    expect(add.body.credential).not.toHaveProperty('secret')

    const row = fakeDb.credentials[0]
    expect(row.secret_ciphertext).not.toContain(SECRET)
    expect(decryptSecret(row.secret_ciphertext)).toBe(SECRET)

    const all = await json(await list.GET(req('/api/giga-admin/ai-providers')))
    expect(all.status).toBe(200)
    expect(all.body.encryptionConfigured).toBe(true)
    expect(all.text).not.toContain(SECRET)
    expect(all.text).not.toContain(row.secret_ciphertext)
    expect(all.body.providers[0].credentials[0].masked).toBe(`••••${SECRET.slice(-4)}`)

    const single = await json(await one.GET(req(`/api/giga-admin/ai-providers/alem`), { params: { id: 'alem' } }))
    expect(single.status).toBe(200)
    expect(single.text).not.toContain(SECRET)
    expect(single.text).not.toContain(row.secret_ciphertext)

    expect(JSON.stringify(s.audits)).not.toContain(SECRET)
    expect(s.audits.map((a) => a.entry.action)).toContain('ai.credential.create')
  })

  it('rotate → new secret encrypted, response masked, old and new secrets absent', async () => {
    const { p } = seedAlem()
    await creds.POST(req(`/api/giga-admin/ai-providers/${p.id}/credentials`, 'POST', { label: 'Основной', secret: SECRET }), { params: { id: p.id } })
    const id = fakeDb.credentials[0].id
    const r = await json(await rotate.POST(req(`/api/giga-admin/ai-providers/credentials/${id}/rotate`, 'POST', { secret: SECRET2 }), { params: { credentialId: id } }))
    expect(r.status).toBe(200)
    expect(r.body.credential.masked).toBe(`••••${SECRET2.slice(-4)}`)
    expect(r.text).not.toContain(SECRET)
    expect(r.text).not.toContain(SECRET2)
    expect(decryptSecret(fakeDb.credentials[0].secret_ciphertext)).toBe(SECRET2)
    expect(JSON.stringify(s.audits)).not.toContain(SECRET2)
  })

  it('PATCH refuses a secret (only «rotate» changes it) and does not touch the key', async () => {
    const { p } = seedAlem()
    const c = seedCredential({ provider_id: p.id, secret_ciphertext: 'cipher' })
    const r = await json(await cred.PATCH(req(`/api/giga-admin/ai-providers/credentials/${c.id}`, 'PATCH', { secret: SECRET }), { params: { credentialId: c.id } }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Сменить ключ')
    expect(r.text).not.toContain(SECRET)
    expect(fakeDb.credentials[0].secret_ciphertext).toBe('cipher')
    expect(s.audits).toHaveLength(0)
  })

  it('a provider error body that echoes the key is sanitised in the verify result', async () => {
    const { p } = seedAlem()
    await creds.POST(req(`/api/giga-admin/ai-providers/${p.id}/credentials`, 'POST', { label: 'k', secret: SECRET }), { params: { id: p.id } })
    const id = fakeDb.credentials[0].id
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: `invalid api key ${SECRET}` } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await json(await verify.POST(req(`/api/giga-admin/ai-providers/credentials/${id}/verify`, 'POST'), { params: { credentialId: id } }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.result.ok).toBe(false)
    expect(r.body.result.checkedWith).toBe('chat')
    expect(r.body.result.error).toMatch(/HTTP 401/)
    expect(r.text).not.toContain(SECRET)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fakeDb.credentials[0].last_verify_ok).toBe(false)
  })

  it('verify ok → result.ok and the stored status', async () => {
    const { p } = seedAlem()
    await creds.POST(req(`/api/giga-admin/ai-providers/${p.id}/credentials`, 'POST', { label: 'k', secret: SECRET }), { params: { id: p.id } })
    const id = fakeDb.credentials[0].id
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'p' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'alemllm',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const r = await json(await verify.POST(req(`/api/giga-admin/ai-providers/credentials/${id}/verify`, 'POST'), { params: { credentialId: id } }))
    expect(r.body.result).toMatchObject({ ok: true, error: null, model: 'alemllm' })
    expect(r.text).not.toContain(SECRET)
    expect(fakeDb.credentials[0].last_verify_ok).toBe(true)
  })

  it('an unexpected store error that echoes the key is scrubbed from the response', async () => {
    const { p } = seedAlem()
    s.override.insertCredential = async (c: { ciphertext: string }) => {
      throw new Error(`insert failed: ${c.ciphertext} / ${SECRET}`)
    }
    const r = await json(await creds.POST(req(`/api/giga-admin/ai-providers/${p.id}/credentials`, 'POST', { label: 'k', secret: SECRET }), { params: { id: p.id } }))
    expect(r.status).toBe(500)
    expect(r.text).not.toContain(SECRET)
    expect(r.text).not.toContain('insert failed')
    expect(r.body.error).toBe('Не удалось выполнить действие. Попробуйте позже.')
    for (const call of (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET)
  })

  it('without SECRETS_ENCRYPTION_KEY a key is refused with 503 and nothing is stored', async () => {
    const { p } = seedAlem()
    delete process.env.SECRETS_ENCRYPTION_KEY
    const r = await json(await creds.POST(req(`/api/giga-admin/ai-providers/${p.id}/credentials`, 'POST', { label: 'k', secret: SECRET }), { params: { id: p.id } }))
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('ENCRYPTION_NOT_CONFIGURED')
    expect(r.body.error).toContain('SECRETS_ENCRYPTION_KEY')
    expect(r.text).not.toContain(SECRET)
    expect(fakeDb.credentials).toHaveLength(0)
    const all = await json(await list.GET(req('/api/giga-admin/ai-providers')))
    expect(all.body.encryptionConfigured).toBe(false)
  })
})

// ─── Error mapping and validation ────────────────────────────────────────────

describe('errors and validation', () => {
  it('ProviderServiceError → its status and Russian message', async () => {
    seedAlem()
    const dup = await json(await list.POST(req('/api/giga-admin/ai-providers', 'POST', { key: 'alem', name: 'Dup', baseUrl: 'https://x.example.com/v1' })))
    expect(dup.status).toBe(409)
    expect(dup.body).toMatchObject({ ok: false, code: 'CONFLICT' })
    expect(dup.body.error).toContain('уже есть')

    const missing = await json(await one.PATCH(req(`/api/giga-admin/ai-providers/${ZERO}`, 'PATCH', { enabled: false }), { params: { id: ZERO } }))
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe('провайдер не найден')

    const badUrl = await json(await list.POST(req('/api/giga-admin/ai-providers', 'POST', { key: 'bad', name: 'Bad', baseUrl: 'ftp://x.example.com' })))
    expect(badUrl.status).toBe(400)
    expect(badUrl.body.code).toBe('URL_REJECTED')

    const reserved = await json(await list.POST(req('/api/giga-admin/ai-providers', 'POST', { key: 'other', name: 'O', kind: 'openrouter', baseUrl: 'https://x.example.com' })))
    expect(reserved.status).toBe(400)
    expect(reserved.body.error).toContain('зарезервирован')
  })

  it('body validation answers 400 before the store is touched', async () => {
    const cases: Array<() => Promise<Response>> = [
      () => list.POST(req('/api/giga-admin/ai-providers', 'POST', 'not json{')),
      () => list.POST(req('/api/giga-admin/ai-providers', 'POST', { key: 'A B', name: 'x', baseUrl: 'https://x.example.com' })),
      () => list.POST(req('/api/giga-admin/ai-providers', 'POST', { key: 'ok', name: 'x', baseUrl: 'https://x.example.com', extraHeaders: { Authorization: 'Bearer x' } })),
      () => one.PATCH(req(`/api/giga-admin/ai-providers/${ZERO}`, 'PATCH', { key: 'renamed' }), { params: { id: ZERO } }),
      () => creds.POST(req(`/api/giga-admin/ai-providers/${ZERO}/credentials`, 'POST', { label: 'k' }), { params: { id: ZERO } }),
      () => creds.POST(req(`/api/giga-admin/ai-providers/${ZERO}/credentials`, 'POST', { label: 'k', secret: SECRET, extra: 1 }), { params: { id: ZERO } }),
      () => models.POST(req('/api/giga-admin/ai-providers/models', 'POST', { providerId: 'nope', modelId: 'm', capability: 'chat' })),
      () => models.POST(req('/api/giga-admin/ai-providers/models', 'POST', { providerId: ZERO, modelId: 'm', capability: 'video' })),
      () => routes.PUT(req('/api/giga-admin/ai-providers/routes', 'PUT', { capability: 'chat', tier: 'ultra', modelRowId: null })),
      () => budgets.PUT(req('/api/giga-admin/ai-providers/budgets', 'PUT', { platformDailyUsd: -1 })),
      () => spend.GET(req('/api/giga-admin/ai-providers/spend?days=0')),
      () => spend.GET(req('/api/giga-admin/ai-providers/spend?days=abc')),
      () => spend.GET(req('/api/giga-admin/ai-providers/spend?days=7&groupBy=user')),
    ]
    for (const [i, c] of cases.entries()) {
      const r = await json(await c())
      expect(r.status, `case ${i}`).toBe(400)
      expect(r.body.ok, `case ${i}`).toBe(false)
      expect(typeof r.body.error, `case ${i}`).toBe('string')
    }
    expect(s.storeCalls).toBe(0)
    expect(s.audits).toHaveLength(0)
  })

  it('a key that is too short is refused by the service with its message (400), not stored', async () => {
    const { p } = seedAlem()
    const r = await json(await creds.POST(req(`/api/giga-admin/ai-providers/${p.id}/credentials`, 'POST', { label: 'k', secret: 'short' }), { params: { id: p.id } }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('ключ слишком короткий')
    expect(r.text).not.toContain('"short"')
    expect(fakeDb.credentials).toHaveLength(0)
  })

  it('route to a model of another capability → 400 with the service message', async () => {
    const { p } = seedAlem()
    const emb = seedModel({ provider_id: p.id, model_id: 'emb-1', capability: 'embeddings' })
    const r = await json(await routes.PUT(req('/api/giga-admin/ai-providers/routes', 'PUT', { capability: 'chat', tier: 'light', modelRowId: emb.id })))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('зарегистрирована для «embeddings»')
  })

  it('an unavailable audit journal refuses the change with 503', async () => {
    const { p } = seedAlem()
    s.auditFail = true
    const r = await json(await one.PATCH(req(`/api/giga-admin/ai-providers/${p.id}`, 'PATCH', { enabled: false }), { params: { id: p.id } }))
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('AUDIT_UNAVAILABLE')
    expect(fakeDb.providers[0].enabled).toBe(true)
  })

  it('other errors → 500 with a generic message in production', async () => {
    const env = process.env as Record<string, string | undefined>
    const prev = env.NODE_ENV
    s.override.listProviders = async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432') }
    env.NODE_ENV = 'production'
    try {
      const r = await json(await list.GET(req('/api/giga-admin/ai-providers')))
      expect(r.status).toBe(500)
      expect(r.text).not.toContain('10.0.0.5')
      expect(r.body.error).toBe('Не удалось выполнить действие. Попробуйте позже.')
    } finally {
      env.NODE_ENV = prev
    }
  })
})

// ─── Happy paths ─────────────────────────────────────────────────────────────

describe('management flow', () => {
  it('create → model → route → budgets → spend, every change audited with the staff actor', async () => {
    const created = await json(await list.POST(req('/api/giga-admin/ai-providers', 'POST', {
      key: 'alem', name: 'Alem Plus', baseUrl: 'https://llm.alem.ai/v1', extraHeaders: { 'X-Title': 'AIStart360' }, dailyBudgetUsd: 5,
    })))
    expect(created.status).toBe(201)
    const pid = created.body.provider.id as string

    const m = await json(await models.POST(req('/api/giga-admin/ai-providers/models', 'POST', { providerId: pid, modelId: 'alemllm', capability: 'chat', priceInPerMtok: 0.5, priceOutPerMtok: 1.5 })))
    expect(m.status).toBe(200)
    expect(m.body.model).toMatchObject({ model_id: 'alemllm', price_in_per_mtok: 0.5 })

    const route = await json(await routes.PUT(req('/api/giga-admin/ai-providers/routes', 'PUT', { capability: 'chat', tier: 'standard', modelRowId: m.body.model.id })))
    expect(route.status).toBe(200)
    expect(route.body.routes).toEqual([expect.objectContaining({ capability: 'chat', tier: 'standard', modelId: 'alemllm', providerKey: 'alem' })])

    const reset = await json(await routes.PUT(req('/api/giga-admin/ai-providers/routes', 'PUT', { capability: 'chat', tier: 'standard', modelRowId: null })))
    expect(reset.body).toMatchObject({ ok: true, route: null, routes: [] })

    fakeDb.spendToday = { alem: 1.25 }
    const b = await json(await budgets.PUT(req('/api/giga-admin/ai-providers/budgets', 'PUT', { platformDailyUsd: 20, providers: { alem: 3 } })))
    expect(b.status).toBe(200)
    expect(b.body.budgets.platform).toMatchObject({ dailyUsd: 20, source: 'db' })
    expect(b.body.budgets.company.source).toBe('env')
    expect(b.body.budgets.providers).toEqual([expect.objectContaining({ key: 'alem', dailyBudgetUsd: 3, spentTodayUsd: 1.25 })])

    const sp = await json(await spend.GET(req('/api/giga-admin/ai-providers/spend?days=30&groupBy=model')))
    expect(sp.status).toBe(200)
    expect(sp.body).toMatchObject({ ok: true, days: 30, groupBy: 'model' })

    const del = await json(await model.DELETE(req(`/api/giga-admin/ai-providers/models/${m.body.model.id}`, 'DELETE'), { params: { modelId: m.body.model.id } }))
    expect(del.body).toEqual({ ok: true, deleted: true })

    expect(s.audits.map((a) => a.entry.action)).toEqual([
      'ai.provider.create', 'ai.model.upsert', 'ai.route.set', 'ai.route.delete', 'ai.budgets.update', 'ai.model.delete',
    ])
    expect(s.audits.every((a) => (a.actor as { id: string }).id === 'staff-owner')).toBe(true)
  })

  it('key enable/disable and delete', async () => {
    const { p } = seedAlem()
    const c = seedCredential({ provider_id: p.id, secret_ciphertext: 'cipher', label: 'Old' })
    const off = await json(await cred.PATCH(req(`/api/giga-admin/ai-providers/credentials/${c.id}`, 'PATCH', { enabled: false, label: 'Резерв' }), { params: { credentialId: c.id } }))
    expect(off.body.credential).toMatchObject({ enabled: false, label: 'Резерв', masked: '••••xxxx' })
    expect(off.text).not.toContain('cipher')
    const del = await json(await cred.DELETE(req(`/api/giga-admin/ai-providers/credentials/${c.id}`, 'DELETE'), { params: { credentialId: c.id } }))
    expect(del.body).toEqual({ ok: true, deleted: true })
    expect(fakeDb.credentials).toHaveLength(0)
  })

  it('delete provider cascades', async () => {
    const { p } = seedAlem()
    const r = await json(await one.DELETE(req(`/api/giga-admin/ai-providers/${p.id}`, 'DELETE'), { params: { id: p.id } }))
    expect(r.body).toEqual({ ok: true, deleted: true })
    expect(fakeDb.providers).toHaveLength(0)
    expect(fakeDb.models).toHaveLength(0)
  })
})
