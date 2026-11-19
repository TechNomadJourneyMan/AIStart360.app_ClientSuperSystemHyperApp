// The production server runs in UTC (Railway): «today» must still start at Almaty midnight (L5).
process.env.TZ = 'UTC'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dbTestsEnabled } from '../helpers/db-env'
import { pgPostgrest } from '../helpers/pg-postgrest'
import { closeTestPool, inRollback, seedStaff, seedUser, type Db } from '../helpers/pg-rls'
import {
  baselineAfterSave, drawerPatch, phoneFieldValue, seedFromClientRow, seedFromQueueRow, type ClientRowLike,
} from '@/lib/crm/client-form'

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
const interactions = await import('../../app/api/v1/crm/clients/[id]/interactions/route')
const remindersRoute = await import('../../app/api/v1/crm/reminders/[id]/route')

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
/**
 * The owner's session, with the writes `op` of `table` failing — only those whose query also calls
 * `onlyWith` (e.g. 'lt': closing the plans, not the reminder's own update) when it is given.
 */
function failingSession(db: Db, owner: string, table: string, op: 'update' | 'insert', onlyWith?: string) {
  session(db, owner)
  const real = h.client as { from: (t: string) => Record<string, unknown> }
  h.client = {
    ...real,
    from: (t: string) => {
      const q = real.from(t)
      if (t !== table) return q
      const called = new Set<string>()
      const failing = () => called.has(op) && (!onlyWith || called.has(onlyWith))
      const proxy: Record<string, unknown> = new Proxy(q, {
        get(target, prop) {
          if (prop === 'then' && failing()) {
            return (ok: (r: unknown) => unknown, err: (e: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' } }).then(ok, err)
          }
          const v = Reflect.get(target, prop)
          if (typeof v !== 'function') return v
          return (...args: unknown[]) => {
            called.add(String(prop))
            const r = (v as (...a: unknown[]) => unknown).apply(target, args)
            return r === target ? proxy : r
          }
        },
      })
      return proxy
    },
  }
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
      // a short page is not the end (max-rows may be below the limit): the end is an empty page
      expect(second.nextCursor).toBe(second.clients[205].id)
      expect(await page(`?limit=1000&after=${second.nextCursor}`)).toMatchObject({ clients: [], nextCursor: null, total: 1206 })
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

  it('import only adds: no duplicates, no overwritten values, no merge of different people (M4, review H1/M2)', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      await addClient(db, owner, { name: 'Иван', phone: '+77010000001', phone_raw: '+7 701 000 00 01', email: 'ivan@ex.kz', note: 'VIP', avg_check: 150000 })
      await addClient(db, owner, { name: 'Анна', email: 'anna@ex.kz', note: 'заметка' })
      await addClient(db, owner, { name: 'Пётр', phone: '+77010000003' })
      await addClient(db, owner, { name: 'Ольга', phone: '+77010000004' })
      await addClient(db, owner, { name: 'Ольга', email: 'olga@ex.kz' })
      session(db, owner)

      const csv = [
        'Имя,Телефон,Email,Комментарий,Сумма',
        'Иван,8 701 000 00 01,,старая заметка,1000', // same phone + name: the owner's note / check stay
        'Анна,,ANNA@ex.kz,,', // same e-mail (any case) + name
        'Пётр,,,,700', // no phone, no e-mail: the ONE «Пётр» (whatever his phone) — his empty check is filled
        'Ольга,,,,', // two «Ольга» in the base: neither merged nor created — skipped
        'Анна Смирнова,,anna@ex.kz,,9000', // a shared mailbox under another name: a new client
        'Самозванец,+7 701 000 00 01,,,500', // Иван's phone under another name: not imported
        'Борис,,-,,', // «-» is no e-mail…
        'Вера,,-,,', // …so Борис and Вера stay two people
        'Новый,,new@ex.kz,,',
        'Новый,,new@ex.kz,звонить после 18,', // repeat inside the file: fills the empty note
      ].join('\n')
      const post = async () => {
        const fd = new FormData()
        fd.append('file', new File([csv], 'clients.csv', { type: 'text/csv' }))
        const res = await importRoute.POST(new NextRequest('http://localhost/api/v1/crm/clients/import', { method: 'POST', body: fd }))
        expect(res.status).toBe(200)
        return ((await res.json()) as { data: Record<string, number> }).data
      }

      expect(await post()).toEqual({ inserted: 4, updated: 1, unchanged: 2, duplicates: 1, conflicts: 1, ambiguous: 1, skipped: 1 })
      expect(await post()).toEqual({ inserted: 0, updated: 0, unchanged: 7, duplicates: 1, conflicts: 1, ambiguous: 1, skipped: 1 })

      const { rows } = await db.query(
        `SELECT name, phone, phone_raw, email, note, avg_check::float8 AS avg_check FROM public.crm_clients WHERE user_id = $1 ORDER BY name`,
        [owner],
      )
      expect(rows.map((r) => r.name as string).sort((a, b) => a.localeCompare(b, 'ru'))).toEqual(['Анна', 'Анна Смирнова', 'Борис', 'Вера', 'Иван', 'Новый', 'Ольга', 'Ольга', 'Пётр'])
      expect(rows.find((r) => r.name === 'Пётр')).toMatchObject({ phone: '+77010000003', avg_check: 700 })
      expect(rows.find((r) => r.name === 'Иван')).toEqual({
        name: 'Иван', phone: '+77010000001', phone_raw: '+7 701 000 00 01', email: 'ivan@ex.kz', note: 'VIP', avg_check: 150000,
      })
      expect(rows.find((r) => r.name === 'Анна')).toEqual({ name: 'Анна', phone: null, phone_raw: null, email: 'anna@ex.kz', note: 'заметка', avg_check: null })
      expect(rows.find((r) => r.name === 'Анна Смирнова')).toMatchObject({ email: 'anna@ex.kz', avg_check: 9000 })
      expect(rows.find((r) => r.name === 'Борис')).toMatchObject({ email: null })
      expect(rows.find((r) => r.name === 'Новый')).toMatchObject({ email: 'new@ex.kz', note: 'звонить после 18' })
    }))

  // Review (medium): a plan made BEFORE the call (call at 11:00, plan for 15:00 the same day) was
  // treated as a call-back — the client stayed «на сегодня» and was «просрочено» the next morning.
  // A logged contact fulfils every plan due before the end of the Almaty day that exists at that
  // moment; a call-back is planned AFTER the contact and stays queued; later days are untouched.
  it('a contact fulfils every plan due by the end of today; a note does nothing; a call-back planned after the call is queued', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      // 00:30 Almaty on the 19th; the plan for 17:00 today was made before the call
      const called = await addClient(db, owner, { name: 'Позвонили', status: 'in_progress', next_contact_at: '2026-11-19T12:00:00Z' })
      await addReminder(db, owner, called, '2026-11-18T06:00:00Z') // yesterday
      await addReminder(db, owner, called, '2026-11-19T10:00:00Z') // 15:00 Almaty today, made before the call
      await addReminder(db, owner, called, '2026-11-19T18:59:00Z') // 23:59 Almaty today
      await addReminder(db, owner, called, '2026-11-19T19:00:00Z') // 00:00 tomorrow: another day
      const tomorrow = await addClient(db, owner, { name: 'Завтра', status: 'in_progress', next_contact_at: '2026-11-20T05:00:00Z' })
      const callBack = await addClient(db, owner, { name: 'Перезвонить', status: 'in_progress' })
      const noted = await addClient(db, owner, { name: 'Заметка', status: 'in_progress', next_contact_at: '2026-11-19T10:00:00Z' })
      await addReminder(db, owner, noted, '2026-11-18T06:00:00Z')
      session(db, owner)

      const log = async (id: string, kind: string) => {
        const res = await interactions.POST(
          new NextRequest(`http://localhost/api/v1/crm/clients/${id}/interactions`, {
            method: 'POST', body: JSON.stringify({ kind, comment: 'тест' }), headers: { 'content-type': 'application/json' },
          }),
          { params: { id } },
        )
        expect(res.status).toBe(200)
      }
      await log(called, 'call')
      await log(tomorrow, 'message')
      await log(callBack, 'meeting')
      await log(noted, 'note')

      const reminders = async () => (await db.query(
        `SELECT c.name, r.due_at, r.status FROM public.crm_clients c JOIN public.crm_reminders r ON r.client_id = c.id
          WHERE c.user_id = $1 ORDER BY c.name, r.due_at`,
        [owner],
      )).rows.map((r) => [r.name, (r.due_at as Date).toISOString(), r.status])
      expect(await reminders()).toEqual([
        ['Заметка', '2026-11-18T06:00:00.000Z', 'open'], // a note is not a contact: nothing moves
        ['Позвонили', '2026-11-18T06:00:00.000Z', 'done'],
        ['Позвонили', '2026-11-19T10:00:00.000Z', 'done'], // later today, but planned before the call
        ['Позвонили', '2026-11-19T18:59:00.000Z', 'done'],
        ['Позвонили', '2026-11-19T19:00:00.000Z', 'open'], // tomorrow: untouched
      ])
      const plans = async () => Object.fromEntries((await db.query(
        `SELECT name, next_contact_at, last_contact_at IS NOT NULL AS contacted FROM public.crm_clients WHERE user_id = $1`, [owner],
      )).rows.map((r) => [r.name, [r.next_contact_at && (r.next_contact_at as Date).toISOString(), r.contacted]]))
      expect(await plans()).toEqual({
        'Позвонили': [null, true], // the plan for 17:00 today is fulfilled by the call
        'Завтра': ['2026-11-20T05:00:00.000Z', true], // another day: kept
        'Перезвонить': [null, true],
        'Заметка': ['2026-11-19T10:00:00.000Z', false],
      })

      let p = await getToday()
      expect(Object.fromEntries(p.todayClients.map((c) => [c.id, c.queueBucket]))).toEqual({ [noted]: 0 })
      expect(p.stats.processedToday).toBe(3)

      // A call-back planned AFTER the contact — a new reminder, or a next contact saved in the
      // drawer — survives and puts the client back on today's list.
      await addReminder(db, owner, called, '2026-11-19T13:00:00Z') // «перезвонить в 18:00»
      const res = await clientRoute.PATCH(
        new NextRequest(`http://localhost/api/v1/crm/clients/${callBack}`, {
          method: 'PATCH', body: JSON.stringify({ next_contact_at: '2026-11-19T14:00:00Z' }), headers: { 'content-type': 'application/json' },
        }),
        { params: { id: callBack } },
      )
      expect(res.status).toBe(200)
      p = await getToday()
      expect(Object.fromEntries(p.todayClients.map((c) => [c.id, c.queueBucket]))).toEqual({ [called]: 1, [callBack]: 1, [noted]: 0 })
    }))

  // Review (low): the route ignored the errors of moving last_contact_at and of closing the plans
  // and still answered 200 — the screen said «зафиксирован» while the queue was not updated.
  it('a contact whose queue update fails answers 500 with a code (the touch itself is kept)', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const id = await addClient(db, owner, { name: 'Иван', status: 'in_progress' })
      await addReminder(db, owner, id, '2026-11-18T06:00:00Z')
      const post = async () => {
        const res = await interactions.POST(
          new NextRequest(`http://localhost/api/v1/crm/clients/${id}/interactions`, {
            method: 'POST', body: JSON.stringify({ kind: 'call' }), headers: { 'content-type': 'application/json' },
          }),
          { params: { id } },
        )
        return { status: res.status, body: (await res.json()) as { ok: boolean; code?: string; message?: string } }
      }
      failingSession(db, owner, 'crm_reminders', 'update')
      let r = await post()
      expect(r.status).toBe(500)
      expect(r.body).toMatchObject({ ok: false, code: 'queue_not_updated' })
      expect(r.body.message).toContain('очередь')

      failingSession(db, owner, 'crm_clients', 'update')
      r = await post()
      expect(r.status).toBe(500)
      expect(r.body).toMatchObject({ ok: false, code: 'queue_not_updated' })

      // the touches were recorded (the timeline shows them); nothing else moved
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.crm_interactions WHERE client_id = $1 AND kind = 'call'`, [id])
      expect(rows[0].n).toBe(2)

      session(db, owner)
      expect((await post()).status).toBe(200)
    }))

  // Review (low): PATCH /reminders/[id] acted on any reminder — a done one could become dismissed,
  // or be «done» again: a second history entry and a second move of the last contact.
  it('a reminder is closed once: done or dismissed again is a 409, nothing written twice', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const id = await addClient(db, owner, { name: 'Иван', status: 'in_progress' })
      await addReminder(db, owner, id, '2026-11-19T10:00:00Z')
      await addReminder(db, owner, id, '2026-11-20T11:00:00Z') // tomorrow: «done» today leaves it open
      const [r1, r2] = (await db.query(`SELECT id FROM public.crm_reminders WHERE client_id = $1 ORDER BY due_at`, [id])).rows.map((r) => r.id as string)
      session(db, owner)
      const patch = async (rid: string, status: 'done' | 'dismissed') => {
        const res = await remindersRoute.PATCH(
          new NextRequest(`http://localhost/api/v1/crm/reminders/${rid}`, {
            method: 'PATCH', body: JSON.stringify({ status }), headers: { 'content-type': 'application/json' },
          }),
          { params: { id: rid } },
        )
        return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string } }
      }
      const state = async () => {
        const c = (await db.query(`SELECT last_contact_at FROM public.crm_clients WHERE id = $1`, [id])).rows[0]
        const n = (await db.query(`SELECT count(*)::int AS n FROM public.crm_interactions WHERE client_id = $1`, [id])).rows[0].n
        const rem = (await db.query(`SELECT status FROM public.crm_reminders WHERE client_id = $1 ORDER BY due_at`, [id])).rows.map((r) => r.status)
        return { last: (c.last_contact_at as Date | null)?.toISOString() ?? null, touches: n as number, reminders: rem }
      }

      expect((await patch(r1, 'done')).status).toBe(200)
      expect(await state()).toEqual({ last: NOW.toISOString(), touches: 1, reminders: ['done', 'open'] })

      vi.setSystemTime(new Date(NOW.getTime() + 3_600_000)) // an hour later
      expect(await patch(r1, 'done')).toMatchObject({ status: 409, body: { ok: false, error: 'reminder_closed' } })
      expect(await patch(r1, 'dismissed')).toMatchObject({ status: 409, body: { ok: false, error: 'reminder_closed' } })
      expect(await state()).toEqual({ last: NOW.toISOString(), touches: 1, reminders: ['done', 'open'] })

      // a dismissed one is closed too; an open one still closes normally
      expect((await patch(r2, 'dismissed')).status).toBe(200)
      expect((await patch(r2, 'done')).status).toBe(409)
      expect(await state()).toEqual({ last: NOW.toISOString(), touches: 1, reminders: ['done', 'dismissed'] })
    }))

  /** PATCH /api/v1/crm/reminders/[id] as the owner. */
  const patchReminder = async (rid: string, body: Record<string, unknown>) => {
    const res = await remindersRoute.PATCH(
      new NextRequest(`http://localhost/api/v1/crm/reminders/${rid}`, {
        method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
      }),
      { params: { id: rid } },
    )
    return { status: res.status, body: (await res.json()) as { ok: boolean; code?: string; message?: string } }
  }

  // Follow-up: «Выполнено» moves the last contact, so it is a contact — it fulfils the client's
  // plans exactly as a logged call does (one shared rule, lib/crm/contact.ts).
  it('«Выполнено» on a reminder fulfils the plans due by the end of today, like a logged contact', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const id = await addClient(db, owner, { name: 'Иван', status: 'in_progress', next_contact_at: '2026-11-19T12:00:00Z' })
      await addReminder(db, owner, id, '2026-11-18T06:00:00Z') // yesterday — the one marked «Выполнено»
      await addReminder(db, owner, id, '2026-11-19T10:00:00Z') // 15:00 Almaty today, made before
      await addReminder(db, owner, id, '2026-11-19T19:00:00Z') // 00:00 tomorrow: another day
      const later = await addClient(db, owner, { name: 'Перезвон', status: 'in_progress' })
      await addReminder(db, owner, later, '2026-11-18T06:00:00Z')
      const rid = async (clientId: string, due: string) =>
        (await db.query(`SELECT id FROM public.crm_reminders WHERE client_id = $1 AND due_at = $2`, [clientId, due])).rows[0].id as string
      session(db, owner)

      expect((await patchReminder(await rid(id, '2026-11-18T06:00:00Z'), { status: 'done' })).status).toBe(200)
      const rows = (await db.query(
        `SELECT due_at, status FROM public.crm_reminders WHERE client_id = $1 ORDER BY due_at`, [id],
      )).rows.map((r) => [(r.due_at as Date).toISOString(), r.status])
      expect(rows).toEqual([
        ['2026-11-18T06:00:00.000Z', 'done'],
        ['2026-11-19T10:00:00.000Z', 'done'], // later today, planned before: fulfilled
        ['2026-11-19T19:00:00.000Z', 'open'], // tomorrow: untouched
      ])
      const client = (await db.query(`SELECT next_contact_at, last_contact_at FROM public.crm_clients WHERE id = $1`, [id])).rows[0]
      expect(client.next_contact_at).toBeNull() // the plan for 17:00 today is fulfilled
      expect((client.last_contact_at as Date).toISOString()).toBe(NOW.toISOString())

      // «Выполнено» with a next contact later today (a call-back proposed with it) keeps that plan
      expect((await patchReminder(await rid(later, '2026-11-18T06:00:00Z'), { status: 'done', next_contact_at: '2026-11-19T13:00:00Z' })).status).toBe(200)
      // …and a reminder added after it is a call-back too
      await addReminder(db, owner, id, '2026-11-19T14:00:00Z')
      const p = await getToday()
      expect(Object.fromEntries(p.todayClients.map((c) => [c.id, c.queueBucket]))).toEqual({ [id]: 1, [later]: 1 })
      const next = (await db.query(`SELECT next_contact_at FROM public.crm_clients WHERE id = $1`, [later])).rows[0].next_contact_at as Date
      expect(next.toISOString()).toBe('2026-11-19T13:00:00.000Z')
    }))

  // Follow-up: the history entry, the last-contact move and the closing of plans of «Выполнено»
  // were not checked — a failed write still answered 200.
  it('«Выполнено» whose history / last contact / plans write fails answers 500 queue_not_updated', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const id = await addClient(db, owner, { name: 'Иван', status: 'in_progress' })
      for (const due of ['2026-11-18T01:00:00Z', '2026-11-18T02:00:00Z', '2026-11-18T03:00:00Z', '2026-11-20T04:00:00Z']) {
        await addReminder(db, owner, id, due)
      }
      const ids = (await db.query(`SELECT id FROM public.crm_reminders WHERE client_id = $1 ORDER BY due_at`, [id])).rows.map((r) => r.id as string)
      const cases: Array<[string, 'update' | 'insert', string | undefined]> = [
        ['crm_interactions', 'insert', undefined], // the history entry
        ['crm_clients', 'update', undefined], // the last contact
        ['crm_reminders', 'update', 'lt'], // closing the other plans (not the reminder itself)
      ]
      for (const [i, [table, op, onlyWith]] of cases.entries()) {
        failingSession(db, owner, table, op, onlyWith)
        // the next open reminder (each case's «done» closes the ones due today, so add one back)
        await db.query(`UPDATE public.crm_reminders SET status = 'open', done_at = NULL WHERE id = $1`, [ids[i]])
        const r = await patchReminder(ids[i], { status: 'done' })
        expect(r.status, table).toBe(500)
        expect(r.body, table).toMatchObject({ ok: false, code: 'queue_not_updated' })
        expect(r.body.message, table).toContain('очередь')
      }
      session(db, owner)
      await db.query(`UPDATE public.crm_reminders SET status = 'open', done_at = NULL WHERE id = $1`, [ids[3]])
      expect((await patchReminder(ids[3], { status: 'done' })).status).toBe(200)
    }))

  it('/today returns at most 50 queue rows with the true total and cut notes (review M3)', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      await db.query(
        `INSERT INTO public.crm_clients (user_id, name, status, note, created_at)
         SELECT $1, 'Лид ' || g, 'new', repeat('заметка ', 1200), '2026-11-01T00:00:00Z' FROM generate_series(1, 120) g`,
        [owner],
      )
      session(db, owner)
      const p = (await getToday()) as TodayPayload & { todayClientsTotal: number }
      expect(p.todayClients).toHaveLength(50)
      expect(p.todayClientsTotal).toBe(120)
      expect(p.stats.queue.noPlan).toBe(120)
      expect(p.todayClients.every((c) => (c.note as string).length <= 301 && c.noteTruncated === true)).toBe(true)
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

  // Review (high): the drawer stays open after a save; reverting a field and saving again was
  // «Нет изменений» and the DB kept the first save. The baseline is now the PATCH answer.
  it('two saves from one open drawer: a field changed and changed back is saved both times', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const id = await addClient(db, owner, {
        name: 'Иван', status: 'new', phone: '+77010000001', phone_raw: '+7 701 000 00 01', email: 'ivan@ex.kz', next_contact_at: '2026-11-20T10:00:00Z',
      })
      session(db, owner)
      const row = (await getToday()).todayClients.length
      expect(row).toBe(0) // planned for tomorrow: not queued — the drawer is opened from the base tab
      const listed = await clients.GET(new NextRequest('http://localhost/api/v1/crm/clients'))
      const base = ((await listed.json()) as { data: { clients: ClientRowLike[] } }).data.clients
      let baseline = seedFromClientRow(base.find((c) => c.id === id) as ClientRowLike)

      const save = async (form: Parameters<typeof drawerPatch>[1]) => {
        const patch = drawerPatch(baseline, form)
        expect(Object.keys(patch).length).toBeGreaterThan(0) // never «Нет изменений»
        const res = await clientRoute.PATCH(
          new NextRequest(`http://localhost/api/v1/crm/clients/${id}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { 'content-type': 'application/json' } }),
          { params: { id } },
        )
        expect(res.status).toBe(200)
        baseline = baselineAfterSave(baseline, ((await res.json()) as { data: { client: ClientRowLike } }).data.client)
      }
      const opened = {
        name: 'Иван', phone: phoneFieldValue(baseline), email: 'ivan@ex.kz', status: 'new' as const, avgCheck: null,
        nextContactAt: '2026-11-20T10:00:00.000Z', note: '',
      }
      const edited = { ...opened, status: 'customer' as const, phone: '8 701 000 00 02', email: 'other@ex.kz', nextContactAt: null }
      await save(edited)
      await save(opened) // every field back as it was

      const { rows } = await db.query(
        `SELECT status, phone, phone_raw, email, next_contact_at FROM public.crm_clients WHERE id = $1`, [id],
      )
      expect(rows[0]).toEqual({
        status: 'new', phone: '+77010000001', phone_raw: '+7 701 000 00 01', email: 'ivan@ex.kz', next_contact_at: new Date('2026-11-20T10:00:00Z'),
      })
    }))
})
