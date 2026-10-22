/**
 * Point B invites — the external channel only in the working hours (spec §12.1): the timing decision (boundaries,
 * weekend, time zone), the deferral (bell at once, `delivered.external = 'pending'`), the later delivery by the
 * sweeper (weekly cap, closed invites dropped, preferences read again) and the Inngest wiring (window check,
 * batches of ten with a sleep between). In-memory DB; lib/comm, notifyClient and the journal are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkWindow } from '@/lib/comm/schedule'
import { pbDb } from './_pbdb'

const n = vi.hoisted(() => ({
  notify: [] as Array<{ dedupeKey?: string | null; channels?: Record<string, boolean> }>,
  sends: [] as Array<{ id: string; dedupe_key: string | null }>,
  comm: [] as Array<{ userId: string; channels: string[]; body: string }>,
  recipient: { id: 'u', email: 'owner@example.com', fullName: 'Владелец', telegramChatId: null as string | null, preferences: {} as unknown },
}))

vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: vi.fn(async (input: { dedupeKey?: string | null; channels?: Record<string, boolean> }) => {
    n.notify.push(input)
    return { ok: true, delivered: { inApp: true, email: false, telegram: false } }
  }),
}))
vi.mock('@/lib/comm/send', () => ({
  sendToUser: vi.fn(async (input: { userId: string; channels: string[]; body: string }) => {
    n.comm.push(input)
    return { ok: true, threadId: 't', groupId: 'g', messages: [] }
  }),
}))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: vi.fn(async () => n.recipient),
  claimSend: vi.fn(async (input: { dedupeKey: string | null }) => {
    if (input.dedupeKey && n.sends.some((s) => s.dedupe_key === input.dedupeKey)) return { result: 'duplicate', id: null }
    const id = `send-${n.sends.length + 1}`
    n.sends.push({ id, dedupe_key: input.dedupeKey })
    return { result: 'claimed', id }
  }),
  releaseSend: vi.fn(async (id: string) => { n.sends = n.sends.filter((s) => s.id !== id) }),
}))
// The settings table is never read in tests: the registry defaults (working hours Mon–Fri 09:00–19:00 Almaty).
vi.mock('@/lib/settings/store', async () => {
  const { SETTINGS } = await import('@/lib/settings/registry')
  return { getSetting: async (k: keyof typeof SETTINGS) => structuredClone(SETTINGS[k].default) }
})
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => false }))

const { deliverInvite, deliverPendingExternal, externalTiming, loadInviteWindow } = await import('@/lib/point-b/invites/deliver')
const { runInviteSweep, INVITE_SWEEP_BATCHES } = await import('@/lib/functions/point-b')

const ALMATY: WorkWindow = { days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00', timeZone: 'Asia/Almaty' }
const win = (w: WorkWindow = ALMATY) => async () => w
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER = 'cccccccc-0000-4000-8000-000000000002'

let h: ReturnType<typeof pbDb>
const invites = () => h.db.pb_invites as Array<Record<string, unknown>>

function seedInvite(id: string, over: Record<string, unknown> = {}) {
  invites().push({
    id, company_id: 'company-1', user_id: CLIENT, rule_key: 'cash_gap', dedupe_key: `cash_gap:${id}`, kind: 'insight',
    title: `Инсайт ${id}`, body: 'Текст', href: '/client/point-b?tab=whatif', why: '', source_refs: [], priority: 3, display: 'card',
    status: 'new', snoozed_until: null, expires_at: '2026-11-30T00:00:00Z', source_rec_id: null,
    delivered: { bell: '2026-10-24T10:00:00.000Z', external: 'pending', external_due: '2026-10-26T04:00:00.000Z', at: '2026-10-24T10:00:00.000Z' },
    created_at: `2026-10-24T10:00:0${invites().length}Z`, updated_at: '2026-10-24T10:00:00Z', ...over,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h = pbDb({ pb_invites: [] })
  n.notify = []
  n.sends = []
  n.comm = []
  n.recipient = { id: CLIENT, email: 'owner@example.com', fullName: 'Владелец', telegramChatId: null, preferences: {} }
})

describe('externalTiming: the working hours of «Общение» in the communication time zone', () => {
  it('inside the window → now; the boundaries: from is inside, to is outside', () => {
    // Almaty = UTC+5: 09:00 local = 04:00 UTC, 19:00 local = 14:00 UTC. 2026-10-22 is a Thursday.
    expect(externalTiming(new Date('2026-10-22T04:00:00Z'), ALMATY)).toEqual({ now: true })
    expect(externalTiming(new Date('2026-10-22T13:59:00Z'), ALMATY)).toEqual({ now: true })
    expect(externalTiming(new Date('2026-10-22T03:59:00Z'), ALMATY)).toEqual({ now: false, at: new Date('2026-10-22T04:00:00Z') })
    // 19:00 sharp is already outside → Friday 09:00
    expect(externalTiming(new Date('2026-10-22T14:00:00Z'), ALMATY)).toEqual({ now: false, at: new Date('2026-10-23T04:00:00Z') })
  })

  it('weekend → Monday morning; Friday evening → Monday too', () => {
    expect(externalTiming(new Date('2026-10-24T07:00:00Z'), ALMATY)).toEqual({ now: false, at: new Date('2026-10-26T04:00:00Z') }) // Saturday noon
    expect(externalTiming(new Date('2026-10-25T20:00:00Z'), ALMATY)).toEqual({ now: false, at: new Date('2026-10-26T04:00:00Z') }) // Monday 01:00 local
    expect(externalTiming(new Date('2026-10-23T15:00:00Z'), ALMATY)).toEqual({ now: false, at: new Date('2026-10-26T04:00:00Z') }) // Friday 20:00
  })

  it('the time zone decides: the same instant is evening in Almaty and afternoon in Moscow', () => {
    const at = new Date('2026-10-22T14:30:00Z') // 19:30 Almaty, 17:30 Moscow
    expect(externalTiming(at, ALMATY).now).toBe(false)
    expect(externalTiming(at, { ...ALMATY, timeZone: 'Europe/Moscow' })).toEqual({ now: true })
    // a broken zone falls back to Almaty, never stops the delivery
    expect(externalTiming(at, { ...ALMATY, timeZone: 'Mars/Olympus' }).now).toBe(false)
  })

  it('without the settings table the window is the default Mon–Fri 09:00–19:00 Asia/Almaty', async () => {
    expect(await loadInviteWindow()).toEqual(ALMATY)
  })
})

describe('deliverInvite outside the working hours', () => {
  const invite = { id: 'i-1', title: 'Кассовый разрыв', body: 'Текст', href: '/client/point-b?tab=whatif' }

  it('the bell goes at once, the external send is deferred and recorded as pending with its due time', async () => {
    seedInvite('i-1', { delivered: null })
    const saturday = new Date('2026-10-24T10:00:00Z')
    const r = await deliverInvite(h.sb, { invite, userId: CLIENT, now: saturday, pro: true, impersonating: false }, { window: win() })
    expect(r).toEqual({ bell: true, external: 'deferred' })
    expect(n.notify).toHaveLength(1)
    expect(n.comm).toEqual([])
    expect(n.sends).toEqual([]) // the week is not spent while waiting
    expect(invites()[0].delivered).toEqual({ bell: saturday.toISOString(), external: 'pending', external_due: '2026-10-26T04:00:00.000Z', at: saturday.toISOString() })
  })

  it('nothing is deferred when it would not go out anyway: channel off, not PRO, impersonation', async () => {
    const sat = new Date('2026-10-24T10:00:00Z')
    n.recipient = { ...n.recipient, preferences: { notifications: { reminders: { email: false } } } }
    expect((await deliverInvite(h.sb, { invite, userId: CLIENT, now: sat, pro: true, impersonating: false }, { window: win() })).external).toBe('off')
    n.recipient = { ...n.recipient, preferences: {} }
    expect((await deliverInvite(h.sb, { invite, userId: CLIENT, now: sat, pro: false, impersonating: false }, { window: win() })).external).toBe('off')
    expect((await deliverInvite(h.sb, { invite, userId: CLIENT, now: sat, pro: true, impersonating: true }, { window: win() })).external).toBe('off')
  })
})

describe('deliverPendingExternal: the deferred sends in the next window', () => {
  const monday = new Date('2026-10-26T05:00:00Z') // 10:00 Almaty

  it('outside the window it does not read the invites', async () => {
    seedInvite('i-1')
    const from = vi.spyOn(h.sb, 'from')
    const r = await deliverPendingExternal(h.sb, new Date('2026-10-25T05:00:00Z'), { window: win() })
    expect(r.skipped).toBe('outside_window')
    expect(from).not.toHaveBeenCalled()
    expect(invites()[0].delivered).toMatchObject({ external: 'pending' })
  })

  it('in the window: the first pending of the user goes out, the next ones of the same ISO week are capped, closed ones dropped', async () => {
    seedInvite('i-1')
    seedInvite('i-2')
    seedInvite('i-3', { status: 'dismissed' })
    seedInvite('i-4', { expires_at: '2026-10-25T00:00:00Z' })
    seedInvite('i-5', { delivered: { external: 'sent' } }) // not pending: untouched
    seedInvite('i-6', { user_id: OTHER })
    const r = await deliverPendingExternal(h.sb, monday, { window: win(), hasPointB: async () => true })
    expect(r).toMatchObject({ processed: 5, sent: 2, capped: 1, dropped: 2, off: 0, more: false })
    const byId = Object.fromEntries(invites().map((i) => [i.id, i.delivered as Record<string, unknown>]))
    expect(byId['i-1']).toMatchObject({ external: 'sent', external_at: monday.toISOString(), bell: '2026-10-24T10:00:00.000Z' })
    expect(byId['i-2']).toMatchObject({ external: 'capped' })
    expect(byId['i-3']).toMatchObject({ external: 'dropped' })
    expect(byId['i-4']).toMatchObject({ external: 'dropped' })
    expect(byId['i-5']).toEqual({ external: 'sent' })
    expect(byId['i-6']).toMatchObject({ external: 'sent' })
    expect(n.comm.map((c) => c.userId)).toEqual([CLIENT, OTHER])
    expect(n.sends.map((s) => s.dedupe_key)).toEqual([`pb_invite_ext:${CLIENT}:2026-W44`, `pb_invite_ext:${OTHER}:2026-W44`])
    // a second sweep finds nothing
    expect((await deliverPendingExternal(h.sb, monday, { window: win() })).processed).toBe(0)
  })

  it('reads the preferences and the access again: switched off meanwhile or no Point B → off', async () => {
    seedInvite('i-1')
    seedInvite('i-2', { user_id: OTHER })
    n.recipient = { ...n.recipient, preferences: { notifications: { reminders: { email: false } } } }
    const r = await deliverPendingExternal(h.sb, monday, { window: win(), hasPointB: async (_sb, uid) => uid === CLIENT })
    expect(r).toMatchObject({ off: 2, sent: 0 })
    expect(n.comm).toEqual([])
    expect(n.sends).toEqual([])
  })

  it('at most ten per step; more = a full batch was read', async () => {
    for (let i = 0; i < 12; i++) seedInvite(`p-${i}`, { user_id: `user-${i}` })
    const first = await deliverPendingExternal(h.sb, monday, { window: win(), hasPointB: async () => true })
    expect(first).toMatchObject({ processed: 10, sent: 10, more: true })
    const second = await deliverPendingExternal(h.sb, monday, { window: win(), hasPointB: async () => true })
    expect(second).toMatchObject({ processed: 2, more: false })
  })
})

describe('runInviteSweep (Inngest pb-invite-external)', () => {
  const fakeStep = () => {
    const log: string[] = []
    return {
      log,
      step: {
        run: async <T>(id: string, fn: () => Promise<T>) => { log.push(`run:${id}`); return fn() },
        sleep: async (id: string) => { log.push(`sleep:${id}`) },
        sendEvent: async (id: string) => { log.push(`event:${id}`) },
      },
    }
  }
  const result = (more: boolean) => ({ processed: more ? 10 : 3, sent: 1, capped: 0, off: 0, dropped: 0, more })

  it('outside the window: one cheap step, no sweep', async () => {
    const { step, log } = fakeStep()
    const sweep = vi.fn()
    expect(await runInviteSweep({ step }, { inWindow: async () => false, sweep })).toEqual({ skipped: 'outside_window' })
    expect(log).toEqual(['run:window'])
    expect(sweep).not.toHaveBeenCalled()
  })

  it('batches with a sleep between, stops when a batch is not full, never more than the limit', async () => {
    const a = fakeStep()
    const replies = [result(true), result(false)]
    expect(await runInviteSweep({ step: a.step }, { inWindow: async () => true, sweep: async () => replies.shift()! })).toEqual({ processed: 13, sent: 2 })
    expect(a.log).toEqual(['run:window', 'run:batch-0', 'sleep:pause-0', 'run:batch-1'])

    const b = fakeStep()
    await runInviteSweep({ step: b.step }, { inWindow: async () => true, sweep: async () => result(true) })
    expect(b.log.filter((l) => l.startsWith('run:batch'))).toHaveLength(INVITE_SWEEP_BATCHES)
    expect(b.log.filter((l) => l.startsWith('sleep:'))).toHaveLength(INVITE_SWEEP_BATCHES - 1)
  })
})
