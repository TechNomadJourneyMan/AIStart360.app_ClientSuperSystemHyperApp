/**
 * E-commerce integrations on the real database (migration 105).
 *
 *   • RLS / grants: members and staff read connections and facts of their
 *     companies, nobody else; the secret columns are not selectable by any
 *     PostgREST role; anon / authenticated cannot write; CHECKs reject a
 *     plaintext secret and inconsistent states.
 *   • Sync engine (lib/integrations/sync.ts) with a recording fetch: facts +
 *     cursor in one transaction, idempotent re-sync, lease (no double claim),
 *     needs_reauth + INTEGRATION_FAILED on 401, repeated failures → status
 *     'error' + one event per day, rate limits are not failures, disconnect
 *     deletes the secret.
 *   • Metrics from facts: materialisation writes source 'external' with
 *     provenance {provider, period, fetched_at}; the dashboard snapshot shows
 *     the same numbers; the integration_sync agent runs through the runtime.
 * Nothing leaves the box: provider calls go to a fake fetch.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import type { PlatformEventInput } from '@/lib/events/platform'

const NOW = new Date('2026-10-06T10:00:00Z')

describe.skipIf(!dbTestsEnabled)('integration connections (105)', async () => {
  const { prisma } = await import('@/lib/db')
  const { closeTestPool, inRollback, asUser, pgErrorCode, seedCompany, seedStaff, seedUser } = await import('../../helpers/pg-rls')
  const { pgSupabase } = await import('./metrics-pg-client')
  const store = await import('@/lib/integrations/store')
  const { syncConnectionNow, runDueSyncs, FAILURE_ALERT_THRESHOLD } = await import('@/lib/integrations/sync')
  const { sealCredentials } = await import('@/lib/integrations/credentials')
  const { materializeForTenant } = await import('@/lib/metrics/materialize-tenant')
  const { integrationsSnapshot } = await import('@/lib/integrations/service')
  const { addDays } = await import('@/lib/integrations/period')

  const tag = `w7${Date.now()}`
  const users: string[] = []
  const companies: string[] = []
  const savedKey = process.env.SECRETS_ENCRYPTION_KEY
  const TOKEN = `kaspi-token-${randomUUID()}`

  async function mkCompany(): Promise<{ owner: string; company: string }> {
    const owner = randomUUID()
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${owner}::uuid, ${`${tag}.${owner.slice(0, 8)}@test.local`})`
    await prisma.$executeRaw`UPDATE public.profiles SET status = 'approved' WHERE id = ${owner}::uuid`
    const company = randomUUID()
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES (${company}, ${`${tag} shop`}, ${owner}::uuid, now())`
    users.push(owner)
    companies.push(company)
    return { owner, company }
  }

  // Kaspi orders API shape (guide.kaspi.kz …/orders/q3201).
  let kaspiMode: 'ok' | 'unauthorized' | 'down' | 'limited' = 'ok'
  let kaspiPrice = 10_000
  const calls: string[] = []
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input)
    calls.push(url)
    if (!url.startsWith('https://kaspi.kz/shop/api/v2/orders')) return new Response('{}', { status: 404 })
    if (kaspiMode === 'unauthorized') return new Response(JSON.stringify({ errors: [{ title: 'Unauthorized' }] }), { status: 401 })
    if (kaspiMode === 'down') return new Response('{}', { status: 503 })
    if (kaspiMode === 'limited') return new Response('{}', { status: 429, headers: { 'retry-after': '120' } })
    const q = new URL(url).searchParams
    const from = Number(q.get('filter[orders][creationDate][$ge]'))
    const data = q.get('filter[orders][state]') === 'ARCHIVE'
      ? [{ type: 'orders', id: `o-${from}`, attributes: { totalPrice: kaspiPrice, status: 'COMPLETED', creationDate: from + 3_600_000 } }]
      : []
    return new Response(JSON.stringify({ data, meta: { pageCount: data.length ? 1 : 0, totalCount: data.length } }), { status: 200 })
  }) as unknown as typeof fetch

  const events: PlatformEventInput[] = []
  const deps = { fetch: fakeFetch, now: () => NOW, emit: async (e: PlatformEventInput) => { events.push(e) } }

  async function connectKaspi(company: string, owner: string) {
    return store.saveConnection({
      companyId: company, provider: 'kaspi', authKind: 'token', secretCiphertext: sealCredentials({ token: TOKEN }),
      settings: {}, accountLabel: 'Kaspi Магазин', createdBy: owner,
    })
  }

  async function connRow(id: string) {
    const r = await prisma.$queryRaw<Array<{ status: string; error_count: number; cursor: Record<string, unknown>; secret_ciphertext: string | null; last_error: string | null; last_error_kind: string | null; next_sync_at: Date; last_sync_at: Date | null }>>`
      SELECT status, error_count, cursor, secret_ciphertext, last_error, last_error_kind, next_sync_at, last_sync_at
      FROM public.integration_connections WHERE id = ${id}::uuid`
    return r[0]
  }

  const makeDue = (id: string) => prisma.$executeRaw`UPDATE public.integration_connections SET next_sync_at = now() - interval '1 minute' WHERE id = ${id}::uuid`

  beforeAll(() => {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
    else process.env.SECRETS_ENCRYPTION_KEY = savedKey
    if (companies.length) {
      await prisma.$executeRaw`DELETE FROM public.platform_events WHERE company_id = ANY (${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE agent_key = 'integration_sync' AND requested_by = ${`test:${tag}`}`
      await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ANY (${companies}::text[])`
    }
    if (users.length) await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ANY (${users}::uuid[])`
    await closeTestPool()
  })

  // ── RLS / grants / CHECKs ─────────────────────────────────────────────────

  it('members and staff read; outsiders and anon do not; secrets are never selectable; no client writes', async () => {
    await inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const member = await seedUser(db, { status: 'approved' })
      const outsider = await seedUser(db, { status: 'approved' })
      const staff = await seedStaff(db, 'support')
      const company = await seedCompany(db, owner)
      const other = await seedCompany(db, outsider)
      await db.query(`INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [company, member])
      await db.query(
        `INSERT INTO public.integration_connections (company_id, provider, status, auth_kind, secret_ciphertext) VALUES ($1, 'kaspi', 'connected', 'token', 'v1:aaaa:bbbb:cccc'), ($2, 'kaspi', 'connected', 'token', 'v1:dddd:eeee:ffff')`,
        [company, other],
      )
      await db.query(
        `INSERT INTO public.integration_facts (company_id, provider, metric_key, period_start, period_end, value, unit) VALUES ($1, 'kaspi', 'orders_count', '2026-10-01', '2026-10-01', 5, 'count'), ($2, 'kaspi', 'orders_count', '2026-10-01', '2026-10-01', 9, 'count')`,
        [company, other],
      )

      const visible = (uid: string | null) => asUser(db, uid, async () => (await db.query(`SELECT company_id, provider, status FROM public.integration_connections`)).rows)
      expect((await visible(owner)).map((r) => r.company_id)).toEqual([company])
      expect((await visible(member)).map((r) => r.company_id)).toEqual([company])
      expect(await visible(outsider)).toEqual([{ company_id: other, provider: 'kaspi', status: 'connected' }])
      expect((await visible(staff)).length).toBeGreaterThanOrEqual(2)

      for (const uid of [owner, staff]) {
        expect(await pgErrorCode(asUser(db, uid, () => db.query(`SELECT secret_ciphertext FROM public.integration_connections`)))).toBe('42501')
        expect(await pgErrorCode(asUser(db, uid, () => db.query(`SELECT refresh_ciphertext FROM public.integration_connections`)))).toBe('42501')
        expect(await pgErrorCode(asUser(db, uid, () => db.query(`SELECT * FROM public.integration_connections`)))).toBe('42501')
      }
      expect(await pgErrorCode(asUser(db, null, () => db.query(`SELECT id FROM public.integration_connections`)))).toBe('42501')
      expect(await pgErrorCode(asUser(db, null, () => db.query(`SELECT id FROM public.integration_facts`)))).toBe('42501')

      expect(await pgErrorCode(asUser(db, owner, () => db.query(`INSERT INTO public.integration_connections (company_id, provider, auth_kind) VALUES ($1, 'ga4', 'file')`, [company])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => db.query(`UPDATE public.integration_connections SET status = 'error' WHERE company_id = $1`, [company])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => db.query(`DELETE FROM public.integration_facts WHERE company_id = $1`, [company])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => db.query(`INSERT INTO public.integration_facts (company_id, provider, metric_key, period_start, period_end, value) VALUES ($1, 'kaspi', 'revenue', '2026-10-01', '2026-10-01', 1)`, [company])))).toBe('42501')

      const facts = (uid: string) => asUser(db, uid, async () => (await db.query(`SELECT value::float8 AS v FROM public.integration_facts`)).rows.map((r) => r.v))
      expect(await facts(member)).toEqual([5])
      expect(await facts(outsider)).toEqual([9])
    })
  })

  it('CHECKs: only v1 ciphertext, secrets match the state, known providers only', async () => {
    await inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      const ins = async (provider: string, status: string, auth: string, secret: string | null) => {
        await db.query('SAVEPOINT chk')
        const code = await pgErrorCode(db.query(
          `INSERT INTO public.integration_connections (company_id, provider, status, auth_kind, secret_ciphertext) VALUES ($1, $2, $3, $4, $5)`,
          [company, provider, status, auth, secret],
        ))
        await db.query('ROLLBACK TO SAVEPOINT chk')
        return code
      }
      expect(await ins('kaspi', 'connected', 'token', 'plain-token-value')).toBe('23514')
      expect(await ins('kaspi', 'connected', 'token', null)).toBe('23514')
      expect(await ins('kaspi', 'disconnected', 'token', 'v1:a:b:c')).toBe('23514')
      expect(await ins('ozon', 'connected', 'file', 'v1:a:b:c')).toBe('23514')
      expect(await ins('amazon', 'connected', 'file', null)).toBe('23514')
      expect(await ins('ozon', 'connected', 'file', null)).toBeNull()
      expect(await ins('kaspi', 'disconnected', 'token', null)).toBeNull()
    })
  })

  // ── Sync engine ───────────────────────────────────────────────────────────

  it('sync writes facts and the cursor; a re-sync of the same days is idempotent', async () => {
    const { owner, company } = await mkCompany()
    const conn = await connectKaspi(company, owner)
    const stored = await connRow(conn.id)
    expect(stored.secret_ciphertext?.startsWith('v1:')).toBe(true)
    expect(stored.secret_ciphertext).not.toContain(TOKEN)

    kaspiMode = 'ok'
    const first = await syncConnectionNow(conn.id, deps)
    expect(first).toMatchObject({ status: 'synced', factsWritten: 7 * 6 })
    const row = await connRow(conn.id)
    expect(row.status).toBe('connected')
    expect(row.cursor.filled_to).toBe(addDays('2026-09-01', 6))
    expect(row.last_sync_at).not.toBeNull()
    expect(row.next_sync_at.getTime()).toBeGreaterThan(NOW.getTime())
    expect(calls.every((u) => !u.includes(TOKEN))).toBe(true)

    // Same window again (cursor rewound): same rows, new values.
    await prisma.$executeRaw`UPDATE public.integration_connections SET cursor = '{}'::jsonb WHERE id = ${conn.id}::uuid`
    kaspiPrice = 12_000
    const again = await syncConnectionNow(conn.id, deps)
    expect(again?.status).toBe('synced')
    const counts = await prisma.$queryRaw<Array<{ n: number; revenue: number }>>`
      SELECT count(*)::int AS n, max(value) FILTER (WHERE metric_key = 'revenue')::float8 AS revenue
      FROM public.integration_facts WHERE company_id = ${company}`
    expect(counts[0]).toEqual({ n: 42, revenue: 12_000 })
  })

  it('a leased connection is not claimed twice', async () => {
    const { owner, company } = await mkCompany()
    const conn = await connectKaspi(company, owner)
    const a = await store.claimConnection(conn.id, 120)
    const b = await store.claimConnection(conn.id, 120)
    expect(a).not.toBeNull()
    expect(b).toBeNull()
    // The lease holder finishes; a stale token cannot overwrite.
    await store.finishSyncFailure({ ...a!, leaseToken: randomUUID() }, { kind: 'transient', message: 'x', nextSyncAt: new Date(), status: 'connected', countAsFailure: true })
    expect((await connRow(conn.id)).error_count).toBe(0)
  })

  it('401 → needs_reauth at once, INTEGRATION_FAILED, no further claims', async () => {
    const { owner, company } = await mkCompany()
    const conn = await connectKaspi(company, owner)
    kaspiMode = 'unauthorized'
    events.length = 0
    const out = await syncConnectionNow(conn.id, deps)
    expect(out).toMatchObject({ status: 'needs_reauth', errorKind: 'auth', alerted: true })
    const row = await connRow(conn.id)
    expect(row.status).toBe('needs_reauth')
    expect(row.last_error_kind).toBe('auth')
    expect(row.last_error).not.toContain(TOKEN)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name: 'INTEGRATION_FAILED', companyId: company, subjectId: conn.id })
    expect(await syncConnectionNow(conn.id, deps)).toBeNull()
  })

  it('repeated failures: backoff, status error and one alert per day; rate limits are not failures', async () => {
    const { owner, company } = await mkCompany()
    const conn = await connectKaspi(company, owner)
    events.length = 0
    kaspiMode = 'limited'
    expect((await syncConnectionNow(conn.id, deps))?.status).toBe('rate_limited')
    expect((await connRow(conn.id)).error_count).toBe(0)

    kaspiMode = 'down'
    for (let i = 1; i <= FAILURE_ALERT_THRESHOLD + 1; i++) {
      await makeDue(conn.id)
      const out = await syncConnectionNow(conn.id, deps)
      expect(out?.status).toBe('failed')
      const row = await connRow(conn.id)
      expect(row.error_count).toBe(i)
      expect(row.status).toBe(i >= FAILURE_ALERT_THRESHOLD ? 'error' : 'connected')
      expect(row.next_sync_at.getTime()).toBeGreaterThan(NOW.getTime())
    }
    // The emitter is called on every failure past the threshold; the dedupe key makes it one event per day.
    const keys = new Set(events.map((e) => e.dedupeKey))
    expect(keys.size).toBe(1)

    kaspiMode = 'ok'
    await makeDue(conn.id)
    expect((await syncConnectionNow(conn.id, deps))?.status).toBe('synced')
    expect(await connRow(conn.id)).toMatchObject({ status: 'connected', error_count: 0, last_error: null })
  })

  it('the default emitter writes one INTEGRATION_FAILED platform event (dedupe)', async () => {
    const { owner, company } = await mkCompany()
    const conn = await connectKaspi(company, owner)
    vi.stubGlobal('fetch', (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch)
    kaspiMode = 'unauthorized'
    await syncConnectionNow(conn.id, { fetch: fakeFetch, now: () => NOW })
    await prisma.$executeRaw`UPDATE public.integration_connections SET status = 'connected', next_sync_at = now() WHERE id = ${conn.id}::uuid`
    await syncConnectionNow(conn.id, { fetch: fakeFetch, now: () => NOW })
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM public.platform_events WHERE name = 'INTEGRATION_FAILED' AND subject_id = ${conn.id}`
    expect(rows[0].n).toBe(1)
    vi.unstubAllGlobals()
  })

  it('disconnect deletes the secret; a file connection is removed', async () => {
    const { owner, company } = await mkCompany()
    const conn = await connectKaspi(company, owner)
    expect(await store.disconnectConnection(company, 'kaspi')).toBe(true)
    expect(await connRow(conn.id)).toMatchObject({ status: 'disconnected', secret_ciphertext: null })
    expect(await syncConnectionNow(conn.id, deps)).toBeNull()

    await store.saveConnection({ companyId: company, provider: 'ozon', authKind: 'file', secretCiphertext: null, settings: {}, accountLabel: null, createdBy: owner })
    expect(await store.disconnectConnection(company, 'ozon')).toBe(true)
    expect(await store.getConnection(company, 'ozon')).toBeNull()
  })

  // ── Metrics from facts ────────────────────────────────────────────────────

  it('facts → public.metrics (source external, provenance) → the same numbers in the dashboard snapshot', async () => {
    const { owner, company } = await mkCompany()
    await store.saveConnection({ companyId: company, provider: 'ga4', authKind: 'token', secretCiphertext: sealCredentials({ service_account_json: '{}' }), settings: { property_id: '1' }, accountLabel: 'GA4', createdBy: owner })
    await prisma.$executeRaw`UPDATE public.integration_connections SET next_sync_at = now() + interval '1 day' WHERE company_id = ${company}`
    const today = new Date().toISOString().slice(0, 10)
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, -1 - i))
    await prisma.$transaction(async (tx) => {
      await store.upsertFacts(tx, company, 'ga4', days.map((d) => ({ metricKey: 'sessions' as const, periodStart: d, periodEnd: d, value: 100, unit: 'count' })))
      await store.upsertFacts(tx, company, 'ga4', days.flatMap((d) => [
        { metricKey: 'web_revenue' as const, periodStart: d, periodEnd: d, value: 50_000, unit: 'KZT' },
        { metricKey: 'web_purchases' as const, periodStart: d, periodEnd: d, value: 5, unit: 'count' },
      ]))
    })
    // A survey answer that the integration must beat (current wizard key of «Кол-во SKU» is not involved here).
    await inRollback(async (db) => {
      const service = pgSupabase(db, null)
      const { values } = await materializeForTenant(service, service, { companyId: company, userId: owner })
      const visits = values.find((v) => v.metricId === 'biz.marketing.posescheniy_sayta_mes')
      expect(visits?.numeric).toBe(3000)
      const { rows } = await db.query(
        `SELECT metric_key, metric_value::float8 AS v, source, provenance FROM public.metrics WHERE company_id = $1 AND metric_key IN ('biz.marketing.posescheniy_sayta_mes', 'biz.prodazhi.ecommerce_sredniy_chek')`,
        [company],
      )
      const byKey = Object.fromEntries(rows.map((r) => [r.metric_key, r]))
      expect(byKey['biz.marketing.posescheniy_sayta_mes']).toMatchObject({ v: 3000, source: 'external' })
      expect(byKey['biz.marketing.posescheniy_sayta_mes'].provenance.external).toMatchObject({ provider: 'ga4', period_start: days[29], period_end: days[0], days: 30 })
      expect(byKey['biz.prodazhi.ecommerce_sredniy_chek']).toMatchObject({ v: 10_000, source: 'external' })

      // The owner's dashboard (session client, RLS) shows the same values.
      const snap = await integrationsSnapshot(pgSupabase(db, owner), company)
      expect(snap.metrics['biz.marketing.posescheniy_sayta_mes'].value).toBe(3000)
      const ga4 = snap.providers.find((p) => p.provider === 'ga4')!
      expect(ga4.totals.sessions?.value).toBe(3000)
      expect(ga4.averageOrder).toEqual({ value: 10_000, unit: 'KZT' })
      expect(snap.connections.map((c) => c.provider)).toEqual(['ga4'])
      expect(JSON.stringify(snap)).not.toContain('v1:')
    })
  })

  it('integration_sync runs through the agent runtime: due connections only, metrics refreshed', async () => {
    const { __useTestAgents } = await import('@/lib/agents/registry')
    const { enqueueAgentTask, executeTaskById } = await import('@/lib/agents/queue')
    const { integrationSyncAgent, __setIntegrationsIOForTests } = await import('@/lib/agents/definitions/integration-sync')
    // Park every other connection of this file so the agent sees only ours.
    await prisma.$executeRaw`UPDATE public.integration_connections SET next_sync_at = now() + interval '1 day' WHERE company_id = ANY (${companies}::text[])`
    const { owner, company } = await mkCompany()
    const conn = await connectKaspi(company, owner)
    kaspiMode = 'ok'
    vi.stubGlobal('fetch', fakeFetch)
    const refreshed: string[] = []
    __setIntegrationsIOForTests({ materialize: async (id) => { refreshed.push(id); return { written: 3, skipped: false } } })
    __useTestAgents([integrationSyncAgent])
    try {
      const { id } = await enqueueAgentTask({ agentKey: 'integration_sync', companyId: null, trigger: 'manual', requestedBy: `test:${tag}`, kick: false, idempotencyKey: `${tag}:run` })
      const report = await executeTaskById(id)
      const run = await prisma.$queryRaw<Array<{ output: unknown; error: string | null; tools: unknown; result: unknown }>>`
        SELECT r.output_summary AS output, r.error_message AS error, r.tools_used AS tools,
          (SELECT json_agg(json_build_object('tool', c.tool, 'status', c.status, 'code', c.error_code, 'sum', c.result_summary)) FROM public.agent_tool_calls c WHERE c.run_id = r.id) AS result
        FROM public.agent_runs r WHERE r.task_id = ${id}::uuid`
      expect(report?.finalStatus, JSON.stringify(run)).toBe('succeeded')
      expect(refreshed, JSON.stringify(run)).toEqual([company])
      const row = await connRow(conn.id)
      expect(row.status).toBe('connected')
      expect(row.cursor.filled_to).toBeTruthy()
      const calls2 = await prisma.$queryRaw<Array<{ tool: string }>>`
        SELECT c.tool FROM public.agent_tool_calls c JOIN public.agent_runs r ON r.id = c.run_id
        WHERE r.task_id = ${id}::uuid ORDER BY c.seq`
      expect(calls2.map((c) => c.tool)).toEqual(['integrations.sync_due', 'integrations.refresh_metrics'])
    } finally {
      __setIntegrationsIOForTests(null)
      vi.unstubAllGlobals()
    }
  })

  it('runDueSyncs claims only due connections and stops at the limit', async () => {
    await prisma.$executeRaw`UPDATE public.integration_connections SET next_sync_at = now() + interval '1 day' WHERE company_id = ANY (${companies}::text[])`
    const a = await mkCompany()
    const b = await mkCompany()
    const ca = await connectKaspi(a.company, a.owner)
    const cb = await connectKaspi(b.company, b.owner)
    await prisma.$executeRaw`UPDATE public.integration_connections SET next_sync_at = now() + interval '1 day' WHERE id = ${cb.id}::uuid`
    kaspiMode = 'ok'
    const res = await runDueSyncs({ limit: 5, deadlineMs: Date.now() + 30_000 }, deps)
    expect(res.outcomes.map((o) => o.connectionId)).toEqual([ca.id])
    expect(res.companiesWithNewFacts).toEqual([a.company])
  })
})
