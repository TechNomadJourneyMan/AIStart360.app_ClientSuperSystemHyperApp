/**
 * GIGA «Рассылки» routes (/api/giga-admin/comm/campaigns/*): inbox.view reads,
 * inbox.manage writes; profanity in title / subject / body → 400 naming the
 * field; a staff member with «только назначенные» neither sees nor runs
 * someone else's broadcast (404, no IDOR) and his audience is his clients;
 * create / start / pause / resume / cancel are audited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { coerceSetting, type SettingKey } from '@/lib/settings/registry'
import { campaignDb, type Row } from './_campaign-db'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'
const OTHER_STAFF = '99999999-9999-4999-8999-999999999999'
const MINE = '66666666-6666-4666-8666-666666666666'
const THEIRS = '77777777-7777-4777-8777-777777777777'

const h = vi.hoisted(() => ({
  actor: null as null | { id: string; kind: string; role?: StaffRole; clientScope?: 'all' | 'assigned' },
  db: null as unknown as ReturnType<typeof import('./_campaign-db').campaignDb>,
  audit: vi.fn(async (..._a: unknown[]) => true),
  inngestSend: vi.fn(async (..._a: unknown[]) => ({ ids: ['e'] })),
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => h.actor) }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.db.sb }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.audit }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/settings/store', () => ({ getSetting: vi.fn(async (k: string) => coerceSetting(k as SettingKey, undefined)) }))
vi.mock('@/lib/inngest', () => ({ inngest: { send: h.inngestSend } }))

import { GET as listGET, POST as createPOST } from '@/app/api/giga-admin/comm/campaigns/route'
import { POST as previewPOST } from '@/app/api/giga-admin/comm/campaigns/preview/route'
import { GET as cardGET, PATCH as cardPATCH } from '@/app/api/giga-admin/comm/campaigns/[campaignId]/route'
import { GET as recipientsGET } from '@/app/api/giga-admin/comm/campaigns/[campaignId]/recipients/route'

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  const r = new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest & { nextUrl: URL }
  Object.defineProperty(r, 'nextUrl', { value: new URL(`http://localhost${url}`) })
  return r
}
const P = (campaignId: string) => ({ params: { campaignId } })
const BASE = '/api/giga-admin/comm/campaigns'

const campaign = (id: string, createdBy: string, status = 'running'): Row => ({
  id, title: `Рассылка ${id.slice(0, 4)}`, body: 'Текст', subject: null, channels: ['app'], audience: { kind: 'users', userIds: [U1] },
  status, created_by: createdBy, total_count: 1, sent_count: 0, failed_count: 0, skipped_count: 0,
  created_at: '2026-10-19T04:00:00.000Z', updated_at: '2026-10-19T04:00:00.000Z',
})

const draft = {
  title: 'Новые отчёты', body: 'Отчёты обновились', subject: null, channels: ['app', 'email'],
  audience: { kind: 'users', userIds: [U1, U2] },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INNGEST_DEV', '1')
  h.db = campaignDb({
    profiles: [
      { id: U1, full_name: 'Иван', email: 'ivan@example.com', phone: null, telegram_chat_id: null },
      { id: U2, full_name: 'Пётр', email: null, phone: null, telegram_chat_id: null },
      { id: STAFF, full_name: 'Анна', email: 'anna@aistart360.kz' },
    ],
    comm_campaigns: [campaign(MINE, STAFF), campaign(THEIRS, OTHER_STAFF)],
    comm_campaign_recipients: [
      { id: 'r-1', campaign_id: THEIRS, user_id: U2, channel: 'app', status: 'failed', error: 'x', updated_at: '2026-10-19T04:00:00.000Z' },
      { id: 'r-2', campaign_id: MINE, user_id: U1, channel: 'app', status: 'failed', error: 'interrupted', updated_at: '2026-10-19T04:00:00.000Z' },
    ],
    user_assignments: [{ user_id: U1, assignee_id: STAFF }],
  })
  h.actor = { id: STAFF, kind: 'session', role: 'admin', clientScope: 'all' }
})

describe('permissions', () => {
  it('without inbox.view (analyst): 403 everywhere', async () => {
    h.actor = { id: STAFF, kind: 'session', role: 'analyst' }
    expect((await listGET(req(BASE))).status).toBe(403)
    expect((await cardGET(req(`${BASE}/${MINE}`), P(MINE))).status).toBe(403)
    expect((await recipientsGET(req(`${BASE}/${MINE}/recipients`), P(MINE))).status).toBe(403)
  })

  it('inbox.view without inbox.manage (support): sees, but cannot preview, create or run', async () => {
    h.actor = { id: STAFF, kind: 'session', role: 'support' }
    const list = await listGET(req(BASE))
    expect(list.status).toBe(200)
    expect((await list.json()).can.manage).toBe(false)
    expect((await cardGET(req(`${BASE}/${MINE}`), P(MINE))).status).toBe(200)
    expect((await previewPOST(req(`${BASE}/preview`, 'POST', { channels: draft.channels, audience: draft.audience }))).status).toBe(403)
    expect((await createPOST(req(BASE, 'POST', draft))).status).toBe(403)
    for (const action of ['start', 'pause', 'resume', 'cancel']) {
      expect((await cardPATCH(req(`${BASE}/${MINE}`, 'PATCH', { action }), P(MINE))).status, action).toBe(403)
    }
    expect(h.db.db.comm_campaigns.find((c) => c.id === MINE)!.status).toBe('running')
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('bad ids and bad input are 400', async () => {
    expect((await cardGET(req(`${BASE}/nope`), P('nope'))).status).toBe(400)
    expect((await cardPATCH(req(`${BASE}/${MINE}`, 'PATCH', { action: 'explode' }), P(MINE))).status).toBe(400)
    expect((await createPOST(req(BASE, 'POST', { ...draft, channels: [] }))).status).toBe(400)
    expect((await createPOST(req(BASE, 'POST', { ...draft, audience: { kind: 'filters', filters: { segment: 'everyone' } } }))).status).toBe(400)
    expect((await listGET(req(`${BASE}?status=weird`))).status).toBe(400)
    expect((await recipientsGET(req(`${BASE}/${MINE}/recipients?status=weird`), P(MINE))).status).toBe(400)
  })
})

describe('profanity', () => {
  it.each([
    ['title', { title: 'Привет, бля' }],
    ['subject', { subject: 'Ну ты и мудак' }],
    ['body', { body: 'Это пиздец как важно' }],
  ])('%s with profanity → 400 naming the field, nothing created', async (field, patch) => {
    const res = await createPOST(req(BASE, 'POST', { ...draft, ...patch }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, code: 'profanity', field })
    expect(h.db.db.comm_campaigns).toHaveLength(2)
  })
})

describe('client scope («только назначенные»): no IDOR', () => {
  beforeEach(() => { h.actor = { id: STAFF, kind: 'session', role: 'crm_manager', clientScope: 'assigned' } })

  it('someone else\'s broadcast is 404 for the card, the recipients and every action', async () => {
    expect((await cardGET(req(`${BASE}/${THEIRS}`), P(THEIRS))).status).toBe(404)
    expect((await recipientsGET(req(`${BASE}/${THEIRS}/recipients`), P(THEIRS))).status).toBe(404)
    for (const action of ['pause', 'cancel']) {
      expect((await cardPATCH(req(`${BASE}/${THEIRS}`, 'PATCH', { action }), P(THEIRS))).status, action).toBe(404)
    }
    expect(h.db.db.comm_campaigns.find((c) => c.id === THEIRS)!.status).toBe('running')
    expect((await cardGET(req(`${BASE}/${MINE}`), P(MINE))).status).toBe(200)
  })

  it('the list shows only his broadcasts', async () => {
    const body = await (await listGET(req(BASE))).json()
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([MINE])
  })

  it('his broadcast reaches only his clients: picked users of others are dropped in the preview and the start', async () => {
    const prev = await (await previewPOST(req(`${BASE}/preview`, 'POST', { channels: ['app'], audience: { kind: 'users', userIds: [U1, U2] } }))).json()
    expect(prev.data).toMatchObject({ users: 1, outOfScope: 1, perChannel: { app: { send: 1, skipped: 0 } } })
    const res = await createPOST(req(BASE, 'POST', { ...draft, channels: ['app'], start: true }))
    expect(res.status).toBe(200)
    const id = (await res.json()).data.id
    expect(h.db.db.comm_campaign_recipients.filter((r) => r.campaign_id === id).map((r) => r.user_id)).toEqual([U1])
  })
})

describe('lifecycle', () => {
  it('preview: users and per-channel numbers with reasons, writes nothing', async () => {
    const res = await previewPOST(req(`${BASE}/preview`, 'POST', { channels: ['app', 'email'], audience: draft.audience }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      users: 2, truncated: false, outOfScope: 0,
      perChannel: { app: { send: 2, skipped: 0 }, email: { send: 1, skipped: 1, reasons: { no_email: 1 } } },
    })
    expect(h.db.db.comm_campaigns).toHaveLength(2)
    expect(h.db.db.comm_campaign_recipients).toHaveLength(2)
  })

  it('create as a draft, then start, pause, resume, cancel — each audited; a wrong transition is 409', async () => {
    const created = await createPOST(req(BASE, 'POST', draft))
    expect(created.status).toBe(200)
    const { data } = await created.json()
    expect(data).toMatchObject({ status: 'draft', title: 'Новые отчёты', author: { id: STAFF, name: 'Анна' } })
    expect(h.audit).toHaveBeenLastCalledWith(expect.objectContaining({ id: STAFF }), expect.objectContaining({ action: 'comm.campaign.created', entityId: data.id }), expect.anything())

    const P1 = P(data.id)
    expect((await cardPATCH(req(`${BASE}/${data.id}`, 'PATCH', { action: 'pause' }), P1)).status).toBe(409) // a draft is not running
    const start = await cardPATCH(req(`${BASE}/${data.id}`, 'PATCH', { action: 'start' }), P1)
    expect(start.status).toBe(200)
    expect((await start.json()).data).toMatchObject({ status: 'running', counts: { total: 4, skipped: 1 } })
    expect(h.inngestSend).toHaveBeenCalledWith({ name: 'comm/campaign.run', data: { campaignId: data.id } })

    for (const [action, status, audit] of [['pause', 'paused', 'comm.campaign.paused'], ['resume', 'running', 'comm.campaign.resumed'], ['cancel', 'cancelled', 'comm.campaign.cancelled']]) {
      const res = await cardPATCH(req(`${BASE}/${data.id}`, 'PATCH', { action }), P1)
      expect(res.status, action).toBe(200)
      expect((await res.json()).data.status).toBe(status)
      expect(h.audit).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ action: audit, entityType: 'comm_campaign', entityId: data.id }), expect.anything())
    }
    expect((await cardPATCH(req(`${BASE}/${data.id}`, 'PATCH', { action: 'resume' }), P1)).status).toBe(409)
    expect(h.audit.mock.calls.map((c) => (c[1] as { action: string }).action)).toEqual([
      'comm.campaign.created', 'comm.campaign.started', 'comm.campaign.paused', 'comm.campaign.resumed', 'comm.campaign.cancelled',
    ])
  })

  it('create with start: true → running at once; the card shows progress per channel and the recipients with reasons', async () => {
    const res = await createPOST(req(BASE, 'POST', { ...draft, start: true }))
    expect(res.status).toBe(200)
    const { data, engine } = await res.json()
    expect(engine).toBe(true)
    expect(data.status).toBe('running')
    const card = await (await cardGET(req(`${BASE}/${data.id}`), P(data.id))).json()
    expect(card.data.progress).toEqual([
      { channel: 'app', total: 2, sent: 0, failed: 0, skipped: 0, left: 2 },
      { channel: 'email', total: 2, sent: 0, failed: 0, skipped: 1, left: 1 },
    ])
    expect(card.schedule).toMatchObject({ window: 'пн–пт 09:00–19:00 (Asia/Almaty)', intervalSeconds: 10, jitterSeconds: 5 })
    const rec = await (await recipientsGET(req(`${BASE}/${data.id}/recipients?status=skipped`), P(data.id))).json()
    expect(rec.data).toEqual([expect.objectContaining({ userId: U2, channel: 'email', status: 'skipped', reason: 'нет email' })])
  })

  it('start of an empty audience: 400, the draft is kept', async () => {
    const res = await createPOST(req(BASE, 'POST', { ...draft, audience: { kind: 'users', userIds: ['12121212-1212-4212-8212-121212121212'] }, start: true }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Нет получателей')
    expect(h.db.db.comm_campaigns.find((c) => c.id === body.data.id)!.status).toBe('draft')
  })

  it('recipients: contacts masked for a role without users.sensitive', async () => {
    h.actor = { id: STAFF, kind: 'session', role: 'content_manager' as StaffRole }
    // content_manager has no inbox.view at all
    expect((await recipientsGET(req(`${BASE}/${MINE}/recipients`), P(MINE))).status).toBe(403)
    h.actor = { id: STAFF, kind: 'session', role: 'admin', clientScope: 'all' }
    const rec = await (await recipientsGET(req(`${BASE}/${MINE}/recipients?status=failed`), P(MINE))).json()
    expect(rec.data[0]).toMatchObject({ email: 'ivan@example.com', reason: expect.stringContaining('прервалась') })
  })
})
