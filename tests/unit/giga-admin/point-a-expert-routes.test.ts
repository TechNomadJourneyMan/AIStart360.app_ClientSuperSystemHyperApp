/**
 * The expert's Point A in User 360 (/api/giga-admin/users/:id/point-a/v4/*,
 * spec 2026-10-12 §7): server-side permissions and client scope, comments,
 * hypothesis decisions, «проверено экспертом», block configuration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { fakeClient, newFakeDb, type FakeDb } from './_fake-supabase'

const h = vi.hoisted(() => ({
  role: 'super_expert' as string,
  scopeDenied: false,
  db: null as unknown as FakeDb,
  audits: [] as Array<{ action: string; entityId?: string | null }>,
  emit: vi.fn(),
  recalc: vi.fn(async () => true),
  // Busy by default: the decision then goes to the queue (asserted below).
  build: vi.fn(async (): Promise<{ status: string; reason?: string }> => ({ status: 'skipped', reason: 'busy' })),
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'session', role: h.role as StaffRole, email: 'exp@x.io' })) }
})
vi.mock('@/lib/admin/client-scope', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/client-scope')>()),
  guardClientAccess: async () => (h.scopeDenied ? NextResponse.json({ ok: false, error: 'Клиент вам не назначен' }, { status: 403 }) : null),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient(h.db) }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: { action: string; entityId?: string | null }) => { h.audits.push(e); return true } }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: h.emit }))
vi.mock('@/lib/point-a/recalc-queue', () => ({ requestPointARecalc: h.recalc }))
vi.mock('@/lib/point-a/snapshot', () => ({ buildPointASnapshot: h.build }))
vi.mock('@/lib/data-layer/refresh', () => ({ refreshCompanyDataInBackground: vi.fn() }))
vi.mock('@/lib/point-a/v4/state', () => ({
  loadPointAState: vi.fn(async () => ({ config: { template: 'default', templateTitle: 'Универсальный', blocks: [] }, comments: [], snapshot: null })),
}))

const UID = '11111111-2222-4333-8444-555555555555'
const CO = 'co-1'
const P = { params: { id: UID } }
const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/giga-admin/users/${UID}/point-a/v4${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })

const root = await import('@/app/api/giga-admin/users/[id]/point-a/v4/route')
const comments = await import('@/app/api/giga-admin/users/[id]/point-a/v4/comments/route')
const comment = await import('@/app/api/giga-admin/users/[id]/point-a/v4/comments/[commentId]/route')
const review = await import('@/app/api/giga-admin/users/[id]/point-a/v4/review/route')
const hyp = await import('@/app/api/giga-admin/users/[id]/point-a/v4/hypotheses/route')
const config = await import('@/app/api/giga-admin/users/[id]/point-a/v4/config/route')
const value = await import('@/app/api/giga-admin/users/[id]/point-a/v4/value/route')

const block = (over: Record<string, unknown> = {}) => ({
  key: 'marketing', title: 'Маркетинг', status: 'insufficient_data', score: null, coverage: 0.2, confidence: 0.1,
  inputsHash: 'hash-m1', hypothesis: { score: 42, confidence: 0.3, rationale: 'Бюджет есть, каналов мало', generatedAt: '2026-10-01' },
  checks: [], ...over,
})

beforeEach(() => {
  h.role = 'super_expert'
  h.scopeDenied = false
  h.db = newFakeDb()
  h.db.tables = {
    companies: [{ id: CO, user_id: UID }],
    profiles: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Анна Эксперт', email: 'exp@x.io' }],
    point_a_snapshots: [{ id: 'snap-2', company_id: CO, overall: 61, blocks: [block()] }],
    pa_templates: [{ key: 'default', title: 'Универсальный', blocks: [{ key: 'finance', weight: 0.25, enabled: true }] }],
    pa_company_config: [{ company_id: CO, template_key: null, expert_overrides: { finance: { weight: 2 } }, client_view: { hidden: ['team'] }, version: 4 }],
    point_a_comments: [{ id: 'cccccccc-0000-4000-8000-000000000001', company_id: CO, target_kind: 'block', target_key: 'sales', body: 'x', deleted_at: null }],
  }
  h.audits = []
  h.emit.mockReset()
  h.recalc.mockClear()
})

describe('permissions and scope', () => {
  it('roles without clients.review cannot write; nothing is touched', async () => {
    for (const role of ['crm_manager', 'support', 'analyst', 'content_manager']) {
      h.role = role
      expect((await comments.POST(req('/comments', 'POST', { targetKind: 'overall', body: 'Привет' }), P)).status, role).toBe(403)
      expect((await review.POST(req('/review', 'POST'), P)).status, role).toBe(403)
      expect((await config.PATCH(req('/config', 'PATCH', { templateKey: null }), P)).status, role).toBe(403)
      expect((await hyp.POST(req('/hypotheses', 'POST', { block: 'marketing', decision: 'confirmed' }), P)).status, role).toBe(403)
    }
    expect(h.db.writes).toEqual([])
    expect(h.audits).toEqual([])
  })

  it('reading needs users.sensitive (an analyst is refused)', async () => {
    h.role = 'analyst'
    expect((await root.GET(req('', 'GET'), P)).status).toBe(403)
    h.role = 'support'
    expect((await root.GET(req('', 'GET'), P)).status).toBe(200)
  })

  it('a client outside the expert scope is refused', async () => {
    h.scopeDenied = true
    expect((await comments.POST(req('/comments', 'POST', { targetKind: 'overall', body: 'Привет' }), P)).status).toBe(403)
    expect((await root.GET(req('', 'GET'), P)).status).toBe(403)
    expect(h.db.writes).toEqual([])
  })

  it('a user without a company → 404', async () => {
    h.db.tables.companies = []
    const res = await review.POST(req('/review', 'POST'), P)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('У пользователя нет компании')
  })

  it('GET returns the state, templates, overrides and raw template weights', async () => {
    const res = await root.GET(req('', 'GET'), P)
    const body = await res.json()
    expect(body.data).toMatchObject({ companyId: CO, templateKey: null, overrides: { finance: { weight: 2 } }, templates: [{ key: 'default', title: 'Универсальный' }] })
    expect(body.data.templateBlocks).toEqual([{ key: 'finance', weight: 0.25, enabled: true }])
  })
})

describe('comments', () => {
  it('validates the target and the text', async () => {
    expect((await comments.POST(req('/comments', 'POST', { targetKind: 'block', targetKey: 'nope', body: 'текст' }), P)).status).toBe(400)
    expect((await comments.POST(req('/comments', 'POST', { targetKind: 'metric', targetKey: 'no.such.metric', body: 'текст' }), P)).status).toBe(400)
    expect((await comments.POST(req('/comments', 'POST', { targetKind: 'overall', body: '   ' }), P)).status).toBe(400)
    expect((await comments.POST(req('/comments', 'POST', { targetKind: 'overall', body: 'x'.repeat(2001) }), P)).status).toBe(400)
    expect(h.db.writes).toEqual([])
  })

  it('stores the note signed by the expert (overall → no target key) and audits it', async () => {
    expect((await comments.POST(req('/comments', 'POST', { targetKind: 'overall', targetKey: 'ignored', body: 'Хорошая база' }), P)).status).toBe(200)
    expect((await comments.POST(req('/comments', 'POST', { targetKind: 'metric', targetKey: 'biz.finansy.vyruchka_god', body: 'Сверить с отчётом' }), P)).status).toBe(200)
    const inserts = h.db.writes.filter((w) => w.table === 'point_a_comments')
    expect(inserts[0].payload).toMatchObject({ company_id: CO, target_kind: 'overall', target_key: null, body: 'Хорошая база', author_name: 'Анна Эксперт', author_role: 'super_expert', author_id: 'aaaaaaaa-0000-4000-8000-000000000001' })
    expect(inserts[1].payload).toMatchObject({ target_kind: 'metric', target_key: 'biz.finansy.vyruchka_god' })
    expect(h.audits.map((a) => a.action)).toEqual(['point_a.comment_added', 'point_a.comment_added'])
    expect(h.audits[0].entityId).toBe(CO)
  })

  it('soft-deletes only a note of this company', async () => {
    const ok = await comment.DELETE(req('/comments/x', 'DELETE'), { params: { id: UID, commentId: 'cccccccc-0000-4000-8000-000000000001' } })
    expect(ok.status).toBe(200)
    const w = h.db.writes.find((x) => x.table === 'point_a_comments')!
    expect(w.op).toBe('update')
    expect(w.filters).toContainEqual(['company_id', CO])
    expect(w.payload).toHaveProperty('deleted_at')
    h.db.tables.point_a_comments[0].company_id = 'other'
    expect((await comment.DELETE(req('/comments/x', 'DELETE'), { params: { id: UID, commentId: 'cccccccc-0000-4000-8000-000000000001' } })).status).toBe(404)
  })
})

describe('«Отметить как проверенное»', () => {
  it('marks the latest snapshot with the expert and the time', async () => {
    const res = await review.POST(req('/review', 'POST'), P)
    expect(res.status).toBe(200)
    const w = h.db.writes.find((x) => x.table === 'point_a_snapshots')!
    expect(w.op).toBe('update')
    expect(w.filters).toContainEqual(['id', 'snap-2'])
    expect(w.payload).toMatchObject({ reviewed_by: 'aaaaaaaa-0000-4000-8000-000000000001', reviewed_by_name: 'Анна Эксперт' })
    expect(typeof (w.payload as { reviewed_at: string }).reviewed_at).toBe('string')
    expect(h.audits[0]).toMatchObject({ action: 'point_a.reviewed', entityId: CO })
  })

  it('409 when there is no snapshot yet', async () => {
    h.db.tables.point_a_snapshots = []
    expect((await review.POST(req('/review', 'POST'), P)).status).toBe(409)
    expect(h.db.writes).toEqual([])
  })
})

describe('AI hypotheses', () => {
  it('confirm stores the decision on the block inputs with the hypothesis score and queues a recalculation', async () => {
    const res = await hyp.POST(req('/hypotheses', 'POST', { block: 'marketing', decision: 'confirmed' }), P)
    expect(res.status).toBe(200)
    const w = h.db.writes.find((x) => x.table === 'point_a_hypothesis_reviews')!
    expect(w.op).toBe('upsert')
    expect(w.payload).toMatchObject({
      company_id: CO, block_key: 'marketing', inputs_hash: 'hash-m1', decision: 'confirmed', score: 42,
      rationale: 'Бюджет есть, каналов мало', decided_by: 'aaaaaaaa-0000-4000-8000-000000000001', decided_by_name: 'Анна Эксперт',
    })
    expect(h.recalc).toHaveBeenCalledWith(CO, 'expert_hypothesis')
    expect(h.audits[0].action).toBe('point_a.hypothesis_confirmed')
  })

  it('the decision shows at once: Point A is rebuilt in the request when it is free', async () => {
    h.build.mockResolvedValueOnce({ status: 'written' })
    const res = await hyp.POST(req('/hypotheses', 'POST', { block: 'marketing', decision: 'confirmed' }), P)
    expect((await res.json()).data).toMatchObject({ recalculated: true, queued: false })
    expect(h.build).toHaveBeenCalledWith(CO, expect.objectContaining({ trigger: 'expert', lock: true }))
    expect(h.recalc).not.toHaveBeenCalled()
  })

  it('reject stores no score', async () => {
    expect((await hyp.POST(req('/hypotheses', 'POST', { block: 'marketing', decision: 'rejected' }), P)).status).toBe(200)
    expect(h.db.writes[0].payload).toMatchObject({ decision: 'rejected', score: null })
  })

  it('409 for a block scored by facts or without a hypothesis', async () => {
    h.db.tables.point_a_snapshots[0].blocks = [block({ status: 'ok', score: 70 })]
    expect((await hyp.POST(req('/hypotheses', 'POST', { block: 'marketing', decision: 'confirmed' }), P)).status).toBe(409)
    h.db.tables.point_a_snapshots[0].blocks = [block({ hypothesis: undefined })]
    expect((await hyp.POST(req('/hypotheses', 'POST', { block: 'marketing', decision: 'confirmed' }), P)).status).toBe(409)
    expect((await hyp.POST(req('/hypotheses', 'POST', { block: 'nope', decision: 'confirmed' }), P)).status).toBe(400)
    expect(h.db.writes).toEqual([])
    expect(h.recalc).not.toHaveBeenCalled()
  })

  it('DELETE withdraws the decision and recalculates', async () => {
    h.db.tables.point_a_hypothesis_reviews = [{ company_id: CO, block_key: 'marketing', decision: 'confirmed', score: 42, inputs_hash: 'hash-m1' }]
    expect((await hyp.DELETE(req('/hypotheses?block=marketing', 'DELETE'), P)).status).toBe(200)
    expect(h.db.writes[0]).toMatchObject({ table: 'point_a_hypothesis_reviews', op: 'delete' })
    expect(h.recalc).toHaveBeenCalledWith(CO, 'expert_hypothesis')
    expect((await hyp.DELETE(req('/hypotheses?block=sales', 'DELETE'), P)).status).toBe(404)
  })
})

describe('block configuration', () => {
  it('merges overrides, removes a reset block, bumps the version and emits BLOCK_CONFIG_CHANGED', async () => {
    const res = await config.PATCH(req('/config', 'PATCH', { templateKey: 'ecommerce', expertOverrides: { finance: null, team: { weight: 0, enabled: false } } }), P)
    expect(res.status).toBe(200)
    const w = h.db.writes.find((x) => x.table === 'pa_company_config')!
    expect(w.payload).toMatchObject({
      company_id: CO, template_key: 'ecommerce', expert_overrides: { team: { weight: 0, enabled: false } }, client_view: { hidden: ['team'] }, version: 5,
      updated_by: 'aaaaaaaa-0000-4000-8000-000000000001',
    })
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'BLOCK_CONFIG_CHANGED', companyId: CO, actor: 'giga:aaaaaaaa-0000-4000-8000-000000000001' }))
    expect(h.audits[0]).toMatchObject({ action: 'point_a.block_config_changed', entityId: CO })
  })

  it('refuses weights out of range and empty bodies', async () => {
    expect((await config.PATCH(req('/config', 'PATCH', { expertOverrides: { finance: { weight: 11 } } }), P)).status).toBe(400)
    expect((await config.PATCH(req('/config', 'PATCH', { expertOverrides: { nope: { weight: 1 } } }), P)).status).toBe(400)
    expect((await config.PATCH(req('/config', 'PATCH', {}), P)).status).toBe(400)
    expect(h.emit).not.toHaveBeenCalled()
  })
})

describe('manual value', () => {
  it('writes the override as the expert and emits MANUAL_VALUE_SET', async () => {
    const res = await value.POST(req('/value', 'POST', { metricId: 'biz.finansy.vyruchka_god', period: '2025', value: 120000000, note: 'из отчёта' }), P)
    expect(res.status).toBe(200)
    const w = h.db.writes.find((x) => x.table === 'metric_overrides')!
    expect(w.payload).toMatchObject({ company_id: CO, metric_key: 'biz.finansy.vyruchka_god', period_key: '2025', value: 120000000, set_by: 'aaaaaaaa-0000-4000-8000-000000000001', note: 'из отчёта' })
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'MANUAL_VALUE_SET', companyId: CO }))
  })

  it('refuses unknown metrics and bad periods', async () => {
    expect((await value.POST(req('/value', 'POST', { metricId: 'no.such', period: '2025', value: 1 }), P)).status).toBe(400)
    expect((await value.POST(req('/value', 'POST', { metricId: 'biz.finansy.vyruchka_god', period: '25-1', value: 1 }), P)).status).toBe(400)
    expect(h.db.writes).toEqual([])
  })
})
