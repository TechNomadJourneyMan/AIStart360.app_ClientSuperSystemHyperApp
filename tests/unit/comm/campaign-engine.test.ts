/**
 * Broadcast engine (lib/comm/campaigns.ts, lib/functions/comm-campaigns.ts):
 * audience expansion = the users-list filters (same admin_list_users
 * arguments as GET /api/giga-admin/users) and the client scope; start writes
 * one recipient row per user × channel (dedupe, block / opt-out skipped);
 * one tick = one user, through sendToUser (the message lands in his
 * conversation with campaign_id); working hours, pauses, pause / cancel stop
 * the engine, crashed rows are never resent, the run hands over after 150
 * steps; the watchdog stays off the DB outside the working hours.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { coerceSetting, type SettingKey } from '@/lib/settings/registry'
import { campaignDb, listUsersRpc, type Row } from './_campaign-db'
import { fakeTransports } from './_db'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '44444444-4444-4444-8444-444444444444'
const U4 = '55555555-5555-4555-8555-555555555555'
const STAFF = '33333333-3333-4333-8333-333333333333'
const CAMP = '66666666-6666-4666-8666-666666666666'

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./_campaign-db').campaignDb>,
  actor: null as null | { id: string; kind: string; role?: string; clientScope?: 'all' | 'assigned' },
  inngestSend: vi.fn(async (..._a: unknown[]) => ({ ids: ['e'] })),
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.db.sb }))
vi.mock('@/lib/settings/store', () => ({ getSetting: vi.fn(async (k: string) => coerceSetting(k as SettingKey, undefined)) }))
vi.mock('@/lib/inngest', () => ({ inngest: { send: h.inngestSend, createFunction: (cfg: unknown, fn: unknown) => ({ cfg, fn }) } }))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => h.actor as never) }
})

import { expandAudience, type Audience } from '@/lib/comm/audience'
import {
  campaignTick, changeCampaignStatus, emitCampaignRun, loadCampaign, startCampaign, type CampaignRow, type TickResult,
} from '@/lib/comm/campaigns'
import { DEFAULT_SCHEDULE } from '@/lib/comm/campaigns'
import { CAMPAIGN_SENDS_PER_RUN, campaignWatchdog, commCampaignRun, runCampaignEngine, type CampaignEngineStep } from '@/lib/functions/comm-campaigns'
import { GET as usersGET } from '@/app/api/giga-admin/users/route'

/** Local Almaty time (UTC+5). */
const almaty = (iso: string) => new Date(new Date(`${iso}Z`).getTime() - 5 * 3_600_000)
const MONDAY_10 = almaty('2026-10-19T10:00:00')
const SATURDAY = almaty('2026-10-24T12:00:00')

let clock = MONDAY_10.getTime()
const now = () => new Date(clock)

function seed(extra: Record<string, Row[]> = {}) {
  h.db = campaignDb({
    profiles: [
      { id: U1, full_name: 'Иван', email: 'ivan@example.com', phone: '+77011234567', telegram_chat_id: null, preferences: null },
      { id: U2, full_name: 'Пётр', email: null, phone: '+77017654321', telegram_chat_id: '42', preferences: null },
      { id: U3, full_name: 'Блок', email: 'blocked@example.com', phone: null, telegram_chat_id: null, preferences: null },
      { id: U4, full_name: 'Отписка', email: 'wa@example.com', phone: '+77019998877', telegram_chat_id: null, preferences: null },
    ],
    comm_threads: [
      { id: 't-1', user_id: U1, status: 'waiting_staff', staff_reply_due_at: '2026-10-19T05:30:00.000Z', unread_staff: 1, unread_user: 0, blocked_at: null, whatsapp_opt_out_at: null, last_message_preview: 'Где мой отчёт?' },
      { id: 't-3', user_id: U3, status: 'open', unread_staff: 0, unread_user: 0, blocked_at: '2026-10-01T00:00:00.000Z', whatsapp_opt_out_at: null },
      { id: 't-4', user_id: U4, status: 'open', unread_staff: 0, unread_user: 0, blocked_at: null, whatsapp_opt_out_at: '2026-10-02T00:00:00.000Z' },
    ],
    comm_campaigns: [{
      id: CAMP, title: 'Новые отчёты', body: 'Отчёты Точки А обновились — загляните в кабинет.', subject: null,
      channels: ['app', 'email', 'whatsapp'], audience: { kind: 'users', userIds: [U1, U2, U3, U4] }, status: 'draft', created_by: STAFF,
      total_count: 0, sent_count: 0, failed_count: 0, skipped_count: 0, created_at: '2026-10-19T04:00:00.000Z', updated_at: '2026-10-19T04:00:00.000Z',
    }],
    ...extra,
  }, { now })
}

const ADMIN = { id: STAFF, clientScope: 'all' as const }

async function started(transports = fakeTransports().transports) {
  const c = (await loadCampaign(h.db.sb, CAMP))!
  const emit = vi.fn(async () => true)
  const res = await startCampaign(h.db.sb, ADMIN, c, { transports, now: now(), emit })
  return { ...res, emit }
}

const tickDeps = (transports = fakeTransports().transports, rng = () => 0.5) => ({ sb: h.db.sb, transports, now: now(), schedule: DEFAULT_SCHEDULE, rng })
const recipients = () => h.db.db.comm_campaign_recipients
const rowOf = (u: string, c: string) => recipients().find((r) => r.user_id === u && r.channel === c)!

beforeEach(() => {
  vi.clearAllMocks()
  clock = MONDAY_10.getTime()
  seed()
  h.actor = { id: STAFF, kind: 'session', role: 'admin', clientScope: 'all' }
})

describe('audience expansion', () => {
  it('filters → exactly the admin_list_users arguments of the users list (parity), paged, deduplicated', async () => {
    const users = [U1, U2, U1, U3].map((id) => ({ id }))
    seed()
    h.db = campaignDb(h.db.db, { rpc: listUsersRpc(users), now })
    const filters = { q: 'ООО Ромашка', segment: 'gri_in_progress', status: 'approved', role: 'client', assignee: 'none' }
    const res = await expandAudience(h.db.sb, ADMIN, { kind: 'filters', filters })
    expect(res).toEqual({ userIds: [U1, U2, U3], truncated: false, outOfScope: 0 })

    const req = (url: string) => {
      const r = new Request(`http://localhost${url}`) as unknown as NextRequest & { nextUrl: URL }
      Object.defineProperty(r, 'nextUrl', { value: new URL(`http://localhost${url}`) })
      return r
    }
    expect((await usersGET(req(`/api/giga-admin/users?${new URLSearchParams(filters).toString()}`))).status).toBe(200)
    const strip = ({ p_limit: _l, p_offset: _o, p_sort: _s, p_dir: _d, ...rest }: Record<string, unknown>) => rest
    const [audienceCall, listCall] = [h.db.rpcCalls[0], h.db.rpcCalls[h.db.rpcCalls.length - 1]]
    expect(audienceCall.fn).toBe('admin_list_users')
    expect(strip(audienceCall.args)).toEqual(strip(listCall.args))
    expect(strip(audienceCall.args)).toMatchObject({ p_search: 'ООО Ромашка', p_segment: 'gri_in_progress', p_status: 'approved', p_role: 'client' })
  })

  it('«Мои клиенты» is the author; an audience above the limit is flagged', async () => {
    const many = Array.from({ length: 5003 }, (_, i) => ({ id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }))
    h.db = campaignDb(h.db.db, { rpc: listUsersRpc(many), now })
    const res = await expandAudience(h.db.sb, ADMIN, { kind: 'filters', filters: { q: '', segment: '', status: '', role: '', assignee: STAFF } })
    expect(res.truncated).toBe(true)
    expect(res.userIds).toHaveLength(5000)
    expect(h.db.rpcCalls[0].args.p_assignee).toBe(STAFF)
  })

  it('client scope «только назначенные»: other people\'s clients are not reached (filters and hand-picked)', async () => {
    h.db = campaignDb({ ...h.db.db, user_assignments: [{ user_id: U1, assignee_id: STAFF }] }, { rpc: listUsersRpc([{ id: U1 }, { id: U2 }]), now })
    const scoped = { id: STAFF, clientScope: 'assigned' as const }
    expect((await expandAudience(h.db.sb, scoped, { kind: 'filters', filters: { q: '', segment: '', status: '', role: '', assignee: '' } })).userIds).toEqual([U1])
    expect(await expandAudience(h.db.sb, scoped, { kind: 'users', userIds: [U1, U2, U3] })).toEqual({ userIds: [U1], truncated: false, outOfScope: 2 })
  })
})

describe('start', () => {
  it('writes one row per user × channel, skipped with the reason where the user cannot be reached; running; the engine is woken', async () => {
    const { campaign, emit } = await started()
    expect(campaign).toMatchObject({ status: 'running', total_count: 12, sent_count: 0, failed_count: 0 })
    expect(recipients()).toHaveLength(12)
    expect(new Set(recipients().map((r) => `${r.user_id}:${r.channel}`)).size).toBe(12)
    expect(rowOf(U1, 'whatsapp')).toMatchObject({ status: 'pending', error: null })
    expect(rowOf(U2, 'email')).toMatchObject({ status: 'skipped', error: 'no_email' })
    for (const c of ['app', 'email', 'whatsapp']) expect(rowOf(U3, c)).toMatchObject({ status: 'skipped', error: 'blocked' })
    expect(rowOf(U4, 'whatsapp')).toMatchObject({ status: 'skipped', error: 'whatsapp_opt_out' })
    expect(campaign.skipped_count).toBe(5)
    expect(emit).toHaveBeenCalledWith(CAMP)
    // The queue order is the audience order, one user's channels together.
    expect(rowOf(U1, 'app').scheduled_for! < rowOf(U2, 'app').scheduled_for!).toBe(true)
    expect(rowOf(U1, 'app').scheduled_for).toBe(rowOf(U1, 'email').scheduled_for)
  })

  it('only a draft starts, and two «Запустить» at once write the recipients once', async () => {
    const draft = (await loadCampaign(h.db.sb, CAMP))!
    const emit = vi.fn(async () => true)
    const transports = fakeTransports().transports
    const results = await Promise.allSettled([
      startCampaign(h.db.sb, ADMIN, draft, { transports, now: now(), emit }),
      startCampaign(h.db.sb, ADMIN, draft, { transports, now: now(), emit }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(recipients()).toHaveLength(12)
    await expect(startCampaign(h.db.sb, ADMIN, (await loadCampaign(h.db.sb, CAMP))!, { transports, emit })).rejects.toThrow('черновик')
  })

  it('an empty audience is refused and the draft stays a draft', async () => {
    h.db.db.comm_campaigns[0].audience = { kind: 'users', userIds: ['99999999-9999-4999-8999-999999999999'] }
    await expect(started()).rejects.toThrow('Нет получателей')
    expect(h.db.db.comm_campaigns[0].status).toBe('draft')
  })
})

describe('tick: one user at a time', () => {
  it('outside the working hours: waits until the next window, claims nothing', async () => {
    await started()
    clock = SATURDAY.getTime()
    const r = await campaignTick(CAMP, tickDeps())
    expect(r).toEqual({ action: 'wait', until: almaty('2026-10-26T09:00:00').toISOString() })
    expect(recipients().filter((x) => x.status === 'sending' || x.status === 'sent')).toHaveLength(0)
  })

  it('sends all pending channels of the next user as one message group in his conversation (system author: the thread keeps waiting for staff)', async () => {
    await started()
    const { transports, sent } = fakeTransports()
    const r = await campaignTick(CAMP, tickDeps(transports, () => 0.5))
    expect(r).toEqual({ action: 'sent', userId: U1, sent: 3, failed: 0, skipped: 0, pauseMs: 12_500 })
    expect(sent.map((s) => s.channel).sort()).toEqual(['app', 'email', 'whatsapp'])
    expect(sent.find((s) => s.channel === 'app')!.input.title).toBe('Новые отчёты')
    expect(sent.find((s) => s.channel === 'email')!.input.subject).toBe('Новые отчёты')

    const msgs = h.db.db.comm_messages
    expect(msgs).toHaveLength(3)
    expect(new Set(msgs.map((m) => m.group_id)).size).toBe(1)
    expect(msgs.every((m) => m.campaign_id === CAMP && m.thread_id === 't-1' && m.author_kind === 'system' && m.direction === 'out')).toBe(true)
    for (const c of ['app', 'email', 'whatsapp']) {
      const row = rowOf(U1, c)
      expect(row).toMatchObject({ status: 'sent', error: null, attempts: 1 })
      expect(msgs.some((m) => m.id === row.message_id && m.channel === c)).toBe(true)
    }
    const thread = h.db.db.comm_threads.find((t) => t.id === 't-1')!
    expect(thread).toMatchObject({ status: 'waiting_staff', staff_reply_due_at: '2026-10-19T05:30:00.000Z', last_message_preview: 'Где мой отчёт?', unread_user: 1 })
    expect(h.db.db.comm_campaigns[0]).toMatchObject({ sent_count: 3, failed_count: 0, skipped_count: 5 })
  })

  it('runs to the end: nobody gets a channel twice, skipped rows are never sent, exact counters, done', async () => {
    await started()
    const { transports, sent } = fakeTransports({ fail: ['email'] })
    const results: TickResult[] = []
    for (let i = 0; i < 10; i++) {
      const r = await campaignTick(CAMP, tickDeps(transports))
      results.push(r)
      if (r.action === 'done') break
    }
    expect(results.map((r) => r.action)).toEqual(['sent', 'sent', 'sent', 'done'])
    expect(results.filter((r) => r.action === 'sent').map((r) => (r as { userId: string }).userId)).toEqual([U1, U2, U4])
    const perUserChannel = sent.map((s) => `${s.input.userId ?? s.input.chatId ?? s.input.jid}:${s.channel}`)
    expect(new Set(perUserChannel).size).toBe(perUserChannel.length)
    expect(h.db.db.comm_messages.filter((m) => m.channel === 'email' && m.thread_id === 't-3')).toHaveLength(0)
    expect(rowOf(U1, 'email')).toMatchObject({ status: 'failed', error: 'email_down' })
    expect(rowOf(U4, 'whatsapp')).toMatchObject({ status: 'skipped', error: 'whatsapp_opt_out' })
    // U1 app+whatsapp, U2 app+whatsapp, U4 app sent; U1 and U4 email failed; 5 skipped at start.
    expect(h.db.db.comm_campaigns[0]).toMatchObject({ status: 'done', total_count: 12, sent_count: 5, failed_count: 2, skipped_count: 5 })
    expect(h.db.db.comm_campaigns[0].finished_at).toBeTruthy()
    expect(await campaignTick(CAMP, tickDeps(transports))).toEqual({ action: 'stop', reason: 'not_running' })
  })

  it('a user blocked after the start is skipped at send time, nothing is sent to him', async () => {
    await started()
    h.db.db.comm_threads.find((t) => t.id === 't-1')!.blocked_at = '2026-10-19T04:59:00.000Z'
    const { transports, sent } = fakeTransports()
    expect(await campaignTick(CAMP, tickDeps(transports))).toMatchObject({ action: 'sent', userId: U1, sent: 0, skipped: 3 })
    expect(sent).toHaveLength(0)
    expect(rowOf(U1, 'app')).toMatchObject({ status: 'skipped', error: 'blocked' })
  })

  it('pause and cancel stop the engine before the next send; cancel marks the queue', async () => {
    await started()
    const { transports, sent } = fakeTransports()
    await campaignTick(CAMP, tickDeps(transports))
    expect(await changeCampaignStatus(h.db.sb, (await loadCampaign(h.db.sb, CAMP))!, 'pause')).toMatchObject({ status: 'paused' })
    expect(await campaignTick(CAMP, tickDeps(transports))).toEqual({ action: 'stop', reason: 'not_running' })
    const emit = vi.fn(async () => true)
    expect(await changeCampaignStatus(h.db.sb, (await loadCampaign(h.db.sb, CAMP))!, 'resume', { emit })).toMatchObject({ status: 'running' })
    expect(emit).toHaveBeenCalledWith(CAMP)
    expect(await changeCampaignStatus(h.db.sb, (await loadCampaign(h.db.sb, CAMP))!, 'resume', { emit })).toBeNull() // not paused any more
    await changeCampaignStatus(h.db.sb, (await loadCampaign(h.db.sb, CAMP))!, 'cancel')
    expect(await campaignTick(CAMP, tickDeps(transports))).toEqual({ action: 'stop', reason: 'not_running' })
    expect(sent.filter((s) => s.channel === 'app')).toHaveLength(1)
    expect(recipients().filter((r) => r.status === 'pending')).toHaveLength(0)
    expect(rowOf(U2, 'app')).toMatchObject({ status: 'cancelled' })
    expect(await changeCampaignStatus(h.db.sb, (await loadCampaign(h.db.sb, CAMP))!, 'pause')).toBeNull()
  })

  it('a row left in «sending» by a crashed step is never resent: fresh → wait, old → failed «interrupted», then done', async () => {
    await started()
    for (const r of recipients()) if (r.status === 'pending') Object.assign(r, { status: 'sent' })
    Object.assign(rowOf(U1, 'app'), { status: 'sending', updated_at: new Date(clock - 60_000).toISOString() })
    const { transports, sent } = fakeTransports()
    const r = await campaignTick(CAMP, tickDeps(transports))
    expect(r.action).toBe('wait')
    expect(h.db.db.comm_campaigns[0].status).toBe('running')
    clock += 6 * 60_000
    expect(await campaignTick(CAMP, tickDeps(transports))).toEqual({ action: 'done' })
    expect(rowOf(U1, 'app')).toMatchObject({ status: 'failed', error: 'interrupted' })
    expect(sent).toHaveLength(0)
    expect(h.db.db.comm_campaigns[0]).toMatchObject({ status: 'done', failed_count: 1 })
  })
})

describe('Inngest engine', () => {
  function fakeStep(onSleep?: (i: number) => void) {
    const log: string[] = []
    const sleeps: number[] = []
    const events: Array<{ name: string; data: Record<string, unknown> }> = []
    let n = 0
    const step: CampaignEngineStep = {
      run: async (id, fn) => { log.push(id); return fn() },
      sleep: async (id, ms) => { log.push(id); sleeps.push(ms); clock += ms; onSleep?.(n++) },
      sleepUntil: async (id, at) => { log.push(`${id}@${new Date(at).toISOString()}`); clock = new Date(at).getTime() },
      sendEvent: async (id, payload) => { log.push(id); events.push(payload) },
    }
    return { step, log, sleeps, events }
  }

  it('config: one step at a time overall, one run per campaign, triggered by comm/campaign.run', () => {
    const cfg = (commCampaignRun as unknown as { cfg: Record<string, unknown> }).cfg
    expect(cfg).toMatchObject({
      id: 'comm-campaign-run',
      concurrency: [{ limit: 1 }, { key: 'event.data.campaignId', limit: 1 }],
      singleton: { key: 'event.data.campaignId', mode: 'cancel' },
      triggers: [{ event: 'comm/campaign.run' }],
    })
  })

  it('sleeps until the window, then one user per step with a 10–15 s pause between, then done', async () => {
    await started()
    clock = SATURDAY.getTime()
    const { transports } = fakeTransports()
    const { step, log, sleeps } = fakeStep()
    const tick = (id: string) => campaignTick(id, { sb: h.db.sb, transports, now: now(), schedule: DEFAULT_SCHEDULE })
    const res = await runCampaignEngine({ event: { data: { campaignId: CAMP } }, step }, { tick })
    expect(res).toEqual({ done: true, sent: 3 })
    expect(log[1]).toBe(`window-0@${almaty('2026-10-26T09:00:00').toISOString()}`)
    expect(sleeps).toHaveLength(3)
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(10_000)
      expect(ms).toBeLessThanOrEqual(15_000)
    }
    expect(h.db.db.comm_campaigns[0].status).toBe('done')
  })

  it('«Пауза» during a pause: the next step sees it and the run ends — nobody else gets the message', async () => {
    await started()
    const { transports, sent } = fakeTransports()
    const { step } = fakeStep((i) => { if (i === 0) h.db.db.comm_campaigns[0].status = 'paused' })
    const tick = (id: string) => campaignTick(id, { sb: h.db.sb, transports, now: now(), schedule: DEFAULT_SCHEDULE })
    expect(await runCampaignEngine({ event: { data: { campaignId: CAMP } }, step }, { tick })).toEqual({ stopped: 'not_running', sent: 1 })
    expect(new Set(sent.map((s) => s.input.userId).filter(Boolean))).toEqual(new Set([U1]))
  })

  it(`hands over to a fresh run after ${CAMPAIGN_SENDS_PER_RUN} steps (per-run step limit)`, async () => {
    const { step, log, events } = fakeStep()
    const tick = vi.fn(async (): Promise<TickResult> => ({ action: 'sent', userId: U1, sent: 1, failed: 0, skipped: 0, pauseMs: 10_000 }))
    expect(await runCampaignEngine({ event: { data: { campaignId: CAMP } }, step }, { tick })).toEqual({ continued: true, sent: CAMPAIGN_SENDS_PER_RUN })
    expect(tick).toHaveBeenCalledTimes(CAMPAIGN_SENDS_PER_RUN)
    expect(events).toEqual([{ name: 'comm/campaign.run', data: { campaignId: CAMP } }])
    expect(log.length).toBeLessThan(400)
  })

  it('an event without a campaign id does nothing', async () => {
    const { step, log } = fakeStep()
    expect(await runCampaignEngine({ event: { data: { campaignId: 'x' } }, step })).toEqual({ skipped: 'no campaignId' })
    expect(log).toHaveLength(0)
  })

  it('emitCampaignRun: sends the event only when Inngest is configured', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', '')
    vi.stubEnv('INNGEST_DEV', '')
    expect(await emitCampaignRun(CAMP)).toBe(false)
    vi.stubEnv('INNGEST_DEV', '1')
    expect(await emitCampaignRun(CAMP)).toBe(true)
    expect(h.inngestSend).toHaveBeenCalledWith({ name: 'comm/campaign.run', data: { campaignId: CAMP } })
    vi.unstubAllEnvs()
  })
})

describe('watchdog', () => {
  const running = (id: string, updated: string, status = 'running'): Row => ({ id, status, updated_at: updated, created_at: updated, title: 't', body: 'b', channels: ['app'], audience: {} })

  it('outside the working hours (and in the first 15 minutes) it does not touch the database', async () => {
    const emit = vi.fn(async () => true)
    for (const at of [SATURDAY, almaty('2026-10-19T09:05:00'), almaty('2026-10-19T20:00:00')]) {
      seed({ comm_campaigns: [running(CAMP, '2026-10-01T00:00:00.000Z')] })
      expect(await campaignWatchdog({ now: at, emit })).toEqual({ skipped: 'outside_window' })
      expect(h.db.queries).toHaveLength(0)
    }
    expect(emit).not.toHaveBeenCalled()
  })

  it('in the window: re-emits running campaigns that went quiet, not fresh or paused ones', async () => {
    const stale = '77777777-7777-4777-8777-777777777777'
    seed({ comm_campaigns: [
      running(stale, new Date(MONDAY_10.getTime() - 30 * 60_000).toISOString()),
      running(CAMP, new Date(MONDAY_10.getTime() - 60_000).toISOString()),
      running('88888888-8888-4888-8888-888888888888', '2026-10-01T00:00:00.000Z', 'paused'),
    ] })
    const emit = vi.fn(async () => true)
    expect(await campaignWatchdog({ now: MONDAY_10, emit })).toEqual({ stale: 1, revived: 1 })
    expect(emit).toHaveBeenCalledWith(stale)
    expect(h.db.queries).toHaveLength(1)
  })
})

// Keep the type import used (the audience shape stored on a campaign).
export type _A = Audience | CampaignRow
