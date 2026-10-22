/**
 * Point B Ф6a, Task 5: personal invites — creation with caps and dedupe, delivery (bell / external once per
 * ISO week), the rule runner and the invite of a verified recommendation. In-memory DB (column names of
 * migration 129); notifyClient, the automation journal, the access gates and impersonation are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InsightCandidate } from '@/lib/point-b/insights/rules'
import type { Recommendation } from '@/lib/point-b/recs/types'
import { pbDb } from './_pbdb'

const n = vi.hoisted(() => ({
  notify: [] as Array<{ dedupeKey?: string | null; category: string; channels?: Record<string, boolean>; title: string }>,
  sends: [] as Array<{ id: string; dedupe_key: string | null; kind: string }>,
  recipient: { id: 'u', email: 'owner@example.com', fullName: 'Владелец', telegramChatId: null as string | null, preferences: {} as unknown },
  externalFails: false,
  journalDown: false,
  gates: false,
  tier: 'pro' as 'pro' | 'free',
  impersonating: false,
}))

vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: vi.fn(async (input: { dedupeKey?: string | null; category: string; channels?: Record<string, boolean>; title: string }) => {
    n.notify.push(input)
    const ch = input.channels ?? {}
    const ext = !n.externalFails
    return { ok: true, delivered: { inApp: ch.inApp !== false, email: ext && ch.email === true, telegram: ext && ch.telegram === true } }
  }),
}))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: vi.fn(async () => n.recipient),
  claimSend: vi.fn(async (input: { dedupeKey: string | null; kind: string }) => {
    if (n.journalDown) return { result: 'unavailable', id: null }
    if (input.dedupeKey && n.sends.some((s) => s.dedupe_key === input.dedupeKey)) return { result: 'duplicate', id: null }
    const id = `send-${n.sends.length + 1}`
    n.sends.push({ id, dedupe_key: input.dedupeKey, kind: input.kind })
    return { result: 'claimed', id }
  }),
  releaseSend: vi.fn(async (id: string) => { n.sends = n.sends.filter((s) => s.id !== id) }),
}))
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => n.gates }))
vi.mock('@/lib/access/server', async () => {
  const { entitlementsFor } = await import('@/lib/access/entitlements')
  return { readEntitlements: async () => entitlementsFor(n.tier) }
})
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (n.impersonating ? { sid: 's', uid: 'x' } : null) }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))

const { createInvites, listActiveInvites, patchInvite } = await import('@/lib/point-b/invites/store')
const { deliverInvite, isoWeek } = await import('@/lib/point-b/invites/deliver')
const { inviteFromVerifiedRecommendation, runInviteRules } = await import('@/lib/point-b/invites/run')

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER = 'cccccccc-0000-4000-8000-000000000002'
const COMPANY = 'company-1'
const NOW = new Date('2026-10-22T09:00:00Z') // Thursday, ISO week 2026-W43
const DAY = 86_400_000
const at = (days: number) => new Date(NOW.getTime() + days * DAY)

let h: ReturnType<typeof pbDb>
const invites = () => h.db.pb_invites as Array<Record<string, unknown>>

const cand = (ruleKey: string, over: Partial<InsightCandidate> = {}): InsightCandidate => ({
  ruleKey, dedupeKey: `${ruleKey}:moderate`, kind: 'insight', title: `Инсайт ${ruleKey}`, body: 'Текст', href: '/client/point-b?tab=whatif',
  priority: 3, display: 'card', why: 'Потому что', sourceRefs: [{ type: 'scenario', ref: 'moderate', label: 'Сценарий «Умеренный»' }], expiresInDays: 14, ...over,
})
const create = (candidates: InsightCandidate[], now = NOW, userId = CLIENT) => createInvites(h.sb, { companyId: COMPANY, userId, candidates, now })

const metric = (key: string, value: number) => ({ company_id: COMPANY, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })
const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })
const goalsSnap = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: null, baselineValue: null, baselinePeriod: null, targetValue: 120_000_000, deadline: null, reviewStatus: 'verified' }] }

/** The golden funnel client (60M → 120M in 12 months, 300 leads × 12% × 140 000 ₸, 10 employees) with a published plan. */
function seedClient(opts: { goal?: boolean; published?: boolean } = {}) {
  h = pbDb({
    // public.companies is a Prisma-era table: camelCase timestamps.
    companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
    profiles: [{ id: CLIENT, role: 'client', full_name: 'Клиент Один', tier: 'pro', feature_flags: {} }],
    metric_targets: opts.goal === false ? [] : [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: null, note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: NOW.toISOString(), created_at: NOW.toISOString(),
    }],
    pb_goal_reviews: opts.goal === false ? [] : [{ id: 'gr-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', status: 'verified', proposed_value: 120_000_000, created_at: '2026-10-10T00:00:00Z' }],
    metrics: [
      metric(REVENUE, 60_000_000), metric('biz.marketing.lidov_v_mes', 300), metric('biz.marketing.konversiya_lid_klient', 12),
      metric('biz.prodazhi.sredniy_chek', 140_000), metric('biz.hr.kol_vo_sotrudnikov', 10),
    ],
    diagnostics: [{
      id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z', overall_score: 55, health_index: 50, stage: 'growth',
      finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
    }],
    point_a_snapshots: [{ id: 'snap-1', company_id: COMPANY, engine: 'v4', confidence: 0.6, coverage: 0.7, created_at: '2026-10-10T00:00:00Z', blocks: [{ key: 'finance', score: 60 }], inputs: {} }],
    point_b_versions: [],
    pb_plans: opts.published === false ? [] : [{ id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: 'v-1', published_version_id: 'v-1', settings: {}, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
    pb_plan_versions: opts.published === false ? [] : [{
      id: 'v-1', plan_id: 'plan-1', version: 1, status: 'approved', base_snapshot_id: null, goals: goalsSnap, assumptions: {}, scenarios: [], selected_scenario: 'moderate',
      strategy: {}, risks: [], expert_notes: null, change_reason: 'Первый план', author_id: null, author_name: 'Алия', author_kind: 'expert',
      submitted_at: '2026-10-10T00:00:00Z', approved_by: 'a', approved_at: '2026-10-11T00:00:00Z', approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null, created_at: '2026-10-09T00:00:00Z',
    }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h = pbDb()
  n.notify.length = 0
  n.sends = []
  n.recipient = { id: CLIENT, email: 'owner@example.com', fullName: 'Владелец', telegramChatId: null, preferences: {} }
  n.externalFails = false
  n.journalDown = false
  n.gates = false
  n.tier = 'pro'
  n.impersonating = false
})

describe('createInvites / listActiveInvites / patchInvite', () => {
  it('the same dedupe key is not created twice while active', async () => {
    const first = await create([cand('cash_gap')])
    expect(first.created).toHaveLength(1)
    expect(invites()[0]).toMatchObject({ user_id: CLIENT, company_id: COMPANY, rule_key: 'cash_gap', dedupe_key: 'cash_gap:moderate', status: 'new', kind: 'insight', display: 'card' })
    expect(invites()[0].expires_at).toBe(at(14).toISOString())
    expect(await create([cand('cash_gap')])).toEqual({ created: [], skipped: [{ ruleKey: 'cash_gap', reason: 'duplicate' }] })
    // seen / snoozed are still active
    await patchInvite(h.sb, { id: first.created[0].id, userId: CLIENT, action: 'snooze', days: 3, now: NOW })
    expect((await create([cand('cash_gap')])).skipped).toEqual([{ ruleKey: 'cash_gap', reason: 'duplicate' }])
    // another subject of the same rule is another invite
    expect((await create([cand('cash_gap', { dedupeKey: 'cash_gap:moderate:m5' })])).created).toHaveLength(1)
    // acted frees the key; the unique index of the double catches a race as a duplicate too
    await patchInvite(h.sb, { id: first.created[0].id, userId: CLIENT, action: 'acted', now: NOW })
    expect((await create([cand('cash_gap')])).created).toHaveLength(1)
  })

  it('a rule dismissed 10 days ago is skipped, 15 days ago is allowed', async () => {
    const { created } = await create([cand('staff_load')])
    expect(await patchInvite(h.sb, { id: created[0].id, userId: CLIENT, action: 'dismiss', now: NOW })).toBe(true)
    expect(invites()[0]).toMatchObject({ status: 'dismissed', snoozed_until: at(14).toISOString() })
    // another subject of the same RULE is paused too
    expect(await create([cand('staff_load', { dedupeKey: 'staff_load:moderate:12' })], at(10))).toEqual({ created: [], skipped: [{ ruleKey: 'staff_load', reason: 'dismissed_recently' }] })
    expect((await create([cand('cash_gap')], at(10))).created).toHaveLength(1) // other rules are not
    expect((await create([cand('staff_load', { dedupeKey: 'staff_load:moderate:12' })], at(15))).created).toHaveLength(1)
    // a repeated dismiss of a closed invite is accepted without a write
    expect(await patchInvite(h.sb, { id: created[0].id, userId: CLIENT, action: 'dismiss', now: NOW })).toBe(true)
    expect(await patchInvite(h.sb, { id: created[0].id, userId: CLIENT, action: 'seen', now: NOW })).toBe(false)
  })

  it('at most 3 active cards per user: the 4th is skipped with cap', async () => {
    const r = await create([cand('a', { priority: 4 }), cand('b', { priority: 1 }), cand('c', { priority: 2 }), cand('d', { priority: 3 })])
    // the most important three win
    expect(r.created.map((c) => c.ruleKey)).toEqual(['b', 'c', 'd'])
    expect(r.skipped).toEqual([{ ruleKey: 'a', reason: 'cap' }])
    expect((await create([cand('e', { priority: 0 })])).skipped).toEqual([{ ruleKey: 'e', reason: 'cap' }])
    // another user has his own cap
    expect((await create([cand('e')], NOW, OTHER)).created).toHaveLength(1)
    const list = await listActiveInvites(h.sb, CLIENT, NOW)
    expect(list.map((i) => i.title)).toEqual(['Инсайт b', 'Инсайт c', 'Инсайт d'])
    expect(list[0]).toEqual({
      id: expect.any(String), kind: 'insight', title: 'Инсайт b', body: 'Текст', href: '/client/point-b?tab=whatif', why: 'Потому что',
      sourceRefs: [{ type: 'scenario', ref: 'moderate', label: 'Сценарий «Умеренный»' }], display: 'card', createdAt: expect.any(String),
    })
  })

  it('snooze 7 days hides the invite until the date', async () => {
    const { created } = await create([cand('cash_gap')])
    expect(await patchInvite(h.sb, { id: created[0].id, userId: CLIENT, action: 'snooze', days: 7, now: NOW })).toBe(true)
    expect(await listActiveInvites(h.sb, CLIENT, at(6))).toEqual([])
    expect((await listActiveInvites(h.sb, CLIENT, at(7))).map((i) => i.id)).toEqual([created[0].id])
    // only 3 / 7 / 30
    expect(await patchInvite(h.sb, { id: created[0].id, userId: CLIENT, action: 'snooze', days: 5, now: NOW })).toBe(false)
    // seen after the snooze is over brings it back as seen
    expect(await patchInvite(h.sb, { id: created[0].id, userId: CLIENT, action: 'seen', now: at(8) })).toBe(true)
    expect(invites()[0]).toMatchObject({ status: 'seen', snoozed_until: null })
  })

  it('expired invites are not listed', async () => {
    await create([cand('finmodel_gap', { expiresInDays: 30 }), cand('cash_gap', { expiresInDays: 14 })])
    expect((await listActiveInvites(h.sb, CLIENT, at(13))).length).toBe(2)
    expect((await listActiveInvites(h.sb, CLIENT, at(14))).map((i) => i.title)).toEqual(['Инсайт finmodel_gap'])
    // creating later marks the expired one and frees its dedupe key
    expect((await create([cand('cash_gap')], at(15))).created).toHaveLength(1)
    expect(invites().filter((r) => r.rule_key === 'cash_gap').map((r) => r.status)).toEqual(['expired', 'new'])
  })

  it('patch works only on the owner’s invite', async () => {
    const { created } = await create([cand('cash_gap')])
    expect(await patchInvite(h.sb, { id: created[0].id, userId: OTHER, action: 'dismiss', now: NOW })).toBe(false)
    expect(await patchInvite(h.sb, { id: 'missing', userId: CLIENT, action: 'seen', now: NOW })).toBe(false)
    expect(invites()[0].status).toBe('new')
    expect(await patchInvite(h.sb, { id: created[0].id, userId: CLIENT, action: 'seen', now: NOW })).toBe(true)
    expect(invites()[0].status).toBe('seen')
  })
})

describe('deliverInvite', () => {
  const invite = (id: string) => ({ id, title: 'Кассовый разрыв в месяце 5', body: 'Текст', href: '/client/point-b?tab=whatif' })

  it('deliver: bell always, external at most once per ISO week and only when the category channel is enabled; second invite in the same week is capped', async () => {
    expect(isoWeek(NOW)).toBe('2026-W43')
    expect(isoWeek(new Date('2026-10-19T00:00:00Z'))).toBe('2026-W43') // Monday
    expect(isoWeek(new Date('2026-10-26T00:00:00Z'))).toBe('2026-W44')
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53')

    // reminders: email ON by default → the first invite of the week goes out
    const first = await deliverInvite(h.sb, { invite: invite('i-1'), userId: CLIENT, now: NOW, pro: true, impersonating: false })
    expect(first).toEqual({ bell: true, external: 'sent' })
    expect(n.notify[0]).toMatchObject({ category: 'reminders', dedupeKey: 'pb_invite:i-1:app', channels: { email: false, telegram: false } })
    expect(n.notify[1]).toMatchObject({ category: 'reminders', dedupeKey: 'pb_invite:i-1:ext', channels: { inApp: false, email: true, telegram: false } })
    expect(n.sends.map((s) => s.dedupe_key)).toEqual([`pb_invite_ext:${CLIENT}:2026-W43`])

    // the second invite of the same week: bell only
    expect(await deliverInvite(h.sb, { invite: invite('i-2'), userId: CLIENT, now: at(3), pro: true, impersonating: false })).toEqual({ bell: true, external: 'capped' })
    expect(n.notify.filter((x) => x.dedupeKey?.endsWith(':ext'))).toHaveLength(1)
    // next week: again one
    expect((await deliverInvite(h.sb, { invite: invite('i-3'), userId: CLIENT, now: at(5), pro: true, impersonating: false })).external).toBe('sent')

    // the client switched email off for «Напоминания» → no external, the week is not spent
    n.sends = []
    n.recipient = { ...n.recipient, preferences: { notifications: { reminders: { email: false } } } }
    expect(await deliverInvite(h.sb, { invite: invite('i-4'), userId: CLIENT, now: NOW, pro: true, impersonating: false })).toEqual({ bell: true, external: 'off' })
    expect(n.sends).toEqual([])

    // a recommendation invite uses the «Эксперт» category
    n.recipient = { ...n.recipient, preferences: {} }
    await deliverInvite(h.sb, { invite: { ...invite('i-5'), kind: 'recommendation' }, userId: CLIENT, now: NOW, pro: true, impersonating: false })
    expect(n.notify.at(-1)).toMatchObject({ category: 'expert' })

    // not PRO → bell only
    n.sends = []
    expect(await deliverInvite(h.sb, { invite: invite('i-6'), userId: CLIENT, now: NOW, pro: false, impersonating: false })).toEqual({ bell: true, external: 'off' })
    // a failed external send gives the week back
    n.externalFails = true
    expect((await deliverInvite(h.sb, { invite: invite('i-7'), userId: CLIENT, now: NOW, pro: true, impersonating: false })).external).toBe('off')
    expect(n.sends).toEqual([])
    // without the journal nothing goes out (the cap cannot be kept)
    n.externalFails = false
    n.journalDown = true
    expect((await deliverInvite(h.sb, { invite: invite('i-8'), userId: CLIENT, now: NOW, pro: true, impersonating: false })).external).toBe('capped')
  })

  it('no outgoing channel for impersonation', async () => {
    const r = await deliverInvite(h.sb, { invite: invite('i-1'), userId: CLIENT, now: NOW, pro: true, impersonating: true })
    expect(r.external).toBe('off')
    expect(n.notify.every((x) => x.channels?.email === false && x.channels?.telegram === false)).toBe(true)
    expect(n.sends).toEqual([])
  })
})

describe('runInviteRules', () => {
  it('runInviteRules creates insights from the model, does nothing at level 0, for a free tier with gates on, or while impersonating', async () => {
    seedClient()
    const r = await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: NOW })
    // golden: conversion +25,8% (priority 2), 10 new employees (3), the finmodel is empty (4) → all three fit the cap
    expect(r).toEqual({ created: 3, skipped: 0 })
    expect(invites().map((i) => i.rule_key)).toEqual(['conversion_gap', 'staff_load', 'finmodel_gap'])
    expect(invites()[0]).toMatchObject({ title: 'Цель требует роста конверсии с 12,0% до 15,1%', href: '/client/point-b?tab=strategy', kind: 'insight' })
    // every new invite was delivered: a bell each, one external for the week
    expect(n.notify.filter((x) => x.dedupeKey?.endsWith(':app'))).toHaveLength(3)
    expect(n.notify.filter((x) => x.dedupeKey?.endsWith(':ext'))).toHaveLength(1)
    expect(invites()[0].delivered).toMatchObject({ external: 'sent' })
    // a second run creates nothing new (dedupe)
    expect(await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: at(1) })).toEqual({ created: 0, skipped: 3 })

    seedClient({ goal: false })
    expect(await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: NOW })).toEqual({ created: 0, skipped: 0 })
    expect(invites()).toEqual([])

    seedClient()
    n.gates = true
    n.tier = 'free'
    expect(await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: NOW })).toEqual({ created: 0, skipped: 0 })
    n.tier = 'pro'
    expect((await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: NOW })).created).toBe(3)

    seedClient()
    n.impersonating = true
    expect(await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: NOW })).toEqual({ created: 0, skipped: 0 })
    n.impersonating = false
    expect(await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: NOW, impersonating: true })).toEqual({ created: 0, skipped: 0 })
    expect(invites()).toEqual([])

    // without a published plan the invites have nothing to speak about
    seedClient({ published: false })
    expect(await runInviteRules(h.sb, { userId: CLIENT, companyId: COMPANY, now: NOW })).toEqual({ created: 0, skipped: 0 })
  })

  it('runInviteRules without migration 129 returns 0/0 and does not throw', async () => {
    seedClient()
    const real = h.sb
    const broken = {
      from: (t: string) => {
        if (t !== 'pb_invites') return real.from(t)
        const q: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'order', 'limit', 'lt', 'update', 'insert']) q[m] = () => q
        q.single = async () => ({ data: null, error: { code: '42P01' } })
        q.maybeSingle = q.single
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42P01' } }).then(res)
        return q
      },
    } as unknown as typeof real
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await runInviteRules(broken, { userId: CLIENT, companyId: COMPANY, now: NOW })).toEqual({ created: 0, skipped: 0 })
    // quietly: a missing table is not an error worth logging
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('[point-b/invites]'))).toEqual([])
    errors.mockRestore()
    expect(n.notify).toEqual([])
  })
})

describe('inviteFromVerifiedRecommendation', () => {
  const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
    id: 'rec-1', companyId: COMPANY, versionId: null, kind: 'lever', title: 'Поднять конверсию', essence: 'Суть рекомендации.', reason: 'Причина',
    expectedEffect: null, resources: null, confidence: 'medium', confidenceReason: null, risks: null, nextAction: 'Разобрать воронку',
    sourceRefs: [{ type: 'metric', ref: 'biz.marketing.konversiya_lid_klient', label: 'Конверсия' }], status: 'expert_verified', generatedBy: 'ai',
    inputsHash: 'h', recVersion: 1, supersedesId: null, reviewerName: 'Алия Эксперт', reviewerSpecialty: 'Продажи', reviewedAt: '2026-10-21T10:00:00Z',
    scopeNote: 'Для плана v1', reviewComment: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-21T10:00:00Z', ...over,
  })

  it('inviteFromVerifiedRecommendation dedupes by recommendation id', async () => {
    await inviteFromVerifiedRecommendation(h.sb, { rec: rec(), userId: CLIENT, now: NOW })
    await inviteFromVerifiedRecommendation(h.sb, { rec: rec(), userId: CLIENT, now: NOW })
    expect(invites()).toHaveLength(1)
    expect(invites()[0]).toMatchObject({
      kind: 'recommendation', rule_key: 'rec_verified', dedupe_key: 'rec_verified:rec-1', display: 'card', source_rec_id: 'rec-1',
      title: 'Эксперт подтвердил рекомендацию: Поднять конверсию', body: 'Суть рекомендации. Посмотреть?', href: '/client/point-b?tab=recs',
      why: 'Алия Эксперт (Продажи) проверил рекомендацию 21.10.2026. Область применимости: Для плана v1',
    })
    expect(n.notify[0]).toMatchObject({ category: 'expert' })
    // another recommendation is another invite; closing one does not pause the others
    await patchInvite(h.sb, { id: invites()[0].id as string, userId: CLIENT, action: 'dismiss', now: NOW })
    await inviteFromVerifiedRecommendation(h.sb, { rec: rec({ id: 'rec-2', title: 'Вторая' }), userId: CLIENT, now: NOW })
    expect(invites().map((i) => i.dedupe_key)).toEqual(['rec_verified:rec-1', 'rec_verified:rec-2'])
    // the closed one does not come back within 14 days
    await inviteFromVerifiedRecommendation(h.sb, { rec: rec(), userId: CLIENT, now: at(3) })
    expect(invites()).toHaveLength(2)
    // not verified / impersonating / free with gates → nothing
    await inviteFromVerifiedRecommendation(h.sb, { rec: rec({ id: 'rec-3', status: 'pending_review' }), userId: CLIENT, now: NOW })
    n.impersonating = true
    await inviteFromVerifiedRecommendation(h.sb, { rec: rec({ id: 'rec-4' }), userId: CLIENT, now: NOW })
    n.impersonating = false
    n.gates = true
    n.tier = 'free'
    await inviteFromVerifiedRecommendation(h.sb, { rec: rec({ id: 'rec-5' }), userId: CLIENT, now: NOW })
    expect(invites()).toHaveLength(2)
  })
})
