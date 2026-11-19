/**
 * lib/crm/today.ts — the «Кому звонить сегодня» rules, shared by GET /api/v1/crm/today, the AI
 * briefing and the morning digest (M1, L5, M2, M3, L4).
 */
// The production server runs in UTC: «today» must still be the Almaty day (L5).
process.env.TZ = 'UTC'

import { describe, expect, it } from 'vitest'
import {
  almatyDay, buildCrmToday, NOTE_PREVIEW_MAX, PAGE_SIZE, queueBucket, queueCountsByUser, readAllById, TODAY_LIST_MAX,
  type CrmClientRow,
} from '@/lib/crm/today'

// 2026-11-18 19:30 UTC = 2026-11-19 00:30 in Almaty: a UTC server still thinks it is the 18th.
const NOW = Date.parse('2026-11-18T19:30:00Z')
const ALMATY_MIDNIGHT = Date.parse('2026-11-18T19:00:00Z')
const DAY = almatyDay(NOW)
const H = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

function client(over: Partial<CrmClientRow> = {}): CrmClientRow {
  return {
    id: over.id ?? 'c1', name: 'Клиент', phone: null, phone_raw: null, email: null, status: 'new', avg_check: null,
    note: null, next_contact_at: null, last_contact_at: null, created_at: '2026-11-01T00:00:00Z', ...over,
  }
}

describe('almatyDay (L5)', () => {
  it('starts at Almaty midnight (UTC+5), whatever the server time zone', () => {
    expect(DAY).toEqual({ startMs: ALMATY_MIDNIGHT, endMs: ALMATY_MIDNIGHT + 24 * H, day: '2026-11-19' })
    // one minute before Almaty midnight is still the 18th
    expect(almatyDay(ALMATY_MIDNIGHT - 60_000).day).toBe('2026-11-18')
  })
})

describe('queueBucket (M1: a handled client leaves today\'s queue)', () => {
  const bucket = (c: CrmClientRow, dues: number[] = []) => queueBucket(c, dues, DAY, NOW)

  it('an active client without a plan: queued when never contacted or last contacted before today', () => {
    expect(bucket(client())).toBe(2)
    expect(bucket(client({ last_contact_at: iso(ALMATY_MIDNIGHT - H) }))).toBe(2) // yesterday (Almaty)
  })

  it('contacted today with nothing planned after that contact → off the queue', () => {
    const touched = iso(ALMATY_MIDNIGHT + 10 * 60_000)
    expect(bucket(client({ last_contact_at: touched }))).toBeNull()
    // a reminder due two days ago is answered by today's contact
    expect(bucket(client({ last_contact_at: touched }), [ALMATY_MIDNIGHT - 48 * H])).toBeNull()
  })

  // Review M1: «touched today → out» ran before the plan, so a call-back planned for later the same
  // day never showed — and was overdue the next morning. A plan for later today that is still open
  // after a contact was made AFTER it: logging the contact fulfils the plans due by the end of the
  // day that existed then (app/api/v1/crm/clients/[id]/interactions; tests/integration/crm-owner-api).
  it("a call-back planned for later today after this morning's call is in today's queue", () => {
    const touched = iso(ALMATY_MIDNIGHT + 10 * 60_000)
    expect(bucket(client({ last_contact_at: touched, next_contact_at: iso(ALMATY_MIDNIGHT + 5 * H) }))).toBe(1)
    expect(bucket(client({ last_contact_at: touched }), [ALMATY_MIDNIGHT + 5 * H])).toBe(1)
    // …and once the call-back is made (a contact after its time), it is answered
    const tomorrow = almatyDay(ALMATY_MIDNIGHT + 30 * H)
    const late = client({ last_contact_at: iso(ALMATY_MIDNIGHT + 6 * H) })
    expect(queueBucket(late, [ALMATY_MIDNIGHT + 5 * H], tomorrow, ALMATY_MIDNIGHT + 30 * H)).toBe(2)
    // not made: overdue the next morning
    const missed = client({ last_contact_at: touched })
    expect(queueBucket(missed, [ALMATY_MIDNIGHT + 5 * H], tomorrow, ALMATY_MIDNIGHT + 30 * H)).toBe(0)
  })

  it('L5: a reminder due later today (Almaty) is «today», one due before Almaty midnight is overdue', () => {
    expect(bucket(client(), [ALMATY_MIDNIGHT + 6 * H])).toBe(1)
    // 18:00 UTC on the 18th — «today» on a UTC server, yesterday in Almaty
    expect(bucket(client(), [Date.parse('2026-11-18T18:00:00Z')])).toBe(0)
  })

  it('next_contact_at: overdue until a later touch answers it; then the client has no plan', () => {
    const next = iso(ALMATY_MIDNIGHT - 30 * H)
    expect(bucket(client({ next_contact_at: next }))).toBe(0)
    expect(bucket(client({ next_contact_at: next, last_contact_at: iso(ALMATY_MIDNIGHT - 20 * H) }))).toBe(2)
  })

  it('an open reminder is pending until a contact at or after its time — an earlier contact does not answer it', () => {
    expect(bucket(client({ last_contact_at: iso(ALMATY_MIDNIGHT - 40 * H) }), [ALMATY_MIDNIGHT - 30 * H])).toBe(0)
    expect(bucket(client({ last_contact_at: iso(ALMATY_MIDNIGHT - 2 * H) }), [ALMATY_MIDNIGHT - 30 * H])).toBe(2)
  })

  it('a contact planned after today keeps the client out of today\'s queue (also a sleeping one)', () => {
    expect(bucket(client({ next_contact_at: iso(ALMATY_MIDNIGHT + 30 * H) }))).toBeNull()
    expect(bucket(client(), [ALMATY_MIDNIGHT + 30 * H])).toBeNull()
    expect(bucket(client({ status: 'sleeping', last_contact_at: iso(NOW - 60 * 24 * H) }), [ALMATY_MIDNIGHT + 30 * H])).toBeNull()
  })

  it('sleeping: customer / sleeping with no touch for > 30 days — since creation when never touched', () => {
    expect(bucket(client({ status: 'customer', last_contact_at: iso(NOW - 31 * 24 * H) }))).toBe(3)
    expect(bucket(client({ status: 'customer', last_contact_at: iso(NOW - 29 * 24 * H) }))).toBeNull()
    expect(bucket(client({ status: 'sleeping', created_at: iso(NOW - 40 * 24 * H) }))).toBe(3)
    expect(bucket(client({ status: 'sleeping', created_at: iso(NOW - 5 * 24 * H) }))).toBeNull()
  })

  // Review (low): a lost client with an old plan stayed «Просрочено» forever. Lost = never in the
  // queue, never overdue — whatever is still planned (the plans stay stored).
  it('a lost client is never queued and never overdue, even with a plan', () => {
    expect(bucket(client({ status: 'lost' }))).toBeNull()
    expect(bucket(client({ status: 'lost' }), [ALMATY_MIDNIGHT + H])).toBeNull()
    expect(bucket(client({ status: 'lost' }), [ALMATY_MIDNIGHT - 48 * H])).toBeNull()
    expect(bucket(client({ status: 'lost', next_contact_at: iso(ALMATY_MIDNIGHT - 30 * H) }))).toBeNull()
    // the same plan on any other status is still overdue
    for (const status of ['new', 'in_progress', 'waiting', 'customer', 'sleeping']) {
      expect(bucket(client({ status }), [ALMATY_MIDNIGHT - 48 * H])).toBe(0)
    }
  })

  it('the digest does not count a lost client (queueCountsByUser)', () => {
    const counts = queueCountsByUser(
      [{ ...client({ id: 'l', status: 'lost' }), user_id: 'u1' }],
      [{ client_id: 'l', due_at: iso(ALMATY_MIDNIGHT - 48 * H) }],
      NOW,
    )
    expect(counts.has('u1')).toBe(false)
  })
})

describe('buildCrmToday (M2: nothing invented)', () => {
  it('unknown check → null (not 0 ₸); never contacted → daysSince null (not 999); no order series', () => {
    const p = buildCrmToday([client({ id: 'a' })], [], NOW)
    const row = p.todayClients[0]
    expect(row.avgCheck).toBeNull()
    expect(row.daysSince).toBeNull()
    expect(row.checkVsAvgPct).toBeNull()
    for (const k of ['history', 'orderCycle', 'volumeChange', 'churnProb', 'lastOrder', 'forbes']) expect(row).not.toHaveProperty(k)
  })

  it('money at risk: null while any high-risk client has no check; 0 only when nobody is at high risk', () => {
    const lostWithCheck = client({ id: 'l1', status: 'lost', avg_check: 100_000 })
    const lostNoCheck = client({ id: 'l2', status: 'lost' })
    const unknown = buildCrmToday([lostWithCheck, lostNoCheck], [], NOW).stats
    expect(unknown).toMatchObject({ highRisk: 2, revenueAtRisk: null, highRiskWithoutCheck: 1 })
    expect(buildCrmToday([lostWithCheck], [], NOW).stats.revenueAtRisk).toBe(100_000)
    const calm = client({ id: 'ok', status: 'customer', last_contact_at: iso(NOW - H) })
    expect(buildCrmToday([calm], [], NOW).stats).toMatchObject({ highRisk: 0, revenueAtRisk: 0 })
  })

  it('NUMERIC checks that arrive as strings are numbers, not unknown', () => {
    const p = buildCrmToday([client({ id: 'a', status: 'lost', avg_check: '2500' })], [], NOW)
    expect(p.stats.revenueAtRisk).toBe(2500)
  })

  it('the risk list is the whole base (a lost client is at risk even though it is not queued)', () => {
    const p = buildCrmToday([client({ id: 'lost', status: 'lost' }), client({ id: 'new' })], [], NOW)
    expect(p.todayClients.map((c) => c.id)).toEqual(['new'])
    expect(p.riskClients.map((c) => c.id)).toContain('lost')
  })

  // Review (browser check): with one known check the client was compared with itself — «0 %».
  it('check vs average needs at least two known checks', () => {
    const one = buildCrmToday([client({ id: 'a', avg_check: 5000 }), client({ id: 'b' })], [], NOW)
    expect(one.todayClients.find((c) => c.id === 'a')?.checkVsAvgPct).toBeNull()
    const two = buildCrmToday([client({ id: 'a', avg_check: 5000 }), client({ id: 'b', avg_check: 15000 })], [], NOW)
    expect(two.todayClients.find((c) => c.id === 'a')?.checkVsAvgPct).toBe(-50)
  })

  // Review M3: a 2000-row import put everyone in «Без плана», all returned with 10k-char notes.
  it('returns at most TODAY_LIST_MAX queue rows (priority order) with the true total, notes cut', () => {
    const many = Array.from({ length: 130 }, (_, i) => client({ id: `n${String(i).padStart(3, '0')}`, name: `Лид ${i}`, note: 'x'.repeat(10_000) }))
    const late = client({ id: 'late', name: 'Просроченный', next_contact_at: iso(ALMATY_MIDNIGHT - 3 * H) })
    const p = buildCrmToday([...many, late], [], NOW)
    expect(p.todayClients).toHaveLength(TODAY_LIST_MAX)
    expect(p.todayClientsTotal).toBe(131)
    expect(p.stats.queue).toMatchObject({ overdue: 1, noPlan: 130 })
    expect(p.todayClients[0].id).toBe('late')
    const row = p.todayClients[1]
    expect(row.noteTruncated).toBe(true)
    expect((row.note as string).length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX + 1)
    expect(p.todayClients[0]).toMatchObject({ note: null, noteTruncated: false })
  })

  it('the queue is ordered overdue → today → no plan → sleeping, and counted per bucket', () => {
    const p = buildCrmToday(
      [
        client({ id: 'sleep', status: 'customer', last_contact_at: iso(NOW - 40 * 24 * H) }),
        client({ id: 'noplan' }),
        client({ id: 'today', next_contact_at: iso(ALMATY_MIDNIGHT + 3 * H) }),
        client({ id: 'late', next_contact_at: iso(ALMATY_MIDNIGHT - 3 * H) }),
        client({ id: 'done', last_contact_at: iso(ALMATY_MIDNIGHT + H) }),
      ],
      [],
      NOW,
    )
    expect(p.todayClients.map((c) => c.id)).toEqual(['late', 'today', 'noplan', 'sleep'])
    expect(p.stats.queue).toEqual({ overdue: 1, today: 1, noPlan: 1, sleeping: 1 })
    expect(p.stats.processedToday).toBe(1)
    expect(p.day).toBe('2026-11-19')
  })
})

describe('queueCountsByUser (the digest counts what the queue shows)', () => {
  it('per owner: overdue / due today / sleeping are the queue buckets', () => {
    const rows = [
      { ...client({ id: 'a' }), user_id: 'u1' },
      { ...client({ id: 'b' }), user_id: 'u1' },
      { ...client({ id: 'c', status: 'sleeping', created_at: iso(NOW - 90 * 24 * H) }), user_id: 'u1' },
      { ...client({ id: 'd' }), user_id: 'u2' },
    ]
    const counts = queueCountsByUser(
      rows,
      [
        { client_id: 'a', due_at: iso(ALMATY_MIDNIGHT + 8 * H) }, // later today → NOT overdue
        { client_id: 'b', due_at: iso(ALMATY_MIDNIGHT - 8 * H) },
      ],
      NOW,
    )
    expect(counts.get('u1')).toEqual({ overdue: 1, dueToday: 1, sleeping: 1 })
    expect(counts.has('u2')).toBe(false) // a client without a plan is not a digest line
  })
})

describe('readAllById (M3: no silent 500-row cut)', () => {
  it('reads page after page in id order until an empty page', async () => {
    const ids = Array.from({ length: PAGE_SIZE * 2 + 5 }, (_, i) => `id-${String(i).padStart(6, '0')}`)
    const afters: Array<string | null> = []
    const res = await readAllById(async (after) => {
      afters.push(after)
      const from = after ? ids.indexOf(after) + 1 : 0
      return { data: ids.slice(from, from + PAGE_SIZE).map((id) => ({ id })), error: null }
    })
    expect(res.ok && res.rows.length).toBe(ids.length)
    expect(afters).toEqual([null, ids[PAGE_SIZE - 1], ids[2 * PAGE_SIZE - 1], ids[ids.length - 1]])
  })

  // Review (low): a server whose max-rows is below PAGE_SIZE returns short pages that are not the end.
  it('a short page is not the end (server max-rows below the page size)', async () => {
    const ids = Array.from({ length: 950 }, (_, i) => `id-${String(i).padStart(6, '0')}`)
    const res = await readAllById(async (after) => {
      const from = after ? ids.indexOf(after) + 1 : 0
      return { data: ids.slice(from, from + 400).map((id) => ({ id })), error: null } // max-rows = 400
    })
    expect(res.ok && res.rows.length).toBe(950)
  })

  it('a failed page is an error, not a shorter list', async () => {
    let n = 0
    const res = await readAllById(async () => (n++ === 0
      ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: String(i).padStart(5, '0') })), error: null }
      : { data: null, error: { message: 'boom' } }))
    expect(res.ok).toBe(false)
  })
})
