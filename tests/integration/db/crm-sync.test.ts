/**
 * CRM revival (2026-11-18) — the CRM sync on the real schema of the disposable test DB, with fake
 * Bitrix24 / amoCRM APIs (tests/helpers/fake-crm.ts). The app code runs unchanged through the
 * PostgREST-shaped client (tests/helpers/pg-postgrest.ts): as the owner (real RLS) for the button,
 * as the service role for the cron. Every case in a transaction that is rolled back.
 *
 *   H1/M5  the same CRM synced twice adds no client; a deal never becomes a client;
 *   link   a manual client with the contact's phone is linked, its fields never overwritten;
 *   H2/H3  every page is read (Bitrix24 50, amoCRM ≤ 250), the cap is reported «N из M / есть ещё»;
 *   M9     out of time → status «partial» with the reason, the next run finishes the job;
 *   M7     the stored status is success / partial / error (never 'ok');
 *   keep   clients that left the CRM are kept and counted;
 *   cron   only due connections, ≤ 2 at once, one failure does not stop the others, the run is in
 *          ops_job_runs (through the real scheduler, lib/cron/runner.ts).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dbTestsEnabled } from '../../helpers/db-env'
import { pgPostgrest, type PgPostgrest } from '../../helpers/pg-postgrest'
import { closeTestPool, inRollback, seedUser, type Db } from '../../helpers/pg-rls'
import { amoContact, amoLead, bxContact, bxDeal, fakeAmo, fakeBitrix, publicDns } from '../../helpers/fake-crm'

const s = vi.hoisted(() => ({ service: null as unknown, user: null as unknown, events: [] as Array<Record<string, unknown>> }))

// The SSRF guard resolves the CRM host: a public address, without the network.
vi.mock('node:dns/promises', () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
  return { lookup, default: { lookup } }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.service }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => s.user }))
vi.mock('@/lib/tenancy', () => ({ resolveTenant: async () => null }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: (e: Record<string, unknown>) => { s.events.push(e) } }))

const { syncCrmConnection } = await import('@/lib/crm/sync')
const { POST: syncRoute } = await import('@/app/api/v1/crm/connections/[id]/sync/route')
const { GET: cronRoute } = await import('@/app/api/cron/crm-sync/route')
const { startCronRunner } = await import('@/lib/cron/runner')
const { waitForBackgroundWork } = await import('@/lib/background')
const { recordJobRun } = await import('@/lib/ops/job-journal')

const B24_SRC = 'bitrix24:acme.bitrix24.kz'
const WEBHOOK = 'https://acme.bitrix24.kz/rest/1/abc123/'
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from)
const soon = () => Date.now() + 45_000

interface Conn { id: string; user_id: string; provider: 'bitrix24' | 'amocrm'; base_url: string; access_token: string }

async function seedConnection(db: Db, userId: string, provider: 'bitrix24' | 'amocrm', over: { lastSyncAt?: string | null; status?: string | null; active?: boolean; token?: string } = {}): Promise<Conn> {
  const base = provider === 'bitrix24' ? 'acme.bitrix24.kz' : 'acme.amocrm.ru'
  const token = over.token ?? (provider === 'bitrix24' ? WEBHOOK : 'long-lived-token')
  const { rows } = await db.query(
    `INSERT INTO public.crm_provider_connections (user_id, provider, base_url, access_token, is_active, last_sync_at, last_sync_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, provider, base, token, over.active ?? true, over.lastSyncAt ?? null, over.status ?? null],
  )
  return { id: rows[0].id as string, user_id: userId, provider, base_url: base, access_token: token }
}

const clients = async (db: Db, userId: string) =>
  (await db.query(`SELECT * FROM public.crm_clients WHERE user_id = $1 ORDER BY external_id::int NULLS FIRST, created_at`, [userId])).rows as Array<Record<string, unknown>>
const connRow = async (db: Db, id: string) => (await db.query(`SELECT * FROM public.crm_provider_connections WHERE id = $1`, [id])).rows[0] as Record<string, unknown>

/** The owner's own client (RLS), with the auth call the routes make. */
function ownerClient(db: Db, userId: string): PgPostgrest {
  return Object.assign(pgPostgrest(db, userId), { auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) } })
}

beforeEach(() => {
  s.events.length = 0
  s.service = null
  s.user = null
})
afterEach(() => vi.unstubAllGlobals())

describe.skipIf(!dbTestsEnabled)('CRM sync on the real schema', () => {
  afterAll(closeTestPool)

  it('H1/M5 + H2: Bitrix24 synced twice — 120 contacts over 3 pages, no duplicate, deals never become clients, status success', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      const crm = fakeBitrix({
        // 118 with a phone, 2 without one (the old sync could only match by phone, so these came back every run).
        contacts: [...range(118).map((i) => bxContact(i)), ...range(2, 119).map((i) => bxContact(i, { PHONE: [] }))],
        deals: [...range(30).map((i) => bxDeal(i, i, '100000.00')), ...range(10, 500).map((i) => bxDeal(i, null, '777000.00'))],
      })
      vi.stubGlobal('fetch', crm.fetchImpl)
      const sb = ownerClient(db, owner)

      const first = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })
      expect(first).toMatchObject({ status: 'success', inserted: 120, updated: 0, linked: 0, dealsWithoutContact: 10, problems: [] })
      expect(first.contacts).toEqual({ loaded: 120, total: 120, complete: true })
      expect(first.message).toMatch(/Сделок без контакта: 10 — клиентами не стали/)
      expect(crm.calls.filter((c) => c.url.endsWith('crm.contact.list.json')).map((c) => c.body?.start)).toEqual([0, 50, 100])

      const second = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })
      expect(second).toMatchObject({ status: 'success', inserted: 0, updated: 0, unchanged: 120 })

      const rows = await clients(db, owner)
      expect(rows).toHaveLength(120)
      expect(new Set(rows.map((r) => r.external_id)).size).toBe(120)
      expect(rows.every((r) => r.external_source === B24_SRC && r.source === 'bitrix24')).toBe(true)
      expect(rows.some((r) => String(r.name).startsWith('Сделка'))).toBe(false)
      expect(Number(rows.find((r) => r.external_id === '1')!.avg_check)).toBe(100000)
      expect(rows.find((r) => r.external_id === '50')!.avg_check).toBeNull()

      const c = await connRow(db, conn.id)
      expect(c).toMatchObject({ last_sync_status: 'success', last_sync_error: null, synced_contacts: 120, synced_deals: 40 })
    }))

  it('first sync links a manual client by its phone and never overwrites what the owner typed', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      const { rows: [manual] } = await db.query(
        `INSERT INTO public.crm_clients (user_id, name, phone, phone_raw, email, status, source, avg_check, note)
         VALUES ($1, 'Иван (VIP)', '+77010000007', '8 701 000 00 07', NULL, 'customer', 'manual', 50000, 'звонить после 18:00') RETURNING id`,
        [owner],
      )
      const { rows: [csv] } = await db.query(
        `INSERT INTO public.crm_clients (user_id, name, phone, source) VALUES ($1, 'Без имени', '+77010000008', 'csv') RETURNING id`,
        [owner],
      )
      const crm = fakeBitrix({ contacts: [bxContact(7), bxContact(8), bxContact(9)], deals: [bxDeal(1, 7, '100000'), bxDeal(2, 7, '200000')] })
      vi.stubGlobal('fetch', crm.fetchImpl)
      const sb = ownerClient(db, owner)

      const report = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })
      expect(report).toMatchObject({ status: 'success', linked: 2, inserted: 1 })
      const rows = await clients(db, owner)
      expect(rows).toHaveLength(3)
      const linkedManual = rows.find((r) => r.id === manual.id)!
      expect(linkedManual).toMatchObject({
        name: 'Иван (VIP)', phone: '+77010000007', phone_raw: '8 701 000 00 07', note: 'звонить после 18:00', status: 'customer',
        source: 'manual', email: 'c7@example.kz', external_source: B24_SRC, external_id: '7',
      })
      expect(Number(linkedManual.avg_check)).toBe(50000)
      expect(rows.find((r) => r.id === csv.id)).toMatchObject({ name: 'Клиент8 Тестов', external_id: '8', source: 'csv' })

      const again = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })
      expect(again).toMatchObject({ status: 'success', linked: 0, inserted: 0, updated: 0, unchanged: 3 })
      expect(await clients(db, owner)).toHaveLength(3)
    }))

  it('H2 cap: «загружено N из M» is the status partial with its reason, replacing the previous status', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24', { lastSyncAt: new Date(Date.now() - 86_400_000).toISOString(), status: 'success' })
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(120).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      const report = await syncCrmConnection(ownerClient(db, owner), conn, { deadlineAt: soon(), resolve: publicDns, maxRecords: 100 })
      expect(report.status).toBe('partial')
      expect(report.problems[0]).toBe('Контакты загружены не все: 100 из 120 — предел 100 за одну синхронизацию.')
      expect(report.missingInCrm).toBeNull()
      expect(await clients(db, owner)).toHaveLength(100)
      const c = await connRow(db, conn.id)
      expect(c.last_sync_status).toBe('partial')
      expect(c.last_sync_error).toMatch(/100 из 120/)
    }))

  it('M9: out of time — nothing is half done, the status says partial and why, the next run writes the rest', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24', { status: 'success' })
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(60).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      const sb = ownerClient(db, owner)
      const short = await syncCrmConnection(sb, conn, { deadlineAt: Date.now() + 3_000, resolve: publicDns })
      expect(short).toMatchObject({ status: 'partial', notWritten: 60, inserted: 0 })
      expect(short.problems).toContain('Не успели записать клиентов: 60 — запишет следующая синхронизация.')
      expect((await connRow(db, conn.id)).last_sync_status).toBe('partial')

      const full = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })
      expect(full).toMatchObject({ status: 'success', inserted: 60 })
      expect((await connRow(db, conn.id)).last_sync_status).toBe('success')
    }))

  it('clients the CRM no longer has stay in the portal and are counted; duplicate phones merge into one client', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      const sb = ownerClient(db, owner)
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(5).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })

      const dup = bxContact(6, { PHONE: [{ ID: '1', VALUE_TYPE: 'WORK', VALUE: '8 701 000 00 01', TYPE_ID: 'PHONE' }] })
      vi.stubGlobal('fetch', fakeBitrix({ contacts: [...range(3).map((i) => bxContact(i)), dup], deals: [bxDeal(1, 1, '100'), bxDeal(2, 6, '300')] }).fetchImpl)
      const report = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })
      expect(report).toMatchObject({ status: 'success', missingInCrm: 2, mergedByPhone: 1, inserted: 0 })
      expect(report.message).toMatch(/Нет больше в CRM: 2 — в портале клиенты оставлены/)
      const rows = await clients(db, owner)
      expect(rows).toHaveLength(5)
      expect(Number(rows.find((r) => r.external_id === '1')!.avg_check)).toBe(200)
    }))

  it('H3: amoCRM over two pages of ≤ 250; amounts in another currency never become avg_check; the cap says «есть ещё»', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'amocrm')
      const crm = fakeAmo({ contacts: range(260).map((i) => amoContact(i)), leads: range(5).map((i) => amoLead(i, [1], 1000)), currency: 'RUB' })
      vi.stubGlobal('fetch', crm.fetchImpl)
      const sb = ownerClient(db, owner)
      const report = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns })
      expect(report).toMatchObject({ status: 'success', inserted: 260, dealsOtherCurrency: 5 })
      expect(report.message).toMatch(/Сделок не в тенге: 5/)
      expect(crm.calls.every((c) => Number(new URL(c.url).searchParams.get('limit') ?? 0) <= 250)).toBe(true)
      const rows = await clients(db, owner)
      expect(rows).toHaveLength(260)
      expect(rows.find((r) => r.external_id === '1')).toMatchObject({ external_source: 'amocrm:acme.amocrm.ru', avg_check: null, phone: '+77020000001' })

      const capped = await syncCrmConnection(sb, conn, { deadlineAt: soon(), resolve: publicDns, maxRecords: 250 })
      expect(capped.status).toBe('partial')
      expect(capped.problems[0]).toBe('Контакты загружены не все: 250, есть ещё — предел 250 за одну синхронизацию.')
      expect(await clients(db, owner)).toHaveLength(260)
    }))

  it('the button: the owner syncs over RLS (200); another user gets 404; a refused key is 502, status error and one alert', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const stranger = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(3).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      const call = () => syncRoute(new NextRequest(`http://portal.test/api/v1/crm/connections/${conn.id}/sync`, { method: 'POST' }), { params: { id: conn.id } })

      s.user = ownerClient(db, owner)
      const ok = await call()
      expect(ok.status).toBe(200)
      const body = await ok.json()
      expect(body).toMatchObject({ ok: true, data: { status: 'success', inserted: 3 } })
      expect(typeof body.data.message).toBe('string')
      expect(await clients(db, owner)).toHaveLength(3)

      s.user = ownerClient(db, stranger)
      expect((await call()).status).toBe(404)
      expect(await clients(db, stranger)).toHaveLength(0)

      s.user = ownerClient(db, owner)
      vi.stubGlobal('fetch', fakeBitrix({ contacts: [], deals: [], fail: () => new Response('{"error":"NO_AUTH_FOUND"}', { status: 401 }) }).fetchImpl)
      const refused = await call()
      expect(refused.status).toBe(502)
      expect((await refused.json()).error).toMatch(/отклонила доступ/)
      expect(await connRow(db, conn.id)).toMatchObject({ last_sync_status: 'error', synced_contacts: 3 })
      expect(s.events).toHaveLength(1)
      expect(s.events[0]).toMatchObject({ name: 'INTEGRATION_FAILED', subjectId: conn.id, dedupeKey: expect.stringMatching(new RegExp(`^integration_failed:${conn.id}:\\d{4}-\\d{2}-\\d{2}$`)) })
      expect(await clients(db, owner)).toHaveLength(3)
    }))

  describe('the automatic sync through the scheduler', () => {
    const RUNNER_GUARD = Symbol.for('aistart360.cron.runner')
    let savedSecret: string | undefined
    beforeEach(() => {
      savedSecret = process.env.CRON_SECRET
      process.env.CRON_SECRET = 'cron-test-secret'
    })
    afterEach(() => {
      delete (globalThis as Record<symbol, unknown>)[RUNNER_GUARD]
      if (savedSecret === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = savedSecret
    })

    it('at :17 it syncs only due connections, a refused one does not stop the other, and ops_job_runs records the run', () =>
      inRollback(async (db) => {
        const H = 3_600_000
        const a = await seedUser(db, { status: 'approved' })
        const b = await seedUser(db, { status: 'approved' })
        const c = await seedUser(db, { status: 'approved' })
        const d = await seedUser(db, { status: 'approved' })
        const due = await seedConnection(db, a, 'bitrix24') // never synced
        const refused = await seedConnection(db, b, 'amocrm', { lastSyncAt: new Date(Date.now() - 7 * H).toISOString(), status: 'success' })
        const freshAt = new Date(Date.now() - 1 * H).toISOString()
        const fresh = await seedConnection(db, c, 'bitrix24', { lastSyncAt: freshAt, status: 'success' })
        const inactive = await seedConnection(db, d, 'bitrix24', { active: false })
        s.service = pgPostgrest(db, null)

        const bitrix = fakeBitrix({ contacts: range(4).map((i) => bxContact(i)), deals: [] })
        const amo = fakeAmo({ contacts: [], leads: [], fail: () => new Response(JSON.stringify({ title: 'Unauthorized', status: 401 }), { status: 401 }) })
        vi.stubGlobal('fetch', (u: string, init?: RequestInit) => (new URL(u).hostname.endsWith('bitrix24.kz') ? bitrix.fetchImpl(u, init) : amo.fetchImpl(u, init)))

        let clock = new Date('2026-11-18T10:16:30Z')
        const ticks: Array<() => void> = []
        const runner = startCronRunner({
          baseUrl: 'http://portal.test',
          secret: 'cron-test-secret',
          startedAt: clock,
          now: () => clock,
          setTimer: ((fn: () => void) => { ticks.push(fn); return 0 }) as unknown as typeof setTimeout,
          fetchImpl: (async (url: string | URL, init?: RequestInit) => cronRoute(new NextRequest(String(url), init as ConstructorParameters<typeof NextRequest>[1]))) as typeof fetch,
          record: (outcome) => recordJobRun(outcome, { query: async (sql, params) => ({ rows: (await db.query(sql, params)).rows }), role: 'all', env: {} }),
          log: () => undefined,
        })
        clock = new Date('2026-11-18T10:17:00.500Z')
        ticks.shift()!()
        const settled = await waitForBackgroundWork(30_000)
        runner.stop()
        expect(settled.finished).toBe(true)

        expect(await connRow(db, due.id)).toMatchObject({ last_sync_status: 'success', synced_contacts: 4 })
        expect(await clients(db, a)).toHaveLength(4)
        const r = await connRow(db, refused.id)
        expect(r.last_sync_status).toBe('error')
        expect(r.last_sync_error).toMatch(/отклонила доступ/)
        const f = await connRow(db, fresh.id)
        expect(f.last_sync_status).toBe('success')
        expect(new Date(f.last_sync_at as string).toISOString()).toBe(freshAt)
        expect(await connRow(db, inactive.id)).toMatchObject({ last_sync_status: null, last_sync_at: null })
        expect(s.events.map((e) => e.subjectId)).toEqual([refused.id])

        const { rows: runs } = await db.query(
          `SELECT kind, status, http_status, scheduled_for FROM public.ops_job_runs WHERE job = '/api/cron/crm-sync' AND scheduled_for = $1`,
          ['2026-11-18T10:17:00Z'],
        )
        expect(runs).toEqual([{ kind: 'cron', status: 'ok', http_status: 200, scheduled_for: new Date('2026-11-18T10:17:00Z') }])
      }))
  })
})
