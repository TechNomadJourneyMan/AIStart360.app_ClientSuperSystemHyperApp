/**
 * CRM revival (waves 1 and 2) — the CRM sync on the real schema of the disposable test DB, with fake
 * Bitrix24 / amoCRM APIs (tests/helpers/fake-crm.ts). The app code runs unchanged through the
 * PostgREST-shaped client (tests/helpers/pg-postgrest.ts): as the owner (real RLS) for the button,
 * as the service role for the cron. Every case in a transaction that is rolled back.
 *
 *   H1/M5  the same CRM synced twice adds no client; a deal never becomes a client;
 *   link   a manual client with the contact's phone is linked, its fields never overwritten;
 *   M1     a linked client is never offered a phone another client holds — the run stays a success;
 *   M2     a CRM larger than the cap is caught up across runs from a stored cursor (both CRMs);
 *          avg_check is applied once every deal was read; «gone from the CRM» only after a pass;
 *   M3     two syncs of one connection: the second is «уже идёт» (button 409); rate limit; inactive;
 *   M4     an avg_check the owner typed (route or any other write) is never changed by the sync; a
 *          CRM figure without a qualifying deal any more is cleared;
 *   M5     a client whose contact was deleted / merged in the CRM is re-linked to the contact that
 *          now has its phone;
 *   M9     out of time → «partial» with the reason, the cursor does not move, the next run finishes;
 *   race   the update never re-inserts a deleted client, never overwrites a non-empty field;
 *   cron   only due connections, at most 2 syncs in flight (measured), one failure does not stop the
 *          others, the run is in ops_job_runs (through the real scheduler, lib/cron/runner.ts).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dbTestsEnabled } from '../../helpers/db-env'
import { pgPostgrest, type PgPostgrest } from '../../helpers/pg-postgrest'
import { asUser, closeTestPool, inRollback, seedUser, type Db } from '../../helpers/pg-rls'
import { amoContact, amoLead, bxContact, bxDeal, fakeAmo, fakeBitrix, publicDns } from '../../helpers/fake-crm'

const s = vi.hoisted(() => ({ service: null as unknown, user: null as unknown, limited: false, events: [] as Array<Record<string, unknown>> }))

// The SSRF guard resolves the CRM host: a public address, without the network.
vi.mock('node:dns/promises', () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
  return { lookup, default: { lookup } }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.service }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => s.user }))
vi.mock('@/lib/tenancy', () => ({ resolveTenant: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => s.limited }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: (e: Record<string, unknown>) => { s.events.push(e) } }))

const { syncCrmConnection } = await import('@/lib/crm/sync')
const { POST: syncRoute } = await import('@/app/api/v1/crm/connections/[id]/sync/route')
const { PATCH: patchClient } = await import('@/app/api/v1/crm/clients/[id]/route')
const { GET: cronRoute } = await import('@/app/api/cron/crm-sync/route')
const { startCronRunner } = await import('@/lib/cron/runner')
const { waitForBackgroundWork } = await import('@/lib/background')
const { recordJobRun } = await import('@/lib/ops/job-journal')

const B24_SRC = 'bitrix24:acme.bitrix24.kz'
const WEBHOOK = 'https://acme.bitrix24.kz/rest/1/abc123/'
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from)
const soon = () => Date.now() + 45_000
const run = (sb: PgPostgrest, conn: Conn, over: { maxRecords?: number; deadlineAt?: number } = {}) =>
  syncCrmConnection(sb, conn, { deadlineAt: over.deadlineAt ?? soon(), resolve: publicDns, maxRecords: over.maxRecords })

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

/** The user's clients; avg_check as a number (raw pg returns NUMERIC as text). */
const clients = async (db: Db, userId: string) =>
  ((await db.query(`SELECT * FROM public.crm_clients WHERE user_id = $1 ORDER BY external_id::int NULLS FIRST, created_at`, [userId])).rows as Array<Record<string, unknown>>)
    .map((r): Record<string, unknown> => ({ ...r, avg_check: r.avg_check === null ? null : Number(r.avg_check) }))
const byExt = (rows: Array<Record<string, unknown>>, ext: string) => rows.find((r) => r.external_id === ext)!
const connRow = async (db: Db, id: string) => (await db.query(`SELECT * FROM public.crm_provider_connections WHERE id = $1`, [id])).rows[0] as Record<string, unknown>

/** The owner's own client (RLS), with the auth call the routes make. */
function ownerClient(db: Db, userId: string): PgPostgrest {
  return Object.assign(pgPostgrest(db, userId), { auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) } })
}

beforeEach(() => {
  s.events.length = 0
  s.service = null
  s.user = null
  s.limited = false
})
afterEach(() => vi.unstubAllGlobals())

describe.skipIf(!dbTestsEnabled)('CRM sync on the real schema', () => {
  afterAll(closeTestPool)

  it('H1/M5 + H2: Bitrix24 synced twice — 120 contacts over 3 calls, no duplicate, deals never become clients, status success', () =>
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

      const first = await run(sb, conn)
      expect(first).toMatchObject({ status: 'success', inserted: 120, updated: 0, linked: 0, dealsWithoutContact: 10, avgUpdated: 30, problems: [] })
      expect(first.contacts).toEqual({ read: 120, passRead: 120, passTotal: 120, passComplete: true })
      expect(first.message).toMatch(/Сделок без контакта: 10 — клиентами не стали/)
      expect(crm.calls.filter((c) => c.url.endsWith('crm.contact.list.json')).map((c) => c.body?.filter)).toEqual([{}, { '>ID': '50' }, { '>ID': '100' }])

      const second = await run(sb, conn)
      expect(second).toMatchObject({ status: 'success', inserted: 0, updated: 0, unchanged: 120, missingInCrm: 0 })

      const rows = await clients(db, owner)
      expect(rows).toHaveLength(120)
      expect(new Set(rows.map((r) => r.external_id)).size).toBe(120)
      expect(rows.every((r) => r.external_source === B24_SRC && r.source === 'bitrix24')).toBe(true)
      expect(rows.some((r) => String(r.name).startsWith('Сделка'))).toBe(false)
      expect(byExt(rows, '1')).toMatchObject({ avg_check: 100000, avg_check_source: 'crm' })
      expect(byExt(rows, '50')).toMatchObject({ avg_check: null, avg_check_source: null })

      const c = await connRow(db, conn.id)
      expect(c).toMatchObject({ last_sync_status: 'success', last_sync_error: null, synced_contacts: 120, synced_deals: 40, sync_lease_until: null, sync_lease_token: null })
      expect(c.sync_cursor).toMatchObject({ source: B24_SRC, catching_up: false, contacts: { started_at: null, position: null }, deals: { started_at: null } })
    }))

  it('first sync links a manual client by its phone and never overwrites what the owner typed — avg_check included', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      const { rows: [manual] } = await db.query(
        `INSERT INTO public.crm_clients (user_id, name, phone, phone_raw, email, status, source, avg_check, note)
         VALUES ($1, 'Иван (VIP)', '+77010000007', '8 701 000 00 07', NULL, 'customer', 'manual', 50000, 'звонить после 18:00') RETURNING id, avg_check_source`,
        [owner],
      )
      expect(manual.avg_check_source).toBe('manual') // the trigger: a figure written without a source is the owner's
      const { rows: [csv] } = await db.query(
        `INSERT INTO public.crm_clients (user_id, name, phone, source) VALUES ($1, 'Без имени', '+77010000008', 'csv') RETURNING id`,
        [owner],
      )
      const crm = fakeBitrix({ contacts: [bxContact(7), bxContact(8), bxContact(9)], deals: [bxDeal(1, 7, '100000'), bxDeal(2, 7, '200000'), bxDeal(3, 8, '40000')] })
      vi.stubGlobal('fetch', crm.fetchImpl)
      const sb = ownerClient(db, owner)

      const report = await run(sb, conn)
      expect(report).toMatchObject({ status: 'success', linked: 2, inserted: 1 })
      const rows = await clients(db, owner)
      expect(rows).toHaveLength(3)
      expect(rows.find((r) => r.id === manual.id)).toMatchObject({
        name: 'Иван (VIP)', phone: '+77010000007', phone_raw: '8 701 000 00 07', note: 'звонить после 18:00', status: 'customer',
        source: 'manual', email: 'c7@example.kz', external_source: B24_SRC, external_id: '7', avg_check: 50000, avg_check_source: 'manual',
      })
      // An empty avg_check of a manual client is the CRM's to fill.
      expect(rows.find((r) => r.id === csv.id)).toMatchObject({ name: 'Клиент8 Тестов', external_id: '8', source: 'csv', avg_check: 40000, avg_check_source: 'crm' })

      const again = await run(sb, conn)
      expect(again).toMatchObject({ status: 'success', linked: 0, inserted: 0, updated: 0, unchanged: 3 })
      expect(await clients(db, owner)).toHaveLength(3)
    }))

  it('M4: an avg_check the owner sets (the PATCH route, or any other write) is never changed; a CRM figure with no qualifying deal left is cleared', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      const deals = [bxDeal(1, 1, '1000'), bxDeal(2, 2, '2000'), bxDeal(3, 3, '3000')]
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(3).map((i) => bxContact(i)), deals }).fetchImpl)
      const sb = ownerClient(db, owner)
      await run(sb, conn)
      let rows = await clients(db, owner)
      expect(rows.map((r) => [r.avg_check, r.avg_check_source])).toEqual([[1000, 'crm'], [2000, 'crm'], [3000, 'crm']])

      // The owner types a figure in the drawer (PATCH) for client 1, and another write (e.g. an import) for client 2.
      s.user = sb
      const res = await patchClient(new NextRequest(`http://portal.test/api/v1/crm/clients/${byExt(rows, '1').id}`, { method: 'PATCH', body: JSON.stringify({ avg_check: 77000 }) }), { params: { id: String(byExt(rows, '1').id) } })
      expect(res.status).toBe(200)
      await asUser(db, owner, () => db.query(`UPDATE public.crm_clients SET avg_check = 88000 WHERE id = $1`, [byExt(rows, '2').id]))

      // In the CRM every deal changes, and contact 3 loses its only one.
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(3).map((i) => bxContact(i)), deals: [bxDeal(1, 1, '9999'), bxDeal(2, 2, '9999'), bxDeal(3, 3, '9999', { STAGE_SEMANTIC_ID: 'F' })] }).fetchImpl)
      const second = await run(sb, conn)
      expect(second).toMatchObject({ status: 'success', avgUpdated: 0, avgCleared: 1 })
      rows = await clients(db, owner)
      expect(rows.map((r) => [r.avg_check, r.avg_check_source])).toEqual([[77000, 'manual'], [88000, 'manual'], [null, null]])

      // Confirming the CRM figure as their own (the same value) makes it the owner's too — only the route can tell.
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(3).map((i) => bxContact(i)), deals: [bxDeal(1, 1, '9999'), bxDeal(2, 2, '9999'), bxDeal(4, 3, '4000')] }).fetchImpl)
      await run(sb, conn)
      const third = byExt(await clients(db, owner), '3')
      expect(third).toMatchObject({ avg_check: 4000, avg_check_source: 'crm' })
      await patchClient(new NextRequest(`http://portal.test/api/v1/crm/clients/${third.id}`, { method: 'PATCH', body: JSON.stringify({ avg_check: 4000 }) }), { params: { id: String(third.id) } })
      expect(byExt(await clients(db, owner), '3')).toMatchObject({ avg_check: 4000, avg_check_source: 'manual' })

      // Clearing it in the drawer hands the field back to the CRM.
      await patchClient(new NextRequest(`http://portal.test/api/v1/crm/clients/${byExt(rows, '1').id}`, { method: 'PATCH', body: JSON.stringify({ avg_check: null }) }), { params: { id: String(byExt(rows, '1').id) } })
      await run(sb, conn)
      expect(byExt(await clients(db, owner), '1')).toMatchObject({ avg_check: 9999, avg_check_source: 'crm' })
    }))

  it('M1: a linked client without a phone whose contact now has a phone another client holds — no refusal, still a success, nothing overwritten', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      const sb = ownerClient(db, owner)
      vi.stubGlobal('fetch', fakeBitrix({ contacts: [bxContact(1, { PHONE: [] }), ...range(2, 2).map((i) => bxContact(i))], deals: [] }).fetchImpl)
      await run(sb, conn)
      const { rows: [holder] } = await db.query(`INSERT INTO public.crm_clients (user_id, name, phone, source) VALUES ($1, 'Держатель', '+77019999999', 'manual') RETURNING id`, [owner])

      vi.stubGlobal('fetch', fakeBitrix({ contacts: [bxContact(1, { PHONE: [{ ID: '1', VALUE_TYPE: 'WORK', VALUE: '+7 701 999 99 99', TYPE_ID: 'PHONE' }] }), ...range(2, 2).map((i) => bxContact(i))], deals: [] }).fetchImpl)
      const report = await run(sb, conn)
      expect(report).toMatchObject({ status: 'success', inserted: 0, notWritten: 0 })
      const rows = await clients(db, owner)
      expect(byExt(rows, '1')).toMatchObject({ phone: null, phone_raw: null })
      expect(rows.find((r) => r.id === holder.id)).toMatchObject({ phone: '+77019999999', external_id: null })
      expect(byExt(rows, '2')).toMatchObject({ phone: '+77010000002' })
    }))

  it('M2: a Bitrix24 larger than the cap is caught up across runs from the cursor; avg_check only once every deal was read', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(120).map((i) => bxContact(i)), deals: range(120).map((i) => bxDeal(i, i, String(1000 * i))) }).fetchImpl)
      const sb = ownerClient(db, owner)

      const r1 = await run(sb, conn, { maxRecords: 50 })
      expect(r1.status).toBe('partial')
      expect(r1.problems[0]).toBe('Контакты: прочитано 50 из 120 (за один раз читается до 50) — следующая синхронизация продолжит с этого места.')
      expect(r1.problems[1]).toMatch(/^Сделки: прочитано 50 из 120 .*средний чек обновится, когда будут прочитаны все сделки/)
      expect(r1.missingInCrm).toBeNull()
      let c = await connRow(db, conn.id)
      expect(c).toMatchObject({ last_sync_status: 'partial', synced_contacts: 50 })
      expect(c.sync_cursor).toMatchObject({ catching_up: true, contacts: { position: '50', read: 50 }, deals: { position: '50', read: 50 } })
      expect(c.last_sync_error).toMatch(/50 из 120/)
      expect(byExt(await clients(db, owner), '1').avg_check).toBeNull()

      const r2 = await run(sb, conn, { maxRecords: 50 })
      expect(r2.contacts).toEqual({ read: 50, passRead: 100, passTotal: 120, passComplete: false })
      const r3 = await run(sb, conn, { maxRecords: 50 })
      expect(r3).toMatchObject({ status: 'success', missingInCrm: 0, avgUpdated: 120 })
      expect(r3.contacts).toEqual({ read: 20, passRead: 120, passTotal: 120, passComplete: true })
      const rows = await clients(db, owner)
      expect(rows.map((r) => Number(r.external_id))).toEqual(range(120))
      expect(byExt(rows, '1').avg_check).toBe(1000)
      expect(byExt(rows, '120').avg_check).toBe(120000)
      c = await connRow(db, conn.id)
      expect(c).toMatchObject({ last_sync_status: 'success', synced_contacts: 120 })
      expect(c.sync_cursor).toMatchObject({ catching_up: false, contacts: { position: null, started_at: null } })

      // Wrap-around: the next run starts a new pass from the beginning and adds nothing.
      const r4 = await run(sb, conn, { maxRecords: 50 })
      expect(r4).toMatchObject({ status: 'partial', inserted: 0, unchanged: 50 })
      expect(await clients(db, owner)).toHaveLength(120)
    }))

  it('M2 + H3: amoCRM caught up page by page (250, ascending); clients keyed by the account id; the host-keyed clients move over', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'amocrm')
      const { rows: [legacy] } = await db.query(
        `INSERT INTO public.crm_clients (user_id, name, source, external_source, external_id) VALUES ($1, 'Старый ключ', 'amocrm', 'amocrm:acme.amocrm.ru', '1') RETURNING id`,
        [owner],
      )
      const crm = fakeAmo({ contacts: range(600).map((i) => amoContact(i)), leads: range(5).map((i) => amoLead(i, [1], 1000)), currency: 'RUB' })
      vi.stubGlobal('fetch', crm.fetchImpl)
      const sb = ownerClient(db, owner)

      const r1 = await run(sb, conn, { maxRecords: 250 })
      expect(r1.status).toBe('partial')
      expect(r1.problems[0]).toBe('Контакты: прочитано 250, есть ещё (за один раз читается до 250) — следующая синхронизация продолжит с этого места.')
      expect((await connRow(db, conn.id)).sync_cursor).toMatchObject({ source: 'amocrm:28805383', contacts: { position: '2' } })
      await run(sb, conn, { maxRecords: 250 })
      const r3 = await run(sb, conn, { maxRecords: 250 })
      expect(r3).toMatchObject({ status: 'success', dealsOtherCurrency: 5, missingInCrm: 0 })
      expect(crm.calls.filter((c) => c.url.includes('/contacts')).every((c) => new URL(c.url).searchParams.get('limit') === '250')).toBe(true)

      const rows = await clients(db, owner)
      expect(rows).toHaveLength(600)
      expect(new Set(rows.map((r) => r.external_source))).toEqual(new Set(['amocrm:28805383']))
      expect(byExt(rows, '1')).toMatchObject({ id: legacy.id, name: 'Старый ключ', avg_check: null })
    }))

  it('amoCRM: amounts in another currency never become avg_check and are counted', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'amocrm')
      vi.stubGlobal('fetch', fakeAmo({ contacts: range(3).map((i) => amoContact(i)), leads: range(5).map((i) => amoLead(i, [1], 1000)), currency: 'RUB' }).fetchImpl)
      const report = await run(ownerClient(db, owner), conn)
      expect(report).toMatchObject({ status: 'success', inserted: 3, dealsOtherCurrency: 5, avgUpdated: 0 })
      expect(report.message).toMatch(/Сделок не в тенге: 5/)
      expect(byExt(await clients(db, owner), '1')).toMatchObject({ avg_check: null, phone: '+77020000001' })
    }))

  it('M5 + keep: a client whose contact was merged away is re-linked to the contact that now has its phone; a deleted one is kept and counted', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      const sb = ownerClient(db, owner)
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(5).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      await run(sb, conn)
      const before = await clients(db, owner)

      // In the CRM: contact 4 merged into a new contact 9 (with 4's phone), contact 5 deleted.
      const survivor = bxContact(9, { PHONE: [{ ID: '1', VALUE_TYPE: 'WORK', VALUE: '+7 701 000 0004', TYPE_ID: 'PHONE' }] })
      vi.stubGlobal('fetch', fakeBitrix({ contacts: [...range(3).map((i) => bxContact(i)), survivor], deals: [bxDeal(1, 9, '5000')] }).fetchImpl)
      const report = await run(sb, conn)
      expect(report).toMatchObject({ status: 'success', relinked: 1, missingInCrm: 1, inserted: 0, phoneConflicts: 1 })
      expect(report.message).toMatch(/Перепривязано к записи CRM, у которой теперь их телефон: 1/)
      expect(report.message).toMatch(/Нет больше в CRM: 1 — в портале клиенты оставлены/)
      const rows = await clients(db, owner)
      expect(rows).toHaveLength(5)
      expect(rows.find((r) => r.id === byExt(before, '4').id)).toMatchObject({ external_id: '9', phone: '+77010000004', avg_check: 5000 })
      expect(byExt(rows, '5')).toMatchObject({ id: byExt(before, '5').id })

      // The next pass sees 9 as an ordinary linked contact.
      expect(await run(sb, conn)).toMatchObject({ status: 'success', relinked: 0, phoneConflicts: 0, missingInCrm: 1, inserted: 0 })
    }))

  it('M9: out of time — nothing is half done, the cursor does not move, the status says partial and why, the next run writes it', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24', { status: 'success' })
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(60).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      const sb = ownerClient(db, owner)
      const short = await run(sb, conn, { deadlineAt: Date.now() + 3_000 })
      expect(short).toMatchObject({ status: 'partial', notWritten: 60, inserted: 0 })
      expect(short.problems).toContain('Не успели записать клиентов: 60 — следующая синхронизация повторит эту часть.')
      const c = await connRow(db, conn.id)
      expect(c.last_sync_status).toBe('partial')
      expect(c.sync_cursor).toMatchObject({ catching_up: true, contacts: { position: null, read: 0 } })

      const full = await run(sb, conn)
      expect(full).toMatchObject({ status: 'success', inserted: 60 })
      expect((await connRow(db, conn.id)).last_sync_status).toBe('success')
    }))

  it('race: the update fills only fields empty at write time and never re-inserts a client deleted meanwhile', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const { rows: [kept] } = await db.query(
        `INSERT INTO public.crm_clients (user_id, name, email, source, external_source, external_id) VALUES ($1, 'Имя владельца', NULL, 'bitrix24', $2, '1') RETURNING id`,
        [owner, B24_SRC],
      )
      const { rows: [gone] } = await db.query(
        `INSERT INTO public.crm_clients (user_id, name, source, external_source, external_id) VALUES ($1, 'Удалят', 'bitrix24', $2, '2') RETURNING id`,
        [owner, B24_SRC],
      )
      await db.query(`DELETE FROM public.crm_clients WHERE id = $1`, [gone.id])
      const sb = ownerClient(db, owner)
      const { data, error } = await sb.rpc('crm_sync_update_clients', {
        p_user: owner, p_source: B24_SRC, p_seen_at: new Date().toISOString(),
        p_rows: [
          { id: kept.id, external_id: '1', name: 'Имя из CRM', phone: null, phone_raw: null, email: 'crm@x.kz', link: false },
          { id: gone.id, external_id: '2', name: 'Из CRM', phone: null, phone_raw: null, email: null, link: false },
        ],
      })
      expect(error).toBeNull()
      expect(data).toEqual([{ id: kept.id, changed: true }])
      const rows = await clients(db, owner)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ name: 'Имя владельца', email: 'crm@x.kz' })
    }))

  it('M3: two syncs of one connection at once — one runs, the other is «уже идёт»; nothing doubles; an expired lease is taken over', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(10).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      const sb = ownerClient(db, owner)
      const [a, b] = await Promise.all([run(sb, conn), run(sb, conn)])
      expect([a.status, b.status].sort()).toEqual(['busy', 'success'])
      expect([a, b].find((r) => r.status === 'busy')!.message).toMatch(/уже идёт/)
      expect(await clients(db, owner)).toHaveLength(10)
      expect((await connRow(db, conn.id)).sync_lease_until).toBeNull()

      await db.query(`UPDATE public.crm_provider_connections SET sync_lease_until = now() - interval '1 second', sync_lease_token = gen_random_uuid() WHERE id = $1`, [conn.id])
      expect((await run(sb, conn)).status).toBe('success')
    }))

  it('the button: the owner syncs over RLS (200); 404 for another user; 409 while a sync runs or when inactive; 429 over the limit; a refused key is 502 + one alert', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const stranger = await seedUser(db, { status: 'approved' })
      const conn = await seedConnection(db, owner, 'bitrix24')
      vi.stubGlobal('fetch', fakeBitrix({ contacts: range(3).map((i) => bxContact(i)), deals: [] }).fetchImpl)
      const call = (id = conn.id) => syncRoute(new NextRequest(`http://portal.test/api/v1/crm/connections/${id}/sync`, { method: 'POST' }), { params: { id } })

      s.user = ownerClient(db, owner)
      const ok = await call()
      expect(ok.status).toBe(200)
      const body = await ok.json()
      expect(body).toMatchObject({ ok: true, data: { status: 'success', inserted: 3 } })
      expect(await clients(db, owner)).toHaveLength(3)

      s.user = ownerClient(db, stranger)
      expect((await call()).status).toBe(404)
      expect(await clients(db, stranger)).toHaveLength(0)

      s.user = ownerClient(db, owner)
      await db.query(`UPDATE public.crm_provider_connections SET sync_lease_until = now() + interval '1 minute', sync_lease_token = gen_random_uuid() WHERE id = $1`, [conn.id])
      const busy = await call()
      expect(busy.status).toBe(409)
      expect(await busy.json()).toMatchObject({ ok: false, code: 'sync_in_progress', error: expect.stringMatching(/уже идёт/) })
      await db.query(`UPDATE public.crm_provider_connections SET sync_lease_until = NULL, sync_lease_token = NULL WHERE id = $1`, [conn.id])

      s.limited = true
      expect((await call()).status).toBe(429)
      s.limited = false

      await db.query(`UPDATE public.crm_provider_connections SET is_active = false WHERE id = $1`, [conn.id])
      expect((await call()).status).toBe(409)
      await db.query(`UPDATE public.crm_provider_connections SET is_active = true WHERE id = $1`, [conn.id])

      vi.stubGlobal('fetch', fakeBitrix({ contacts: [], deals: [], fail: () => new Response('{"error":"NO_AUTH_FOUND"}', { status: 401 }) }).fetchImpl)
      const refused = await call()
      expect(refused.status).toBe(502)
      expect((await refused.json()).error).toMatch(/отклонила доступ/)
      expect(await connRow(db, conn.id)).toMatchObject({ last_sync_status: 'error', synced_contacts: 3, sync_lease_token: null })
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

    it('at :17: only due connections, at most 2 syncs in flight (measured), a refused one does not stop the others, ops_job_runs records the run', () =>
      inRollback(async (db) => {
        const H = 3_600_000
        const users = await Promise.all(range(7).map(() => seedUser(db, { status: 'approved' })))
        // Four due Bitrix24 connections, each with its own webhook key (to see which syncs are in flight).
        const due = await Promise.all(range(4).map((i) => seedConnection(db, users[i - 1], 'bitrix24', { token: `https://acme.bitrix24.kz/rest/1/key${i}/` })))
        const refused = await seedConnection(db, users[4], 'amocrm', { lastSyncAt: new Date(Date.now() - 7 * H).toISOString(), status: 'success' })
        const freshAt = new Date(Date.now() - 1 * H).toISOString()
        const fresh = await seedConnection(db, users[5], 'bitrix24', { lastSyncAt: freshAt, status: 'success', token: 'https://acme.bitrix24.kz/rest/1/keyf/' })
        const inactive = await seedConnection(db, users[6], 'bitrix24', { active: false, token: 'https://acme.bitrix24.kz/rest/1/keyi/' })
        s.service = pgPostgrest(db, null)

        const inFlight = new Map<string, number>()
        let peak = 0
        const track = async (u: string) => {
          const key = /\/rest\/1\/(\w+)\//.exec(u)?.[1] ?? new URL(u).hostname
          inFlight.set(key, (inFlight.get(key) ?? 0) + 1)
          peak = Math.max(peak, inFlight.size)
          await new Promise((r) => setTimeout(r, 25))
          const n = (inFlight.get(key) ?? 1) - 1
          if (n === 0) inFlight.delete(key)
          else inFlight.set(key, n)
        }
        const bitrix = fakeBitrix({ contacts: range(4).map((i) => bxContact(i)), deals: [], hook: track })
        const amo = fakeAmo({ contacts: [], leads: [], hook: track, fail: () => new Response(JSON.stringify({ title: 'Unauthorized', status: 401 }), { status: 401 }) })
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

        expect(peak).toBe(2) // in parallel, but never more than two
        for (const [i, c] of due.entries()) {
          expect(await connRow(db, c.id)).toMatchObject({ last_sync_status: 'success', synced_contacts: 4 })
          expect(await clients(db, users[i])).toHaveLength(4)
        }
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
