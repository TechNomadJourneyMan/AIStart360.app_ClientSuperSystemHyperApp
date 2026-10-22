/**
 * Point B Ф6a, Task 6: the recommendation routes of the expert (GIGA), the review queue, the invites route of the
 * client and the invite rules after an approval. In-memory DB with the real column names (public.companies has
 * camelCase timestamps); the LLM gateway, the notifications and the rate limiter are mocked — no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const EXPERT2 = 'eeeeeeee-0000-4000-8000-000000000002'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const OTHER_COMPANY = 'company-2'
const NOW = new Date('2026-10-22T09:00:00Z')

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  actor: { id: 'x', role: 'admin' as StaffRole, scope: 'all' as 'all' | 'assigned' },
  user: null as { id: string } | null,
  impersonating: false,
  gate402: false,
  audits: [] as Array<{ action: string; entityType?: string; entityId?: string | null; metadata?: Record<string, unknown>; targetUserId?: string | null }>,
  limited: new Set<string>(),
  limitCalls: [] as Array<{ id: string; bucket: string }>,
  aiAnswer: null as unknown,
  aiCalls: 0,
  notify: [] as Array<Record<string, unknown>>,
  runCalls: [] as Array<Record<string, unknown>>,
  runFails: false,
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))
vi.mock('@/lib/access/gate', () => ({
  gateFeature: async () => (s.gate402 ? NextResponse.json({ ok: false, error: 'upgrade_required' }, { status: 402 }) : null),
}))
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => false }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (s.impersonating ? { sid: 's', uid: CLIENT } : null) }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: () => undefined }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string }) => { s.audits.push(entry as never); return true },
}))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: vi.fn(async (id: string, bucket: string) => { s.limitCalls.push({ id, bucket }); return s.limited.has(bucket) }),
}))
vi.mock('@/lib/ai/gateway', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/gateway')>()),
  hasLlmKey: () => true,
  callLlmJson: vi.fn(async (req: { schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } }) => {
    s.aiCalls += 1
    const parsed = req.schema.safeParse(s.aiAnswer)
    const usage = { model: 'test/model', tier: 'standard', tokensIn: 1, tokensOut: 1, costUsd: 0.001, costSource: 'estimate', latencyMs: 1, attempts: 1 }
    return parsed.success ? { ok: true, data: parsed.data, usage } : { ok: false, error: 'INVALID_OUTPUT', message: 'x', usage }
  }),
}))
vi.mock('@/lib/ai/budget', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/budget')>()), assertAiBudget: async () => undefined }))
vi.mock('@/lib/ai/usage', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/usage')>()), recordAiUsage: async () => undefined }))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: Record<string, unknown>) => { s.notify.push(input); return { ok: true, delivered: { inApp: true, email: false, telegram: false } } },
}))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async () => null,
  claimSend: async () => ({ result: 'claimed', id: 'c' }),
  releaseSend: async () => undefined,
}))
vi.mock('@/lib/point-b/plan/notify', () => ({
  notifyPlanSubmitted: async () => undefined,
  notifyPlanApproved: async () => undefined,
  notifyGoalCorrection: async () => undefined,
  notifyGoalNeedsReview: async () => undefined,
  notifyGoalResponded: async () => undefined,
  POINT_B_STAFF_PERMISSION: 'clients.review',
  pointBStaffLink: (id: string) => `/admin-giga-panel/users/${id}?tab=point-b`,
}))
vi.mock('@/lib/point-b/invites/run', async (orig) => {
  const real = await orig<typeof import('@/lib/point-b/invites/run')>()
  return {
    ...real,
    runInviteRules: async (sb: unknown, input: Record<string, unknown>) => {
      s.runCalls.push(input)
      if (s.runFails) throw new Error('rules exploded')
      return real.runInviteRules(sb as never, input as never)
    },
  }
})
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: s.actor.id, kind: 'session', role: s.actor.role }))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.actor.scope } } : g
    },
    forbidTarget: async () => null,
    staffMfaGate: async () => 'ok',
  }
})

const recsRoute = await import('@/app/api/giga-admin/users/[id]/point-b/recommendations/route')
const recRoute = await import('@/app/api/giga-admin/users/[id]/point-b/recommendations/[recId]/route')
const queueRoute = await import('@/app/api/giga-admin/point-b/recommendations/queue/route')
const invitesRoute = await import('@/app/api/v1/point-b/invites/[id]/route')
const approveRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/approve/route')

const req = (method: string, b?: unknown) =>
  new NextRequest('http://t/api', { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const db = () => s.h!.db
const recs = () => db().pb_recommendations as Array<Record<string, unknown>>
const as = (role: StaffRole, id = role === 'admin' ? ADMIN : EXPERT, scope: 'all' | 'assigned' = 'all') => { s.actor = { id, role, scope } }

const metric = (company: string, key: string, value: number) => ({ company_id: company, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })
const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })
const goalsSnap = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Удвоить выручку', baselineValue: null, baselinePeriod: null, targetValue: 120_000_000, deadline: null, reviewStatus: 'verified' }] }
const version = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'approved', base_snapshot_id: null, goals: goalsSnap, assumptions: {}, scenarios: [], selected_scenario: 'moderate',
  strategy: {}, risks: [], expert_notes: null, change_reason: 'Первый план', author_id: EXPERT, author_name: 'Алия Эксперт', author_kind: 'expert',
  submitted_at: '2026-10-10T00:00:00Z', approved_by: ADMIN, approved_at: '2026-10-11T00:00:00Z', approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null,
  created_at: '2026-10-09T00:00:00Z', ...over,
})

/** The golden funnel client (60M → 120M in 12 months, 300 leads × 12% × 140 000 ₸, 10 employees) with a published plan. */
function seed(opts: { versionStatus?: string } = {}) {
  s.h = pbDb({
    // public.companies (Prisma-era): camelCase timestamps.
    companies: [
      { id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: OTHER_COMPANY, user_id: OTHER_CLIENT, name: 'Лютик', industry: null, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    ],
    profiles: [
      { id: CLIENT, role: 'client', full_name: 'Клиент Один', email: 'one@example.com', tier: 'pro', feature_flags: {}, expert_title: null },
      { id: OTHER_CLIENT, role: 'client', full_name: 'Клиент Два', email: 'two@example.com', tier: 'pro', feature_flags: {}, expert_title: null },
      { id: EXPERT, role: 'expert', full_name: 'Алия Эксперт', email: 'aliya@example.com', expert_title: 'Эксперт по продажам' },
      { id: EXPERT2, role: 'expert', full_name: 'Берик Эксперт', email: 'berik@example.com', expert_title: null },
      { id: ADMIN, role: 'admin', full_name: 'Админ Главный', email: 'admin@example.com', expert_title: null },
    ],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER_CLIENT, assignee_id: EXPERT2 }],
    metric_targets: [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: 'Удвоить выручку', note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: NOW.toISOString(), created_at: NOW.toISOString(),
    }],
    pb_goal_reviews: [{ id: 'gr-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', status: 'verified', proposed_value: 120_000_000, created_at: '2026-10-10T00:00:00Z' }],
    metrics: [
      metric(COMPANY, REVENUE, 60_000_000), metric(COMPANY, 'biz.marketing.lidov_v_mes', 300), metric(COMPANY, 'biz.marketing.konversiya_lid_klient', 12),
      metric(COMPANY, 'biz.prodazhi.sredniy_chek', 140_000), metric(COMPANY, 'biz.hr.kol_vo_sotrudnikov', 10),
    ],
    diagnostics: [{
      id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z', overall_score: 55, health_index: 50, stage: 'growth',
      finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
    }],
    point_a_snapshots: [{ id: 'snap-1', company_id: COMPANY, engine: 'v4', confidence: 0.6, coverage: 0.7, created_at: '2026-10-10T00:00:00Z', blocks: [{ key: 'finance', score: 60 }], inputs: {} }],
    point_b_versions: [],
    pb_plans: [{ id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: 'v-1', published_version_id: opts.versionStatus ? null : 'v-1', settings: {}, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
    pb_plan_versions: [version(opts.versionStatus ? { status: opts.versionStatus, approved_by: null, approved_at: null } : {})],
  })
}

const recItem = (over: Record<string, unknown> = {}) => ({
  company_id: COMPANY, version_id: 'v-1', kind: 'lever', title: 'Поднять конверсию', essence: 'Суть', reason: 'Причина', confidence: 'medium',
  next_action: 'Разобрать воронку', source_refs: [], status: 'pending_review', generated_by: 'ai', inputs_hash: 'h', ...over,
})
async function insertRec(over: Record<string, unknown> = {}): Promise<string> {
  const { data } = await s.h!.sb.from('pb_recommendations').insert(recItem(over)).select('id').single()
  return (data as { id: string }).id
}

const aiItem = (over: Record<string, unknown> = {}) => ({
  kind: 'lever', title: 'Разобрать воронку продаж', essence: 'Конверсия должна вырасти с 12,0% до 15,1%.', reason: 'Это ограничивающий фактор.',
  expectedEffect: null, resources: null, confidence: 'medium', confidenceReason: null, risks: null, nextAction: 'Провести разбор звонков', refs: ['metric:conversion'], ...over,
})

const get = async (user = CLIENT) => json(await recsRoute.GET(req('GET'), { params: { id: user } }))
const post = async (b: unknown, user = CLIENT) => json(await recsRoute.POST(req('POST', b), { params: { id: user } }))
const patch = async (recId: string, b: unknown, user = CLIENT) => json(await recRoute.PATCH(req('PATCH', b), { params: { id: user, recId } }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  seed()
  s.user = { id: CLIENT }
  s.impersonating = false
  s.gate402 = false
  s.audits.length = 0
  s.limited.clear()
  s.limitCalls.length = 0
  s.aiAnswer = { items: [aiItem()] }
  s.aiCalls = 0
  s.notify.length = 0
  s.runCalls.length = 0
  s.runFails = false
  as('admin')
  return () => vi.useRealTimers()
})

describe('expert recommendation routes', () => {
  it('expert generate_ai stores rule and AI recommendations as pending_review and returns the warnings; 429 over the hourly limit', async () => {
    as('super_expert', EXPERT, 'assigned')
    s.aiAnswer = { items: [aiItem(), aiItem({ title: 'Придуманная цифра', essence: 'Нужно 777 лидов.' })] }
    const r = await post({ action: 'generate_ai' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const created = r.body.data.created as Array<Record<string, unknown>>
    // the rules: the limiting factor (conversion) and the contradiction «×2 without hiring» (10 new employees needed);
    // the AI: one grounded item, the invented number dropped
    expect(created.map((c) => [c.generatedBy, c.kind, c.status])).toEqual([
      ['rule', 'constraint', 'pending_review'],
      ['rule', 'contradiction', 'pending_review'],
      ['ai', 'lever', 'pending_review'],
    ])
    expect(created[0].title).toBe('Ограничивающий фактор роста: Конверсия лида в клиента')
    expect(created[1].title).toBe('Рост выручки в разы без расширения команды')
    expect(created[2]).toMatchObject({ title: 'Разобрать воронку продаж', versionId: 'v-1', reviewerName: null, sourceRefs: [{ type: 'metric', ref: 'biz.marketing.konversiya_lid_klient', label: 'Конверсия лида в клиента' }] })
    expect(r.body.data.warnings).toEqual(['Рекомендация «Придуманная цифра» отброшена: число не из данных (777).'])
    expect(recs().every((x) => x.status === 'pending_review' && x.company_id === COMPANY)).toBe(true)
    expect(s.aiCalls).toBe(1)
    expect(s.limitCalls).toEqual([{ id: EXPERT, bucket: 'pb-recs-ai' }, { id: COMPANY, bucket: 'pb-recs-ai-company' }])
    expect(s.audits.map((a) => a.action)).toEqual(['point_b.recommendations.generated'])
    expect(s.audits[0]).toMatchObject({ entityType: 'company', entityId: COMPANY, targetUserId: CLIENT, metadata: { created: 3, rules: 2, ai: 1 } })

    // the second run within 10 minutes: no LLM call, the rule recommendation is a live duplicate
    s.limited.add('pb-recs-ai-company')
    const again = await post({ action: 'generate_ai' })
    expect(again.status).toBe(200)
    expect(again.body.data.created).toEqual([])
    expect(again.body.data.warnings).toEqual([
      'ИИ уже запускался для этого клиента меньше 10 минут назад — подождите.',
      'Уже есть на проверке или проверены: 2 — повтор не сохранён.',
    ])
    expect(s.aiCalls).toBe(1)

    // over the hourly limit of the expert → 429, nothing is called
    s.limited.add('pb-recs-ai')
    const over = await post({ action: 'generate_ai' })
    expect(over.status).toBe(429)
    expect(over.body).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(s.aiCalls).toBe(1)

    // GET lists them with the counts
    const list = await get()
    expect(list.status).toBe(200)
    expect(list.body.data.counts).toEqual({ pending_review: 3, expert_verified: 0, expert_rejected: 0, stale: 0 })
    expect(list.body.data.items).toHaveLength(3)
  })

  it('verify/reject/edit permissions: clients.review + client scope; another client → 403; unknown rec → 404; double verify → 409', async () => {
    const id = await insertRec()
    const foreignId = await insertRec({ company_id: OTHER_COMPANY, title: 'Чужая' })
    // an expert limited to his clients cannot touch another expert's client
    as('super_expert', EXPERT, 'assigned')
    expect((await patch(foreignId, { action: 'verify', scopeNote: 'S' }, OTHER_CLIENT)).status).toBe(403)
    expect((await post({ action: 'generate_ai' }, OTHER_CLIENT)).status).toBe(403)
    expect((await get(OTHER_CLIENT)).status).toBe(403)
    // a role without clients.review → 403
    as('support' as StaffRole, 'ffffffff-0000-4000-8000-000000000001')
    expect((await patch(id, { action: 'verify', scopeNote: 'S' })).status).toBe(403)
    // another client's recommendation through this client → 404; an unknown one → 404
    as('super_expert', EXPERT, 'assigned')
    expect((await patch(foreignId, { action: 'verify', scopeNote: 'S' })).status).toBe(404)
    expect((await patch('00000000-0000-4000-8000-000000000999', { action: 'verify', scopeNote: 'S' })).status).toBe(404)
    expect((await patch('not-a-uuid', { action: 'verify', scopeNote: 'S' })).status).toBe(404)

    // verify: name and specialty from the profile, the invite to the client, the audit
    const v = await patch(id, { action: 'verify', scopeNote: 'Для плана v1, данные на 22 октября 2026 г.', comment: 'Проверено по воронке' })
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body.data).toMatchObject({ status: 'expert_verified', reviewerName: 'Алия Эксперт', reviewerSpecialty: 'Эксперт по продажам', scopeNote: 'Для плана v1, данные на 22 октября 2026 г.', reviewComment: 'Проверено по воронке' })
    expect(db().pb_invites).toEqual([expect.objectContaining({ user_id: CLIENT, kind: 'recommendation', dedupe_key: `rec_verified:${id}`, source_rec_id: id })])
    expect(s.notify.map((n) => n.category)).toEqual(['expert'])
    expect(s.audits.at(-1)).toMatchObject({ action: 'point_b.recommendation.verified', entityType: 'pb_recommendation', entityId: id, targetUserId: CLIENT })

    // a second verify (another expert of the same client) → 409
    as('admin')
    const twice = await patch(id, { action: 'verify', scopeNote: 'S' })
    expect(twice.status).toBe(409)
    expect(twice.body.code).toBe('bad_state')

    // reject needs a comment
    const id2 = await insertRec({ title: 'Вторая' })
    const noComment = await patch(id2, { action: 'reject' })
    expect(noComment.status).toBe(400)
    expect(noComment.body).toMatchObject({ code: 'invalid', field: 'comment' })
    const rej = await patch(id2, { action: 'reject', comment: 'Не про этого клиента' })
    expect(rej.body.data).toMatchObject({ status: 'expert_rejected', reviewComment: 'Не про этого клиента', reviewerName: 'Админ Главный' })

    // edit → a new pending version, the verified one becomes stale
    const ed = await patch(id, { action: 'edit', patch: { title: 'Поднять конверсию до 15,1%' } })
    expect(ed.status).toBe(200)
    expect(ed.body.data).toMatchObject({ status: 'pending_review', recVersion: 2, supersedesId: id })
    expect(recs().find((x) => x.id === id)!.status).toBe('stale')
    // profanity in a patch → 400 with the field
    const dirty = await patch(ed.body.data.id, { action: 'edit', patch: { risks: 'полная херня' } })
    expect(dirty).toMatchObject({ status: 400, body: { code: 'profanity', field: 'risks' } })
    expect(s.audits.map((a) => a.action)).toEqual(['point_b.recommendation.verified', 'point_b.recommendation.rejected', 'point_b.recommendation.edited'])
  })

  it('verify without the scope note → 400 with the field', async () => {
    const id = await insertRec()
    for (const b of [{ action: 'verify' }, { action: 'verify', scopeNote: '   ' }]) {
      const r = await patch(id, b)
      expect(r.status).toBe(400)
      expect(r.body).toMatchObject({ ok: false, code: 'invalid', field: 'scopeNote' })
    }
    const dirty = await patch(id, { action: 'verify', scopeNote: 'Для плана, бля' })
    expect(dirty).toMatchObject({ status: 400, body: { code: 'profanity', field: 'scopeNote' } })
    expect(recs()[0].status).toBe('pending_review')
  })

  it('create: the expert’s own recommendation is verified at once; run_rules runs the invite rules', async () => {
    as('super_expert', EXPERT, 'assigned')
    const c = await post({ action: 'create', draft: { kind: 'risk', title: 'Кассовый риск', essence: 'Суть', nextAction: 'Отложить закупку' }, scopeNote: 'Для плана v1' })
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body.data).toMatchObject({ status: 'expert_verified', generatedBy: 'expert', reviewerName: 'Алия Эксперт', reviewerSpecialty: 'Эксперт по продажам', versionId: 'v-1' })
    expect((await post({ action: 'create', draft: { kind: 'risk', title: '' } })).body).toMatchObject({ code: 'invalid', field: 'title' })
    expect((await post({ action: 'nope' })).status).toBe(400)

    const r = await post({ action: 'run_rules' })
    expect(r.status).toBe(200)
    // golden: conversion +25,8%, 10 new employees, the empty finmodel; the verified recommendation's invite takes a slot
    expect(r.body.data).toEqual({ created: 2, skipped: 1 })
    expect(s.runCalls).toEqual([expect.objectContaining({ userId: CLIENT, companyId: COMPANY })])
    expect(s.audits.map((a) => a.action)).toEqual(['point_b.recommendations.created', 'point_b.recommendations.rules_run'])
  })
})

describe('the review queue', () => {
  it('queue lists pending recommendations only within the actor’s scope', async () => {
    await insertRec({ title: 'Моя', created_at: '2026-10-20T00:00:00Z' })
    await insertRec({ title: 'Чужая', company_id: OTHER_COMPANY })
    await insertRec({ title: 'Проверенная', status: 'expert_verified' })
    as('super_expert', EXPERT, 'assigned')
    const mine = await json(await queueRoute.GET(req('GET')))
    expect(mine.status).toBe(200)
    expect(mine.body.data).toEqual([{
      id: expect.any(String), userId: CLIENT, clientName: 'Клиент Один', companyName: 'Ромашка', title: 'Моя', kind: 'lever', generatedBy: 'ai', createdAt: expect.any(String),
    }])
    as('admin')
    const all = await json(await queueRoute.GET(req('GET')))
    expect(all.body.data.map((x: { title: string }) => x.title).sort()).toEqual(['Моя', 'Чужая'])
    as('support' as StaffRole, 'ffffffff-0000-4000-8000-000000000001')
    expect((await queueRoute.GET(req('GET'))).status).toBe(403)
  })
})

describe('client invites route', () => {
  const patchInv = async (id: string, b: unknown) => json(await invitesRoute.PATCH(req('PATCH', b), { params: { id } }))
  async function invite(userId: string, over: Record<string, unknown> = {}): Promise<string> {
    const { data } = await s.h!.sb.from('pb_invites').insert({
      company_id: userId === CLIENT ? COMPANY : OTHER_COMPANY, user_id: userId, rule_key: 'cash_gap', dedupe_key: `cash_gap:${userId}`, title: 'Кассовый разрыв', ...over,
    }).select('id').single()
    return (data as { id: string }).id
  }

  it('invites PATCH works only on own invites; impersonating → 403', async () => {
    const mine = await invite(CLIENT)
    const foreign = await invite(OTHER_CLIENT)
    expect((await patchInv(foreign, { action: 'dismiss' })).status).toBe(404)
    expect(db().pb_invites.find((r) => r.id === foreign)!.status).toBe('new')
    expect((await patchInv(mine, { action: 'snooze', days: 5 })).status).toBe(400)
    expect((await patchInv(mine, { action: 'snooze' })).status).toBe(400)
    const ok = await patchInv(mine, { action: 'snooze', days: 7 })
    expect(ok).toEqual({ status: 200, body: { ok: true } })
    expect(db().pb_invites.find((r) => r.id === mine)).toMatchObject({ status: 'snoozed', snoozed_until: new Date(NOW.getTime() + 7 * 86_400_000).toISOString() })

    s.impersonating = true
    expect((await patchInv(mine, { action: 'dismiss' })).status).toBe(403)
    expect(db().pb_invites.find((r) => r.id === mine)!.status).toBe('snoozed')
    s.impersonating = false
    s.gate402 = true
    expect((await patchInv(mine, { action: 'dismiss' })).status).toBe(402)
    s.gate402 = false
    s.user = null
    expect((await patchInv(mine, { action: 'dismiss' })).status).toBe(401)
  })
})

describe('the approval runs the invite rules', () => {
  const approve = async () => json(await approveRoute.POST(req('POST', {}), { params: { id: CLIENT, versionId: 'v-1' } }))

  it('approval triggers runInviteRules best-effort and a failure does not undo the approval', async () => {
    seed({ versionStatus: 'in_review' })
    const ok = await approve()
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data).toMatchObject({ id: 'v-1', status: 'approved' })
    expect(s.runCalls).toEqual([expect.objectContaining({ userId: CLIENT, companyId: COMPANY })])
    // the rules of the published plan created the client's invites
    expect((db().pb_invites as Array<{ rule_key: string }>).map((r) => r.rule_key)).toEqual(['conversion_gap', 'staff_load', 'finmodel_gap'])

    seed({ versionStatus: 'in_review' })
    s.runCalls.length = 0
    s.runFails = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const still = await approve()
    errors.mockRestore()
    expect(still.status).toBe(200)
    expect(still.body.data.status).toBe('approved')
    expect(db().pb_plan_versions[0].status).toBe('approved')
    expect(db().pb_plans[0].published_version_id).toBe('v-1')
    expect(s.runCalls).toHaveLength(1)
    expect(db().pb_invites).toEqual([])
  })
})
