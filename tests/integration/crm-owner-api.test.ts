// The production server runs in UTC (Railway): «today» must still start at Almaty midnight (L5).
process.env.TZ = 'UTC'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dbTestsEnabled } from '../helpers/db-env'
import { pgPostgrest } from '../helpers/pg-postgrest'
import { closeTestPool, inRollback, seedStaff, seedUser, type Db } from '../helpers/pg-rls'
import { drawerPatch, phoneFieldValue, seedFromQueueRow } from '@/lib/crm/client-form'

/**
 * The owner CRM routes against the disposable test DB with the caller's real RLS session (the
 * pattern of tests/integration/pulse-api.test.ts): GET /api/v1/crm/today (M1 queue rules, L5
 * Almaty day, M2 no invented numbers, M3 every client), GET /api/v1/crm/clients (M3 pagination),
 * POST /api/v1/crm/clients/import (M4 merge) and the drawer save (L6). Everything is seeded inside
 * a rolled-back transaction.
 */
const h = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => h.client }))

const today = await import('../../app/api/v1/crm/today/route')
const clients = await import('../../app/api/v1/crm/clients/route')
const importRoute = await import('../../app/api/v1/crm/clients/import/route')
const clientRoute = await import('../../app/api/v1/crm/clients/[id]/route')

// 2026-11-18 19:30 UTC = 2026-11-19 00:30 in Almaty (UTC+5).
const NOW = new Date('2026-11-18T19:30:00Z')

function session(db: Db, id: string) {
  h.client = Object.assign(pgPostgrest(db, id), {
    auth: { getUser: async () => ({ data: { user: { id, email: `${id}@test.local` } }, error: null }) },
  })
}

type Seed = {
  name: string; status?: string; phone?: string | null; phone_raw?: string | null; email?: string | null
  avg_check?: number | null; note?: string | null; next_contact_at?: string | null; last_contact_at?: string | null; created_at?: string
}
async function addClient(db: Db, userId: string, c: Seed): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.crm_clients (user_id, name, status, phone, phone_raw, email, avg_check, note, next_contact_at, last_contact_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, '2026-11-10T00:00:00Z'::timestamptz)) RETURNING id`,
    [userId, c.name, c.status ?? 'new', c.phone ?? null, c.phone_raw ?? null, c.email ?? null, c.avg_check ?? null,
      c.note ?? null, c.next_contact_at ?? null, c.last_contact_at ?? null, c.created_at ?? null],
  )
  return rows[0].id as string
}
async function addReminder(db: Db, userId: string, clientId: string, dueAt: string, status = 'open') {
  await db.query(
    `INSERT INTO public.crm_reminders (client_id, user_id, due_at, status) VALUES ($1, $2, $3, $4)`,
    [clientId, userId, dueAt, status],
  )
}

type Row = { id: string; queueBucket: number | null; avgCheck: number | null; daysSince: number | null } & Record<string, unknown>
type TodayPayload = {
  day: string
  stats: { totalClients: number; highRisk: number; revenueAtRisk: number | null; highRiskWithoutCheck: number; processedToday: number; queue: Record<string, number> }
  todayClients: Row[]
  riskClients: Row[]
}
async function getToday(): Promise<TodayPayload> {
  const res = await today.GET()
  expect(res.status).toBe(200)
  return (await res.json()) as TodayPayload
}

describe.skipIf(!dbTestsEnabled)('owner CRM api', () => {
  afterAll(closeTestPool)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it('/today without a session → 401', () =>
    inRollback(async (db) => {
      h.client = Object.assign(pgPostgrest(db, null), { auth: { getUser: async () => ({ data: { user: null }, error: null }) } })
      expect((await today.GET()).status).toBe(401)
    }))

  it('/today: the queue rules for the Almaty day — a handled client leaves, nothing invented, own rows only', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const other = await seedUser(db)
      // never contacted, active, no plan → «без плана»
      const never = await addClient(db, owner, { name: 'Никогда', status: 'new' })
      // contacted 00:10 Almaty today → handled: off the queue (it used to stay forever)
      const touched = await addClient(db, owner, { name: 'Сегодня звонили', status: 'in_progress', last_contact_at: '2026-11-18T19:10:00Z' })
      // contacted 23:00 Almaty yesterday, no plan → back in the queue today
      const yesterday = await addClient(db, owner, { name: 'Вчера звонили', status: 'in_progress', last_contact_at: '2026-11-18T18:00:00Z' })
      // a reminder due 15:00 Almaty today → «на сегодня»
      const remToday = await addClient(db, owner, { name: 'Напоминание сегодня', status: 'waiting' })
      await addReminder(db, owner, remToday, '2026-11-19T10:00:00Z')
      // a reminder due 23:00 Almaty yesterday (18:00 UTC, «today» on a UTC clock) → overdue
      const remLate = await addClient(db, owner, { name: 'Напоминание вчера', status: 'waiting' })
      await addReminder(db, owner, remLate, '2026-11-18T18:00:00Z')
      // a dismissed reminder is not a plan; the customer was contacted 2 days ago → not queued
      const dismissed = await addClient(db, owner, { name: 'Отменено', status: 'customer', last_contact_at: '2026-11-16T12:00:00Z' })
      await addReminder(db, owner, dismissed, '2026-11-17T12:00:00Z', 'dismissed')
      // lost, no check: high risk, not queued — and the money at risk is therefore unknown
      const lost = await addClient(db, owner, { name: 'Потерянный', status: 'lost' })
      // sleeping since creation (never touched) → «спящий», as the digest counts it
      const sleeping = await addClient(db, owner, { name: 'Спящий', status: 'sleeping', created_at: '2026-09-01T00:00:00Z' })
      // somebody else's client is never read
      await addClient(db, other, { name: 'Чужой', status: 'new' })

      session(db, owner)
      const p = await getToday()
      expect(p.day).toBe('2026-11-19')
      const buckets = Object.fromEntries(p.todayClients.map((c) => [c.id, c.queueBucket]))
      expect(buckets).toEqual({ [remLate]: 0, [remToday]: 1, [never]: 2, [yesterday]: 2, [sleeping]: 3 })
      expect(buckets).not.toHaveProperty(touched)
      expect(p.stats.processedToday).toBe(1)
      expect(p.stats.queue).toEqual({ overdue: 1, today: 1, noPlan: 2, sleeping: 1 })
      expect(p.stats.totalClients).toBe(8)

      // M2: unknown is unknown — no 0 ₸ check, no 999 days, no invented series
      const row = p.todayClients.find((c) => c.id === never) as Row
      expect(row.avgCheck).toBeNull()
      expect(row.daysSince).toBeNull()
      for (const k of ['history', 'orderCycle', 'volumeChange', 'churnProb', 'lastOrder']) expect(row).not.toHaveProperty(k)
      expect(p.stats).toMatchObject({ revenueAtRisk: null, highRiskWithoutCheck: expect.any(Number) })
      expect(p.riskClients.map((c) => c.id)).toContain(lost)
    }))

  it('/today and /clients see every client of a base over 1000 rows (they stopped at 500)', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      await db.query(
        `INSERT INTO public.crm_clients (user_id, name, status, last_contact_at, created_at)
         SELECT $1, 'Клиент ' || g, 'customer', '2026-11-17T10:00:00Z', '2026-11-01T00:00:00Z' FROM generate_series(1, 1205) g`,
        [owner],
      )
      const lead = await addClient(db, owner, { name: 'Новый лид', status: 'new' })
      session(db, owner)

      const p = await getToday()
      expect(p.stats.totalClients).toBe(1206)
      expect(p.todayClients.map((c) => c.id)).toEqual([lead])

      const page = async (qs: string) => {
        const res = await clients.GET(new NextRequest(`http://localhost/api/v1/crm/clients${qs}`))
        expect(res.status).toBe(200)
        return ((await res.json()) as { data: { clients: Array<{ id: string }>; total: number; nextCursor: string | null } }).data
      }
      const first = await page('?limit=1000')
      expect(first.clients).toHaveLength(1000)
      expect(first.total).toBe(1206)
      expect(first.nextCursor).toBe(first.clients[999].id)
      const second = await page(`?limit=1000&after=${first.nextCursor}`)
      expect(second.clients).toHaveLength(206)
      expect(second.nextCursor).toBeNull()
      const ids = new Set([...first.clients, ...second.clients].map((c) => c.id))
      expect(ids.size).toBe(1206)
      expect(ids.has(lead)).toBe(true)
      // a filter is counted too, and bad paging input is refused
      expect((await page('?status=new')).total).toBe(1)
      expect((await clients.GET(new NextRequest('http://localhost/api/v1/crm/clients?limit=5000'))).status).toBe(400)
      expect((await clients.GET(new NextRequest('http://localhost/api/v1/crm/clients?after=x'))).status).toBe(400)
    }))

  it('a staff session reads only its own base (RLS would let it read every owner\'s)', () =>
    inRollback(async (db) => {
      const admin = await seedStaff(db, 'super_admin')
      const owner = await seedUser(db)
      await addClient(db, owner, { name: 'Клиент владельца', status: 'new' })
      session(db, admin)
      const p = await getToday()
      expect(p.stats.totalClients).toBe(0)
      const res = await clients.GET(new NextRequest('http://localhost/api/v1/crm/clients'))
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    }))

  it('import: a re-import neither duplicates clients nor wipes their data (M4)', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const ivan = await addClient(db, owner, { name: 'Иван', phone: '+77010000001', phone_raw: '+7 701 000 00 01', email: 'ivan@ex.kz', note: 'VIP', avg_check: 150000 })
      await addClient(db, owner, { name: 'Анна', email: 'anna@ex.kz', note: 'заметка' })
      await addClient(db, owner, { name: 'Пётр' })
      session(db, owner)

      const csv = [
        'Имя,Телефон,Email,Комментарий,Сумма',
        'Иван,8 701 000 00 01,,,', // phone match; empty cells must not wipe email/note/check
        'Анна,,ANNA@ex.kz,,', // no phone: matched by e-mail, case-insensitively
        'Пётр,,,,', // no phone, no e-mail: the identical anonymous client
        'Новый,,new@ex.kz,,',
        'Новый,,new@ex.kz,звонить после 18,', // repeat inside the file
      ].join('\n')
      const post = async () => {
        const fd = new FormData()
        fd.append('file', new File([csv], 'clients.csv', { type: 'text/csv' }))
        const res = await importRoute.POST(new NextRequest('http://localhost/api/v1/crm/clients/import', { method: 'POST', body: fd }))
        expect(res.status).toBe(200)
        return ((await res.json()) as { data: Record<string, number> }).data
      }

      expect(await post()).toEqual({ inserted: 1, updated: 1, unchanged: 2, duplicates: 1, skipped: 0 })
      expect(await post()).toEqual({ inserted: 0, updated: 0, unchanged: 4, duplicates: 1, skipped: 0 })

      const { rows } = await db.query(
        `SELECT name, phone, phone_raw, email, note, avg_check::float8 AS avg_check FROM public.crm_clients WHERE user_id = $1 ORDER BY name`,
        [owner],
      )
      expect(rows.map((r) => r.name)).toEqual(['Анна', 'Иван', 'Новый', 'Пётр'])
      expect(rows.find((r) => r.name === 'Иван')).toEqual({
        name: 'Иван', phone: '+77010000001', phone_raw: '8 701 000 00 01', email: 'ivan@ex.kz', note: 'VIP', avg_check: 150000,
      })
      expect(rows.find((r) => r.name === 'Анна')).toMatchObject({ email: 'anna@ex.kz', note: 'заметка' })
      expect(rows.find((r) => r.name === 'Новый')).toMatchObject({ email: 'new@ex.kz', note: 'звонить после 18' })
      expect(ivan).toBeTruthy()
    }))

  it('the drawer opened from a queue / card row saves without wiping a phone that did not normalise (L6)', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const id = await addClient(db, owner, { name: 'Иван', phone: null, phone_raw: '12-34 доб. 5', status: 'new' })
      session(db, owner)
      const row = (await getToday()).todayClients.find((c) => c.id === id) as unknown as Parameters<typeof seedFromQueueRow>[0]
      const seed = seedFromQueueRow(row)
      const patch = drawerPatch(seed, {
        name: 'Иван Петров', phone: phoneFieldValue(seed), email: '', status: 'in_progress', avgCheck: null, nextContactAt: null, note: '',
      })
      const res = await clientRoute.PATCH(
        new NextRequest(`http://localhost/api/v1/crm/clients/${id}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { 'content-type': 'application/json' } }),
        { params: { id } },
      )
      expect(res.status).toBe(200)
      const { rows } = await db.query(`SELECT name, phone, phone_raw FROM public.crm_clients WHERE id = $1`, [id])
      expect(rows[0]).toEqual({ name: 'Иван Петров', phone: null, phone_raw: '12-34 доб. 5' })
    }))
})
