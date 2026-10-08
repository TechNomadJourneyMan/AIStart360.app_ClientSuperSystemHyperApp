/**
 * Migration 107 against a real database: transcribe capability, model source
 * and metadata columns, the discovery store functions (text[] binding, manual
 * rows untouched, unambiguous key binding) and upsertModelRow keeping
 * metadata it was not given.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { closeTestPool, inRollback, pgErrorCode } from '../../helpers/pg-rls'

vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))

describe.skipIf(!dbTestsEnabled)('107 ai model discovery', async () => {
  const { prisma } = await import('@/lib/db')
  const service = await import('@/lib/ai/providers/service')
  const store = await import('@/lib/ai/providers/store')
  const { discoverCredentialModels } = await import('@/lib/ai/providers/discovery')

  const tag = randomUUID().slice(0, 8)
  const providerKey = `d-${tag}`
  const actor = { kind: 'staff' as const, id: randomUUID(), label: 'db-test' }
  const savedKey = process.env.SECRETS_ENCRYPTION_KEY
  const publicDns = async () => ['93.184.216.34']

  beforeAll(() => {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.ai_providers WHERE key = ${providerKey}`
    if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
    else process.env.SECRETS_ENCRYPTION_KEY = savedKey
    await closeTestPool()
  })

  it('constraints: transcribe is a capability, source / tier_hint are checked', async () => {
    await inRollback(async (db) => {
      const { rows: [p] } = await db.query(`SELECT id FROM public.ai_providers WHERE key = 'alem'`)
      const ins = await db.query(
        `INSERT INTO public.ai_models (provider_id, model_id, capability) VALUES ($1, 'whisper-x', 'transcribe') RETURNING source, supports_vision, tier_hint`,
        [p.id])
      expect(ins.rows[0]).toEqual({ source: 'manual', supports_vision: null, tier_hint: null })
      await db.query('SAVEPOINT a')
      expect(await pgErrorCode(db.query(`INSERT INTO public.ai_models (provider_id, model_id, capability, source) VALUES ($1, 'x1', 'chat', 'robot')`, [p.id]))).toBe('23514')
      await db.query('ROLLBACK TO SAVEPOINT a')
      expect(await pgErrorCode(db.query(`INSERT INTO public.ai_models (provider_id, model_id, capability, tier_hint) VALUES ($1, 'x2', 'chat', 'ultra')`, [p.id]))).toBe('23514')
      await db.query('ROLLBACK TO SAVEPOINT a')
      const { rows: [m] } = await db.query(`SELECT id FROM public.ai_models WHERE provider_id = $1 AND model_id = 'whisper-x'`, [p.id])
      await db.query(`INSERT INTO public.ai_routes (capability, tier, model_id) VALUES ('transcribe', NULL, $1)`, [m.id])
    })
  })

  it('discovery stores the list on the key, adds new models, binds the owner\'s model, keeps its fields', async () => {
    const p = await service.createProvider(actor, { key: providerKey, name: 'Discovery', baseUrl: 'https://llm.example.com/v1' }, { resolve: publicDns })
    const k1 = await service.addCredential(actor, p.id, 'Alem LLM', `secret-one-${tag}`)
    const manual = await service.upsertModel(actor, { providerId: p.id, modelId: 'AlemLLM', capability: 'chat', label: 'Владелец', priceInPerMtok: 1, tierHint: 'standard' })
    const fetchImpl = (async () => new Response(JSON.stringify({ data: [{ id: 'AlemLLM' }, { id: 'Embedder' }, { id: 'qwen2.5-vl' }, { id: 'Speech-to-Text' }] }), { status: 200 })) as typeof fetch

    const out = await discoverCredentialModels(k1.id, { fetchImpl, resolve: publicDns })
    expect(out).toMatchObject({ ok: true, added: 3, bound: 1 })

    const cred = await store.getCredential(k1.id)
    expect(cred?.discovered_models).toEqual(['AlemLLM', 'Embedder', 'qwen2.5-vl', 'Speech-to-Text'])
    expect(cred?.models_discovered_at).toBeInstanceOf(Date)

    const models = await store.listModels(p.id)
    const by = (id: string) => models.find((m) => m.model_id === id)
    expect(by('AlemLLM')).toMatchObject({ id: manual.id, source: 'manual', label: 'Владелец', price_in_per_mtok: 1, tier_hint: 'standard', credential_id: k1.id })
    expect(by('Embedder')).toMatchObject({ capability: 'embeddings', source: 'discovered', credential_id: k1.id })
    expect(by('qwen2.5-vl')).toMatchObject({ capability: 'chat', supports_vision: true })
    expect(by('Speech-to-Text')).toMatchObject({ capability: 'transcribe' })

    // An owner's edit without metadata keeps it, and makes the row manual.
    const edited = await service.upsertModel(actor, { providerId: p.id, modelId: 'Embedder', capability: 'embeddings', label: 'Эмбеддер' })
    expect(edited).toMatchObject({ source: 'manual', label: 'Эмбеддер', credential_id: null })

    // A failed discovery keeps the last list and records the error.
    const failing = (async () => new Response('nope', { status: 404 })) as typeof fetch
    const bad = await discoverCredentialModels(k1.id, { fetchImpl: failing, resolve: publicDns })
    expect(bad).toMatchObject({ ok: false })
    const after = await store.getCredential(k1.id)
    expect(after?.discovered_models).toHaveLength(4)
    expect(after?.discovery_error).toMatch(/HTTP 404/)
  })
})
