/**
 * Migration 094 against a real database: seeds, constraints, RLS (API roles
 * cannot read keys), encryption at rest through the service, cascade delete,
 * ledger provider_key / model_price, spend summary.
 *
 * Routes are only ever written inside rolled-back transactions: other test
 * files resolve providers concurrently and must keep seeing "no routes".
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedUser } from '../../helpers/pg-rls'

vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))

const TABLES = ['ai_providers', 'ai_credentials', 'ai_models', 'ai_routes', 'ai_budgets'] as const

type Db = Parameters<Parameters<typeof inRollback>[0]>[0]

/** Error code of one statement, keeping the surrounding transaction usable. */
async function failCode(db: Db, sql: string, params: unknown[] = []): Promise<string | null> {
  await db.query('SAVEPOINT expect_fail')
  const code = await pgErrorCode(db.query(sql, params))
  await db.query(code ? 'ROLLBACK TO SAVEPOINT expect_fail' : 'RELEASE SAVEPOINT expect_fail')
  return code
}

describe.skipIf(!dbTestsEnabled)('094 ai providers & credentials', async () => {
  const { prisma } = await import('@/lib/db')
  const service = await import('@/lib/ai/providers/service')
  const store = await import('@/lib/ai/providers/store')
  const { recordUsage } = await import('@/lib/ai/usage-ledger')
  const { decryptSecret } = await import('@/lib/crypto/secrets')

  const tag = randomUUID().slice(0, 8)
  const providerKey = `t-${tag}`
  const actor = { kind: 'staff' as const, id: randomUUID(), label: 'db-test' }
  const SECRET = `itest-secret-${randomUUID()}`
  const savedKey = process.env.SECRETS_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.ai_providers WHERE key = ${providerKey}`
    await prisma.$executeRaw`DELETE FROM public.ai_usage_ledger WHERE source LIKE ${`feature:itest.${tag}%`}`
    if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
    else process.env.SECRETS_ENCRYPTION_KEY = savedKey
    await closeTestPool()
  })

  it('seeds OpenRouter, Alem Plus and the alemllm chat model — and no keys', async () => {
    const rows = await prisma.$queryRaw<Array<{ key: string; kind: string; base_url: string; chat_path: string }>>`
      SELECT key, kind, base_url, chat_path FROM public.ai_providers WHERE key IN ('openrouter', 'alem') ORDER BY key`
    expect(rows).toEqual([
      { key: 'alem', kind: 'openai_compatible', base_url: 'https://llm.alem.ai/v1', chat_path: '/chat/completions' },
      { key: 'openrouter', kind: 'openrouter', base_url: 'https://openrouter.ai/api/v1', chat_path: '/chat/completions' },
    ])
    const models = await prisma.$queryRaw<Array<{ model_id: string; capability: string; price_in_per_mtok: unknown }>>`
      SELECT m.model_id, m.capability, m.price_in_per_mtok FROM public.ai_models m
      JOIN public.ai_providers p ON p.id = m.provider_id WHERE p.key = 'alem'`
    expect(models).toEqual([{ model_id: 'alemllm', capability: 'chat', price_in_per_mtok: null }])
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM public.ai_credentials c JOIN public.ai_providers p ON p.id = c.provider_id
      WHERE p.key IN ('openrouter', 'alem')`
    expect(Number(n)).toBe(0)
  })

  it('API roles have no privileges on any 094 table; RLS is on', async () => {
    for (const t of TABLES) {
      const [{ ok, rls }] = await prisma.$queryRaw<Array<{ ok: boolean; rls: boolean }>>`
        SELECT NOT has_table_privilege('anon', ${`public.${t}`}, 'SELECT')
           AND NOT has_table_privilege('authenticated', ${`public.${t}`}, 'SELECT')
           AND NOT has_table_privilege('authenticated', ${`public.${t}`}, 'INSERT') AS ok,
          (SELECT relrowsecurity FROM pg_class WHERE oid = ${`public.${t}`}::regclass) AS rls`
      expect({ t, ok, rls }).toEqual({ t, ok: true, rls: true })
    }
    await inRollback(async (db) => {
      const userId = await seedUser(db, { status: 'approved' })
      expect(await pgErrorCode(asUser(db, userId, () => db.query('SELECT * FROM public.ai_credentials')))).toBe('42501')
      expect(await pgErrorCode(asUser(db, null, () => db.query('SELECT * FROM public.ai_credentials')))).toBe('42501')
      expect(await pgErrorCode(asUser(db, userId, () => db.query('SELECT * FROM public.ai_providers')))).toBe('42501')
      const rows = await asService(db, () => db.query(`SELECT key FROM public.ai_providers WHERE key = 'alem'`))
      expect(rows.rowCount).toBe(1)
    })
  })

  it('the service stores keys encrypted (never the plaintext) and masks them on read', async () => {
    const p = await service.createProvider(actor, { key: providerKey, name: 'ITest', baseUrl: 'https://llm.example.com/v1' })
    const masked = await service.addCredential(actor, p.id, 'main', SECRET)
    expect(masked.masked).toBe(`••••${SECRET.slice(-4)}`)

    const [row] = await prisma.$queryRaw<Array<{ secret_ciphertext: string; secret_hint: string }>>`
      SELECT secret_ciphertext, secret_hint FROM public.ai_credentials WHERE id = ${masked.id}::uuid`
    expect(row.secret_ciphertext).not.toBe(SECRET)
    expect(row.secret_ciphertext).not.toContain(SECRET)
    expect(row.secret_ciphertext).toMatch(/^v1:/)
    expect(row.secret_hint).toBe(SECRET.slice(-4))
    expect(decryptSecret(row.secret_ciphertext)).toBe(SECRET)

    const view = await service.getProvider(providerKey)
    expect(view?.credentials).toHaveLength(1)
    expect(JSON.stringify(view)).not.toContain(SECRET)
    expect(JSON.stringify(view)).not.toContain(row.secret_ciphertext)

    const m = await service.upsertModel(actor, { providerId: p.id, modelId: `itest-${tag}`, capability: 'chat', priceInPerMtok: 0.25, priceOutPerMtok: 1 })
    expect(m).toMatchObject({ price_in_per_mtok: 0.25, price_out_per_mtok: 1 })
    const again = await service.upsertModel(actor, { providerId: p.id, modelId: `itest-${tag}`, capability: 'chat', priceInPerMtok: 0.5 })
    expect(again.id).toBe(m.id)
    expect(again.price_in_per_mtok).toBe(0.5)

    await service.updateProvider(actor, p.id, { dailyBudgetUsd: 7.5 })
    expect((await store.getProvider(p.id))?.daily_budget_usd).toBe(7.5)
  })

  it('the database refuses a plaintext key and enforces the route shape', async () => {
    await inRollback(async (db) => {
      const { rows: [p] } = await db.query(`SELECT id FROM public.ai_providers WHERE key = 'alem'`)
      expect(await pgErrorCode(db.query(
        `INSERT INTO public.ai_credentials (provider_id, label, secret_ciphertext) VALUES ($1, 'x', 'sk-plaintext')`, [p.id],
      ))).toBe('23514')
    })
    await inRollback(async (db) => {
      const { rows: [m] } = await db.query(
        `SELECT m.id FROM public.ai_models m JOIN public.ai_providers p ON p.id = m.provider_id WHERE p.key = 'alem' AND m.model_id = 'alemllm'`)
      expect(await failCode(db, `INSERT INTO public.ai_routes (capability, tier, model_id) VALUES ('chat', NULL, $1)`, [m.id])).toBe('23514')
      expect(await failCode(db, `INSERT INTO public.ai_routes (capability, tier, model_id) VALUES ('embeddings', 'light', $1)`, [m.id])).toBe('23514')
      await db.query(`INSERT INTO public.ai_routes (capability, tier, model_id) VALUES ('chat', 'light', $1)`, [m.id])
      expect(await failCode(db, `INSERT INTO public.ai_routes (capability, tier, model_id) VALUES ('chat', 'light', $1)`, [m.id])).toBe('23505')
    })
  })

  it('deleting a provider cascades to its keys, models and routes', async () => {
    await inRollback(async (db) => {
      const { rows: [p] } = await db.query(
        `INSERT INTO public.ai_providers (key, name, kind, base_url) VALUES ($1, 'Cascade', 'openai_compatible', 'https://c.example.com/v1') RETURNING id`,
        [`c-${tag}`])
      const { rows: [c] } = await db.query(
        `INSERT INTO public.ai_credentials (provider_id, label, secret_ciphertext) VALUES ($1, 'k', 'v1:a:b:c') RETURNING id`, [p.id])
      const { rows: [m] } = await db.query(
        `INSERT INTO public.ai_models (provider_id, credential_id, model_id, capability) VALUES ($1, $2, 'cm', 'ocr') RETURNING id`, [p.id, c.id])
      await db.query(`INSERT INTO public.ai_routes (capability, tier, model_id) VALUES ('ocr', NULL, $1)`, [m.id])
      await db.query(`DELETE FROM public.ai_providers WHERE id = $1`, [p.id])
      const { rows: [counts] } = await db.query(
        `SELECT (SELECT count(*) FROM public.ai_credentials WHERE id = $1)::int AS creds,
                (SELECT count(*) FROM public.ai_models WHERE id = $2)::int AS models,
                (SELECT count(*) FROM public.ai_routes WHERE model_id = $2)::int AS routes`, [c.id, m.id])
      expect(counts).toEqual({ creds: 0, models: 0, routes: 0 })
    })
  })

  it('service.deleteProvider removes the test provider with its keys', async () => {
    const p = await store.getProviderByKey(providerKey)
    expect(p).not.toBeNull()
    await service.deleteProvider(actor, p!.id)
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM public.ai_credentials WHERE provider_id = ${p!.id}::uuid`
    expect(Number(n)).toBe(0)
    expect(await store.getProviderByKey(providerKey)).toBeNull()
  })

  it('the ledger records the provider and model-price costs; spend groups by provider', async () => {
    // Cost-free row today (does not move today's platform spend under other tests)…
    await recordUsage({ source: `feature:itest.${tag}`, model: 'alemllm', tokensIn: 5, tokensOut: 1, costUsd: 0, costSource: 'model_price', providerKey: `p-${tag}`, ok: true })
    const [today] = await prisma.$queryRaw<Array<{ provider_key: string; cost_source: string }>>`
      SELECT provider_key, cost_source FROM public.ai_usage_ledger WHERE source = ${`feature:itest.${tag}`}`
    expect(today).toEqual({ provider_key: `p-${tag}`, cost_source: 'model_price' })
    // …and priced rows dated yesterday for the summary.
    await prisma.$executeRaw`
      INSERT INTO public.ai_usage_ledger (source, model, tokens_in, tokens_out, cost_usd, cost_source, provider_key, created_at)
      VALUES (${`feature:itest.${tag}.a`}, 'alemllm', 10, 2, '0.40'::numeric, 'model_price', ${`p-${tag}`}, now() - interval '1 day'),
             (${`feature:itest.${tag}.b`}, 'alemllm', 10, 2, '0.10'::numeric, 'model_price', ${`p-${tag}`}, now() - interval '1 day')`

    const byProvider = await service.spendSummary({ days: 7, groupBy: 'provider' })
    expect(byProvider.rows.find((r) => r.key === `p-${tag}`)).toMatchObject({ calls: 3, tokensIn: 25, tokensOut: 5 })
    expect(byProvider.rows.find((r) => r.key === `p-${tag}`)?.costUsd).toBeCloseTo(0.5, 6)
    const byFeature = await service.spendSummary({ days: 7, groupBy: 'feature' })
    expect(byFeature.rows.find((r) => r.key === `feature:itest.${tag}.a`)?.costUsd).toBeCloseTo(0.4, 6)
    expect(await store.providerSpendToday(`p-${tag}`)).toBe(0)
    await expect(service.spendSummary({ days: 0 })).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('budgets row exists and round-trips through the store', async () => {
    const before = await store.getBudgetsRow()
    expect(before).not.toBeNull()
    await inRollback(async (db) => {
      await db.query(`UPDATE public.ai_budgets SET platform_daily_usd = 12.5 WHERE id = 1`)
      const { rows: [r] } = await db.query(`SELECT platform_daily_usd::text AS p FROM public.ai_budgets WHERE id = 1`)
      expect(r.p).toBe('12.50')
      expect(await pgErrorCode(db.query(`INSERT INTO public.ai_budgets (id) VALUES (2)`))).toBe('23514')
    })
  })
})
