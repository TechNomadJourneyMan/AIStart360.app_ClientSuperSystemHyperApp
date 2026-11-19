/**
 * Review of wave 1A (LOW): GET /api/cron/crm-digest had no per-day dedupe for the digest itself — a
 * deploy or a revert around its slot (04:11 UTC) could send it twice, or skip the day. Each owner's
 * digest is now claimed once per Almaty day in the journal of automatic sends (claimSend,
 * key crm_digest:<owner>:<Almaty day>): a second run that day sends nothing. That makes a catch-up
 * slot safe (05:11 UTC): it reaches only the owners the first run did not (budget, a missed slot).
 * A digest no channel delivered gives its claim back (the catch-up retries it); one cut by the
 * deadline keeps it (its late answer may still arrive — no second copy). No journal → no send.
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** automation_sends by dedupe key */
  journal: new Map<string, { userId: string | null; kind: string; countsTowardCap: boolean }>(),
  claimFails: false,
  journalReadFails: false,
  claims: [] as string[],
  released: [] as string[],
  inapp: [] as string[],
  emailOk: true,
  emails: [] as string[],
}))

vi.mock('@/lib/cron-auth', () => ({ isAuthorizedCron: () => ({ ok: true }) }))
vi.mock('@/lib/automation/maintenance-gate', () => ({ maintenanceSkipReason: async () => null }))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (n: { userId: string }) => { h.inapp.push(n.userId); return true },
}))
vi.mock('@/lib/notifications/notify', () => ({ notifyClient: async () => ({ ok: true, skipped: 'duplicate' }) }))
vi.mock('@/lib/email', () => ({
  sendUserEmail: async (m: { to: string }) => { h.emails.push(m.to); return { ok: h.emailOk } },
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async () => false }))
vi.mock('@/lib/whatsapp/config', () => ({ cloudApiConfigured: () => false }))
vi.mock('@/lib/notifications/store', () => ({
  claimSend: async (input: { userId: string | null; kind: string; dedupeKey: string | null; countsTowardCap: boolean }) => {
    h.claims.push(input.dedupeKey ?? '')
    if (h.claimFails) return { result: 'unavailable', id: null }
    if (input.dedupeKey && h.journal.has(input.dedupeKey)) return { result: 'duplicate', id: null }
    h.journal.set(input.dedupeKey ?? `x${h.journal.size}`, { userId: input.userId, kind: input.kind, countsTowardCap: input.countsTowardCap })
    return { result: 'claimed', id: input.dedupeKey }
  },
  releaseSend: async (id: string) => { h.released.push(id); h.journal.delete(id) },
}))
vi.mock('@/lib/automation/data', () => ({
  fetchSentDedupeKeys: async (keys: string[]) => (h.journalReadFails ? null : new Set(keys.filter((k) => h.journal.has(k)))),
}))

const off = { in_app: false, email: false, telegram: false }
const tables: Record<string, unknown[]> = {
  crm_clients: ['u1', 'u2'].map((u, i) => ({
    id: `c${i}`, user_id: u, status: 'new', next_contact_at: '2026-11-01T00:00:00Z', last_contact_at: null, created_at: '2026-10-01T00:00:00Z',
  })),
  crm_reminders: [],
  gri_assessments: [],
  profiles: [
    { id: 'u1', email: null, telegram_chat_id: null, preferences: { notifications: { crm: { ...off, in_app: true } } } },
    { id: 'u2', email: 'u2@ex.kz', telegram_chat_id: null, preferences: { notifications: { crm: { ...off, email: true } } } },
  ],
}
function fakeService() {
  return {
    from(table: string) {
      let paged = false
      const chain: Record<string, unknown> = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (r: unknown) => unknown, err: (e: unknown) => unknown) =>
              Promise.resolve({ data: paged ? [] : tables[table] ?? [], error: null }).then(ok, err)
          }
          return () => {
            if (prop === 'gt') paged = true
            return chain
          }
        },
      })
      return chain
    },
  }
}
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeService() }))

const digest = await import('../../../app/api/cron/crm-digest/route')
const { CRON_JOBS, dueJobs, jobsForRole } = await import('@/lib/cron/schedule')

async function runAt(iso: string) {
  vi.setSystemTime(new Date(iso))
  const res = await digest.GET(new NextRequest('http://localhost/api/cron/crm-digest', { headers: { authorization: 'Bearer s' } }))
  return (await res.json()) as { ok: boolean; data: Record<string, number> }
}

beforeEach(() => {
  process.env.CRON_SECRET = 's'
  vi.useFakeTimers({ toFake: ['Date'] })
  h.journal = new Map()
  h.claimFails = false
  h.journalReadFails = false
  h.claims = []
  h.released = []
  h.inapp = []
  h.emailOk = true
  h.emails = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
})

describe('crm-digest: one digest per owner per Almaty day', () => {
  it('the morning run sends to both owners; a second run the same day (catch-up slot, a redeploy) sends nothing', async () => {
    const first = await runAt('2026-11-19T04:11:00Z')
    expect(first.data).toMatchObject({ usersNotified: 2, alreadySent: 0 })
    expect(h.inapp).toEqual(['u1'])
    expect(h.emails).toEqual(['u2@ex.kz'])
    expect([...h.journal.keys()].sort()).toEqual(['crm_digest:u1:2026-11-19', 'crm_digest:u2:2026-11-19'])
    expect([...h.journal.values()].every((v) => v.kind === 'crm_digest' && v.countsTowardCap === false)).toBe(true)

    h.claims = []
    const again = await runAt('2026-11-19T05:11:00Z')
    expect(again.data).toMatchObject({ usersNotified: 0, alreadySent: 2 })
    expect(h.inapp).toEqual(['u1'])
    expect(h.emails).toEqual(['u2@ex.kz'])
    expect(h.claims).toEqual([]) // filtered before the run: not even a claim
  })

  it('the journal read fails: the claim alone still stops the second copy', async () => {
    await runAt('2026-11-19T04:11:00Z')
    h.journalReadFails = true
    const again = await runAt('2026-11-19T05:11:00Z')
    expect(again.data).toMatchObject({ usersNotified: 0, alreadySent: 2 })
    expect(h.inapp).toEqual(['u1'])
    expect(h.emails).toEqual(['u2@ex.kz'])
  })

  it('the next Almaty day is a new key (the day turns at 19:00 UTC)', async () => {
    await runAt('2026-11-19T04:11:00Z')
    const late = await runAt('2026-11-19T18:59:00Z') // 23:59 in Almaty — still the 19th
    expect(late.data).toMatchObject({ usersNotified: 0, alreadySent: 2 })
    const next = await runAt('2026-11-19T19:01:00Z') // 00:01 on the 20th in Almaty
    expect(next.data).toMatchObject({ usersNotified: 2 })
    expect(h.journal.has('crm_digest:u1:2026-11-20')).toBe(true)
  })

  it('no channel delivered (the e-mail provider said no): the claim is given back, the catch-up run retries', async () => {
    h.emailOk = false
    const first = await runAt('2026-11-19T04:11:00Z')
    expect(first.data).toMatchObject({ usersNotified: 1, undelivered: 1 })
    expect(h.released).toEqual(['crm_digest:u2:2026-11-19'])
    h.emailOk = true
    const catchUp = await runAt('2026-11-19T05:11:00Z')
    expect(catchUp.data).toMatchObject({ usersNotified: 1, alreadySent: 1 })
    expect(h.emails).toEqual(['u2@ex.kz', 'u2@ex.kz'])
  })

  it('no journal (the claim cannot be written): nothing is sent — a cron without its journal would repeat itself', async () => {
    h.claimFails = true
    const r = await runAt('2026-11-19T04:11:00Z')
    expect(r.data).toMatchObject({ usersNotified: 0, journalUnavailable: 2 })
    expect(h.inapp).toEqual([])
    expect(h.emails).toEqual([])
  })

  it('the schedule: 04:11 and the catch-up at 05:11 UTC every day, each in a minute of its own', () => {
    const job = CRON_JOBS.find((j) => j.path === '/api/cron/crm-digest')!
    expect(job.schedule).toBe('11 4,5 * * *')
    for (const iso of ['2026-11-19T04:11:00Z', '2026-11-19T05:11:00Z']) {
      expect(dueJobs(new Date(iso), jobsForRole('all')).map((j) => j.path)).toEqual(['/api/cron/crm-digest'])
    }
  })
})
