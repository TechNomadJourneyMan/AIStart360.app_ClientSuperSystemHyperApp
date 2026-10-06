/**
 * Phase 6 — reports with provenance, on the real database (migration 085 +
 * lib/agents/definitions/report.ts + lib/reports/**):
 *   • the report agent freezes a snapshot of a finished diagnostic session as a
 *     'in_review' version (103) — unreviewed model output is not in it, nothing is
 *     published by the agent, REPORT_GENERATED fires once per version;
 *   • the same data never makes a new version; new data supersedes the
 *     previous unpublished version but never the published one;
 *   • a staff publish (GIGA route, reports.publish) is audited first and
 *     supersedes the previously published version;
 *   • RLS: a tenant reads only published versions of its own company and
 *     cannot write versions;
 *   • the review queue approves / dismisses model output exactly once;
 *   • the optional narrative: off by default, grounded or rejected, never
 *     called for unchanged data, degrades without a key.
 * Run: TEST_DATABASE_URL=… npx vitest run tests/integration/db/report-agent.test.ts
 */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import type { StaffRole } from '@/lib/admin/rbac'

const audit = vi.hoisted(() => ({ calls: [] as Array<{ entry: Record<string, unknown>; opts: Record<string, unknown> }>, fail: false, role: 'admin' }))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../../unit/_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'staff-reviewer-1', kind: 'session', role: audit.role as StaffRole })),
    STAFF_COOKIE_NAME: 'x',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: Record<string, unknown>, _req: unknown, opts: Record<string, unknown> = {}) => {
    if (audit.fail && opts.required) throw new Error('Audit log unavailable — action refused')
    audit.calls.push({ entry, opts })
    return true
  },
}))

describe.skipIf(!dbTestsEnabled)('report agent and report versions', async () => {
  const { prisma } = await import('@/lib/db')
  const { __useTestAgents } = await import('@/lib/agents/registry')
  const { enqueueAgentTask, executeTaskById } = await import('@/lib/agents/queue')
  const { reportAgent } = await import('@/lib/agents/definitions/report')
  const { reviewItem, listReviewQueue } = await import('@/lib/reports/review')
  const { publishInTx } = await import('@/lib/reports/versions')
  // The expert's «Подтвердить» (lib/reports/review-flow.ts) publishes an in_review version; tested in report-review.test.ts.
  const publishInReview = (id: string, by: string) => prisma.$transaction((tx) => publishInTx(tx, id, by, ['in_review']))
  const reportRoute = await import('@/app/api/giga-admin/reports/[id]/route')
  const reviewRoute = await import('@/app/api/giga-admin/ai-review/[kind]/[id]/route')
  const { asUser, closeTestPool, inRollback, pgErrorCode, seedUser } = await import('../../helpers/pg-rls')

  const users: string[] = []
  const companies: string[] = []
  const HIDDEN = 'Скрытая гипотеза: кассовый разрыв через квартал'

  async function seed(name = 'Report Co') {
    const owner = randomUUID()
    users.push(owner)
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${owner}::uuid, ${`${owner}@t.local`})`
    await prisma.$executeRaw`UPDATE public.profiles SET status = 'approved' WHERE id = ${owner}::uuid`
    const companyId = randomUUID()
    companies.push(companyId)
    await prisma.$executeRaw`
      INSERT INTO public.companies (id, name, user_id, industry, stage, "updatedAt")
      VALUES (${companyId}, ${name}, ${owner}::uuid, 'Розничная торговля', 'early', now())`
    const block = (score: number, status: string, issue?: string) =>
      JSON.stringify({ score, status, top_issues: issue ? [issue] : [], recommendations: [] })
    const [diag] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostics (user_id, company_id, overall_score, health_index, stage,
        finance_score, sales_score, operations_score, marketing_score, strategy_score, risks, insights, quick_wins, data_gaps, is_current)
      VALUES (${owner}::uuid, ${companyId}, '47'::numeric, '38'::numeric, 'early',
        ${block(52, 'average')}::jsonb, ${block(28, 'critical', 'Нет CRM')}::jsonb, ${block(61, 'average')}::jsonb,
        ${block(44, 'weak')}::jsonb, ${block(73, 'strong')}::jsonb,
        ${JSON.stringify([{ level: 'critical', area: 'Продажи', text: 'Продажи держатся на собственнике', impact: 'Рост упирается в одного человека' }])}::jsonb,
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, TRUE)
      RETURNING id::text`
    const overview = {
      companyId, companyName: name, overallScore: 47, healthIndex: 38, maturity: { level: 'early', label: 'Становление' }, griIndex: null,
      status: 'ready', completeness: 0.55, completenessLevel: 'medium', dataGaps: ['Загрузите P&L'], problemZones: [], keyRisks: [],
      strengths: [], criticalGaps: [],
      sources: { surveyStepsCompleted: 8, surveyStepsTotal: 12, documentsTotal: 0, documentsProcessed: 0, documentsFailed: 0, documentsPending: 0, griAssessments: 0, integrationsConnected: 0, metricsWithValue: 12, metricsTotal: 148, processedSources: 2 },
      calculatedAt: null, lastInputAt: null, generatedAt: new Date().toISOString(),
    }
    const [session] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_sessions (company_id, kind, status, trigger, diagnostic_id, overview, completeness, completed_at)
      VALUES (${companyId}, 'point_a', 'ready', 'event', ${diag.id}::uuid, ${JSON.stringify(overview)}::jsonb, '0.55'::numeric, now())
      RETURNING id::text`
    const finding = async (f: { title: string; provenance: string; producer: string; visible: boolean; reviewed: boolean; model?: string | null; severity?: string }) => {
      const [row] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO public.diagnostic_findings
          (company_id, session_id, kind, area, title, severity, provenance_type, confidence, evidence, produced_by, model, visible_to_client, reviewed_at, reviewed_by)
        VALUES (${companyId}, ${session.id}::uuid, 'risk', 'sales', ${f.title}, ${f.severity ?? 'high'}, ${f.provenance}, '0.70'::numeric,
                ${JSON.stringify([{ type: 'diagnostic', ref: diag.id, field: 'sales_score', value: 28 }])}::jsonb,
                ${f.producer}, ${f.model ?? null}, ${f.visible}, ${f.reviewed ? new Date() : null}, ${f.reviewed ? 'staff-0' : null})
        RETURNING id::text`
      return row.id
    }
    const rules = await finding({ title: 'Выручка в анкете и в документе расходятся', provenance: 'CALCULATED', producer: 'agent:data_quality', visible: true, reviewed: false })
    const reviewedAi = await finding({ title: 'Продажи зависят от одного канала', provenance: 'AI_HYPOTHESIS', producer: 'agent:diagnostic:ai', visible: true, reviewed: true, model: 'anthropic/claude-sonnet-4.5' })
    const hiddenAi = await finding({ title: HIDDEN, provenance: 'AI_HYPOTHESIS', producer: 'agent:diagnostic:ai', visible: false, reviewed: false, model: 'anthropic/claude-sonnet-4.5', severity: 'critical' })
    const [aiRec] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_recommendations
        (company_id, session_id, finding_ids, area, title, priority, horizon_days, provenance_type, confidence, produced_by, model, visible_to_client)
      VALUES (${companyId}, ${session.id}::uuid, ${[hiddenAi]}::uuid[], 'sales', 'Непроверенное предложение модели', '1'::text::smallint, '30'::text::smallint,
              'RECOMMENDATION', '0.60'::numeric, 'agent:recommendation:ai', 'anthropic/claude-sonnet-4.5', FALSE)
      RETURNING id::text`
    await prisma.$executeRaw`
      INSERT INTO public.diagnostic_recommendations
        (company_id, session_id, area, title, priority, horizon_days, provenance_type, confidence, produced_by, visible_to_client)
      VALUES (${companyId}, ${session.id}::uuid, 'sales', 'Внедрить CRM', '1'::text::smallint, '90'::text::smallint, 'RECOMMENDATION', '0.80'::numeric, 'agent:recommendation', TRUE)`
    return { owner, companyId, sessionId: session.id, diagnosticId: diag.id, rules, reviewedAi, hiddenAi, aiRec: aiRec.id }
  }

  async function run(companyId: string, input: Record<string, unknown> = {}) {
    const { id } = await enqueueAgentTask({
      agentKey: 'report', companyId, trigger: input.event ? 'event' : 'manual', requestedBy: 'test', input,
      idempotencyKey: `test:${randomUUID()}`, kick: false,
    })
    const rep = await executeTaskById(id)
    const [task] = await prisma.$queryRaw<Array<{ status: string; result_summary: Record<string, any> | null; last_error: string | null }>>`
      SELECT status, result_summary, last_error FROM public.agent_tasks WHERE id = ${id}::uuid`
    return { rep, task }
  }

  const completed = (sessionId: string) => ({
    event: { id: 1, name: 'DIAGNOSTIC_COMPLETED', subject_type: 'diagnostic_session', subject_id: sessionId, payload: { session_id: sessionId } },
  })
  const versions = (companyId: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT id::text, version, status, data_hash, created_by, published_by, published_at, session_id::text, confidence::text AS confidence, content, provenance
    FROM public.report_versions WHERE company_id = ${companyId} ORDER BY version`
  const generatedEvents = (companyId: string) => prisma.$queryRaw<Array<{ subject_id: string; payload: Record<string, any> }>>`
    SELECT subject_id, payload FROM public.platform_events WHERE company_id = ${companyId} AND name = 'REPORT_GENERATED' ORDER BY id`
  const post = (url: string, body: unknown) =>
    new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  beforeAll(() => {
    process.env.AGENT_INLINE_EXECUTION = 'false'
    __useTestAgents([reportAgent])
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
    audit.fail = false
    audit.role = 'admin'
    await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key = 'report'`
  })

  afterAll(async () => {
    if (companies.length) {
      await prisma.$executeRaw`DELETE FROM public.platform_events WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.notification_events WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.diagnostics WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ANY(${companies}::text[])`
    }
    if (users.length) await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${users}::uuid[])`
    await closeTestPool()
  })

  it('freezes the finished session as an in_review version without unreviewed model output and announces it once', async () => {
    const s = await seed()
    const { rep, task } = await run(s.companyId, completed(s.sessionId))
    expect(rep?.finalStatus).toBe('succeeded')
    expect(rep?.summary).toContain('версия 1 отправлена эксперту на проверку')

    const [v] = await versions(s.companyId)
    expect(v).toMatchObject({ version: 1, status: 'in_review', created_by: 'agent:report', session_id: s.sessionId, published_at: null })
    expect(v.data_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(Number(v.confidence)).toBe(0.55)

    const content = JSON.stringify(v.content)
    expect(content).not.toContain(HIDDEN)
    expect(content).not.toContain('Непроверенное предложение модели')
    const ids = v.content.findings.map((f: { id: string }) => f.id)
    expect(ids).toEqual(expect.arrayContaining([s.rules, s.reviewedAi]))
    expect(ids).not.toContain(s.hiddenAi)
    expect(v.content.findings.find((f: { id: string }) => f.id === s.reviewedAi)).toMatchObject({ provenance_type: 'AI_HYPOTHESIS', reviewed_at: expect.any(String) })
    expect(v.content.recommendations.map((r: { title: string }) => r.title)).toEqual(['Внедрить CRM'])
    expect(v.content.narrative).toBeNull()

    expect(v.provenance).toMatchObject({
      agent_key: 'report', run_ids: [rep!.runId], model: null, prompt_version: null, data_hash: v.data_hash,
      tools: ['report.snapshot', 'report.create_version'],
      staff: { hidden_hypotheses: 1, unreviewed_model_recommendations: 1, narrative: { state: 'disabled', reason: null } },
    })
    expect(v.provenance.sources).toEqual(expect.arrayContaining([{ type: 'diagnostic', ref: s.diagnosticId }, { type: 'finding', ref: s.reviewedAi }]))
    expect(task.result_summary).toMatchObject({ created: true, version: 1, hidden_hypotheses: 1 })

    const ev = await generatedEvents(s.companyId)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ subject_id: v.id, payload: { version: 1, status: 'in_review', review_required: true, report_type: 'point_a', hidden_hypotheses: 1 } })

    // Same data again (a manual run): no new version, no second event, and the run says why.
    const again = await run(s.companyId)
    expect(again.rep?.finalStatus).toBe('succeeded')
    expect(again.rep?.summary).toBe('данные не изменились с версии 1 — новая версия не создана')
    expect(again.task.result_summary).toMatchObject({ created: false, unchanged: true, version: 1 })
    expect(await versions(s.companyId)).toHaveLength(1)
    expect(await generatedEvents(s.companyId)).toHaveLength(1)
  })

  it('new data makes a new version and supersedes the unpublished one, never the published one; the agent never publishes', async () => {
    const s = await seed()
    await run(s.companyId, completed(s.sessionId))

    // A reviewer approves the hidden hypothesis → the client-visible data changed.
    expect(await reviewItem({ kind: 'finding', id: s.hiddenAi, decision: 'approve', actorId: 'staff-1' })).toMatchObject({ ok: true, visible_to_client: true })
    const r2 = await run(s.companyId, completed(s.sessionId))
    expect(r2.rep?.summary).toContain('версия 2')
    let vs = await versions(s.companyId)
    expect(vs.map((v) => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'in_review']])
    expect(JSON.stringify(vs[1].content)).toContain(HIDDEN)
    expect(vs[1].data_hash).not.toBe(vs[0].data_hash)
    expect(vs[1].provenance.staff.hidden_hypotheses).toBe(0)

    // A person publishes v2; then the data changes again.
    expect(await publishInReview(vs[1].id, 'staff-1')).toMatchObject({ ok: true, status: 'published' })
    await prisma.$executeRaw`UPDATE public.diagnostic_findings SET title = 'Выручка в анкете и документе расходятся на 60%' WHERE id = ${s.rules}::uuid`
    await run(s.companyId)
    vs = await versions(s.companyId)
    expect(vs.map((v) => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'published'], [3, 'in_review']])
    expect(vs.every((v) => v.created_by === 'agent:report')).toBe(true)
    expect(vs.filter((v) => v.status === 'published').map((v) => v.published_by)).toEqual(['staff-1'])
    expect(await generatedEvents(s.companyId)).toHaveLength(3)
  })

  it('a staff publish through GIGA is audited first and supersedes the previously published version', async () => {
    const s = await seed()
    await run(s.companyId)
    const [built] = await versions(s.companyId)
    // A version waiting for the expert is not published through the legacy GIGA action.
    const notLegacy = await reportRoute.POST(post(`/api/giga-admin/reports/${built.id}`, { action: 'publish' }), { params: { id: built.id } })
    expect(notLegacy.status).toBe(409)
    expect((await versions(s.companyId))[0].status).toBe('in_review')
    // Versions built before 103 are 'ready': GIGA still publishes those.
    await prisma.$executeRaw`UPDATE public.report_versions SET status = 'ready' WHERE id = ${built.id}::uuid`
    audit.calls.length = 0
    const [v1] = await versions(s.companyId)

    // Wrong permission: 403 before anything is written.
    audit.role = 'crm_manager'
    const denied = await reportRoute.POST(post(`/api/giga-admin/reports/${v1.id}`, { action: 'publish' }), { params: { id: v1.id } })
    expect(denied.status).toBe(403)
    expect(audit.calls).toHaveLength(0)

    // Audit unavailable: the version is not published.
    audit.role = 'admin'
    audit.fail = true
    const refused = await reportRoute.POST(post(`/api/giga-admin/reports/${v1.id}`, { action: 'publish' }), { params: { id: v1.id } })
    expect(refused.status).toBe(503)
    expect((await versions(s.companyId))[0].status).toBe('ready')
    audit.fail = false

    const ok = await reportRoute.POST(post(`/api/giga-admin/reports/${v1.id}`, { action: 'publish' }), { params: { id: v1.id } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, status: 'published' })
    const last = audit.calls.at(-1)!
    expect(last.opts).toEqual({ required: true })
    expect(last.entry).toMatchObject({
      action: 'report.publish', entityType: 'report_version', entityId: v1.id,
      oldValue: { status: 'ready' }, newValue: { status: 'published' }, metadata: { company_id: s.companyId, version: 1 },
    })
    const [pub] = await versions(s.companyId)
    expect(pub).toMatchObject({ status: 'published', published_by: 'staff-reviewer-1' })
    expect(pub.published_at).toBeInstanceOf(Date)

    // Publishing again is a conflict; rejecting needs a reason.
    const twice = await reportRoute.POST(post(`/api/giga-admin/reports/${v1.id}`, { action: 'publish' }), { params: { id: v1.id } })
    expect(twice.status).toBe(409)
    expect((await reportRoute.POST(post(`/api/giga-admin/reports/${v1.id}`, { action: 'reject' }), { params: { id: v1.id } })).status).toBe(400)

    // A newer version published → the old published one is superseded.
    await reviewItem({ kind: 'finding', id: s.hiddenAi, decision: 'approve', actorId: 'staff-1' })
    await run(s.companyId)
    const v2 = (await versions(s.companyId))[1]
    await prisma.$executeRaw`UPDATE public.report_versions SET status = 'ready' WHERE id = ${v2.id}::uuid`
    expect((await reportRoute.POST(post(`/api/giga-admin/reports/${v2.id}`, { action: 'publish' }), { params: { id: v2.id } })).status).toBe(200)
    expect((await versions(s.companyId)).map((v) => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'published']])

    // Withdraw: the client stops seeing it; the decision is kept on the row.
    const w = await reportRoute.POST(post(`/api/giga-admin/reports/${v2.id}`, { action: 'withdraw', reason: 'Цифры выручки на перепроверке' }), { params: { id: v2.id } })
    expect(w.status).toBe(200)
    const after = (await versions(s.companyId))[1]
    expect(after.status).toBe('superseded')
    expect(after.provenance.review).toMatchObject({ action: 'withdraw', by: 'staff-reviewer-1', reason: 'Цифры выручки на перепроверке' })

    // Rebuilding the same data after a withdraw gives a fresh publishable version (the
    // withdrawn one no longer counts as "unchanged"), and a reject behaves the same way.
    const rebuilt = await run(s.companyId)
    expect(rebuilt.rep?.summary).toContain('версия 3 отправлена эксперту на проверку')
    let vs = await versions(s.companyId)
    expect(vs.map((v) => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'superseded'], [3, 'in_review']])
    expect(vs[2].data_hash).toBe(vs[1].data_hash)
    const rej = await reportRoute.POST(post(`/api/giga-admin/reports/${vs[2].id}`, { action: 'reject', reason: 'Нарратив неточен' }), { params: { id: vs[2].id } })
    expect(rej.status).toBe(200)
    await run(s.companyId)
    vs = await versions(s.companyId)
    expect(vs.map((v) => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'superseded'], [3, 'superseded'], [4, 'in_review']])
    // …while a version still waiting for review with the same data is not duplicated.
    await run(s.companyId)
    expect(await versions(s.companyId)).toHaveLength(4)
  })

  it('RLS: a client reads only published versions of its own company and cannot write any', async () => {
    const a = await seed('Tenant A')
    const b = await seed('Tenant B')
    await run(a.companyId)
    await run(b.companyId)
    const [va] = await versions(a.companyId)
    await reviewItem({ kind: 'finding', id: a.hiddenAi, decision: 'approve', actorId: 'staff-1' })
    await publishInReview(va.id, 'staff-1')
    await run(a.companyId) // v2 in_review, unpublished

    await inRollback(async (db) => {
      const read = (uid: string) => asUser(db, uid, async () =>
        (await db.query(`SELECT company_id, version, status FROM public.report_versions WHERE company_id = ANY($1) ORDER BY company_id, version`, [[a.companyId, b.companyId]])).rows)
      expect(await read(a.owner)).toEqual([{ company_id: a.companyId, version: 1, status: 'published' }])
      expect(await read(b.owner)).toEqual([]) // B has only a version waiting for the expert, and never sees A's
      const staff = await seedUser(db, { role: 'expert', status: 'approved' })
      expect((await read(staff)).length).toBe(3)
      const forge = asUser(db, a.owner, () => db.query(
        `INSERT INTO public.report_versions (company_id, report_type, status, title, content, provenance, data_hash, created_by)
         VALUES ($1, 'point_a', 'published', 'Подделка', '{}', '{}', 'h', 'user')`, [a.companyId]))
      expect(await pgErrorCode(forge)).toBe('42501')
      const publishOwn = asUser(db, a.owner, () => db.query(`UPDATE public.report_versions SET status = 'published' WHERE company_id = $1`, [a.companyId]))
      expect(await pgErrorCode(publishOwn)).toBe('42501')
    })
  })

  it('refuses a session of another company and a company without a finished diagnostic', async () => {
    const a = await seed()
    const b = await seed()
    const cross = await run(a.companyId, completed(b.sessionId))
    expect(cross.rep?.finalStatus).toBe('succeeded')
    expect(cross.rep?.summary).toContain('отчёт не сформирован')
    expect(await versions(a.companyId)).toHaveLength(0)

    await prisma.$executeRaw`UPDATE public.diagnostic_sessions SET status = 'failed' WHERE id = ${b.sessionId}::uuid`
    const none = await run(b.companyId)
    expect(none.rep?.summary).toContain('нет завершённой диагностики')
    expect(await versions(b.companyId)).toHaveLength(0)
  })

  it('review queue: lists model output with evidence; approve / dismiss once, with a reason to dismiss', async () => {
    const s = await seed()
    const queue = (await listReviewQueue({ companyId: s.companyId }))
    expect(queue.map((i) => [i.kind, i.id])).toEqual(expect.arrayContaining([['finding', s.hiddenAi], ['recommendation', s.aiRec]]))
    expect(queue.find((i) => i.id === s.reviewedAi)).toBeUndefined() // already reviewed
    const rec = queue.find((i) => i.id === s.aiRec)!
    expect(rec.evidence).toEqual([expect.objectContaining({ type: 'finding', ref: s.hiddenAi, label: HIDDEN })])
    const hyp = queue.find((i) => i.id === s.hiddenAi)!
    expect(hyp).toMatchObject({ confidence: 0.7, model: 'anthropic/claude-sonnet-4.5', severity: 'critical' })
    expect(hyp.evidence[0]).toMatchObject({ type: 'diagnostic', ref: s.diagnosticId, field: 'sales_score', value: 28 })

    audit.role = 'support'
    expect((await reviewRoute.POST(post(`/api/giga-admin/ai-review/finding/${s.hiddenAi}`, { decision: 'approve' }), { params: { kind: 'finding', id: s.hiddenAi } })).status).toBe(403)
    audit.role = 'content_manager' // holds insights.moderate
    expect((await reviewRoute.POST(post(`/api/giga-admin/ai-review/finding/${s.hiddenAi}`, { decision: 'dismiss' }), { params: { kind: 'finding', id: s.hiddenAi } })).status).toBe(400)
    const dismissed = await reviewRoute.POST(
      post(`/api/giga-admin/ai-review/finding/${s.hiddenAi}`, { decision: 'dismiss', reason: 'Нет данных о кассе' }),
      { params: { kind: 'finding', id: s.hiddenAi } },
    )
    expect(dismissed.status).toBe(200)
    expect(audit.calls.at(-1)).toMatchObject({ opts: { required: true }, entry: { action: 'ai_review.finding.dismiss', newValue: { reason: 'Нет данных о кассе' } } })
    const again = await reviewRoute.POST(post(`/api/giga-admin/ai-review/finding/${s.hiddenAi}`, { decision: 'approve' }), { params: { kind: 'finding', id: s.hiddenAi } })
    expect(again.status).toBe(409)

    const approved = await reviewRoute.POST(post(`/api/giga-admin/ai-review/recommendation/${s.aiRec}`, { decision: 'approve' }), { params: { kind: 'recommendation', id: s.aiRec } })
    expect(approved.status).toBe(200)
    const [f] = await prisma.$queryRaw<Array<Record<string, any>>>`SELECT status, visible_to_client, reviewed_by FROM public.diagnostic_findings WHERE id = ${s.hiddenAi}::uuid`
    expect(f).toMatchObject({ status: 'dismissed', visible_to_client: false, reviewed_by: 'staff-reviewer-1' })
    const [r] = await prisma.$queryRaw<Array<Record<string, any>>>`SELECT status, visible_to_client, reviewed_at FROM public.diagnostic_recommendations WHERE id = ${s.aiRec}::uuid`
    expect(r).toMatchObject({ status: 'accepted', visible_to_client: true })
    expect(r.reviewed_at).toBeInstanceOf(Date)

    // The approved model recommendation now reaches the report, the dismissed hypothesis does not.
    await run(s.companyId)
    const [v] = await versions(s.companyId)
    expect(v.content.recommendations.map((x: { title: string }) => x.title)).toContain('Непроверенное предложение модели')
    expect(JSON.stringify(v.content)).not.toContain(HIDDEN)
    expect(await listReviewQueue({ companyId: s.companyId })).toEqual([])
  })

  describe('optional narrative', () => {
    function stubModel(summary: string) {
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { model: string; messages: Array<{ role: string; content: string }> }
        calls.push(body.messages.find((m) => m.role === 'user')?.content ?? '')
        return new Response(JSON.stringify({
          model: body.model,
          choices: [{ message: { content: JSON.stringify({ summary, key_points: ['Внедрить CRM в течение 90 дней'] }) } }],
          usage: { prompt_tokens: 1500, completion_tokens: 300, cost: 0.05 },
        }), { status: 200 })
      }))
      process.env.OPENROUTER_API_KEY = 'test-key'
      return calls
    }
    const enable = () => prisma.$executeRaw`
      INSERT INTO public.agent_configs (agent_key, settings) VALUES ('report', '{"narrative": true}'::jsonb)
      ON CONFLICT (agent_key) DO UPDATE SET settings = EXCLUDED.settings`

    it('is off by default: no model call even with a key', async () => {
      const s = await seed()
      const calls = stubModel('Индекс Точки А 47 из 100.')
      await run(s.companyId)
      expect(calls).toHaveLength(0)
      expect((await versions(s.companyId))[0].content.narrative).toBeNull()
    })

    it('when enabled: a grounded narrative is stored as AI_HYPOTHESIS; unchanged data never reaches the model again', async () => {
      const s = await seed('Секретное Название ТОО')
      await enable()
      const calls = stubModel('Индекс Точки А 47 из 100, слабее всего продажи: 28 из 100. Полнота данных 55%.')
      const { rep } = await run(s.companyId)
      expect(rep?.finalStatus).toBe('succeeded')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toContain('<untrusted_report_snapshot>')
      expect(calls[0]).not.toContain('Секретное Название')
      expect(calls[0]).not.toContain(HIDDEN)
      const [v] = await versions(s.companyId)
      expect(v.content.narrative).toMatchObject({ provenance_type: 'AI_HYPOTHESIS', prompt_version: 'report-narrative@1', model: expect.stringContaining('opus') })
      expect(v.provenance).toMatchObject({ model: expect.stringContaining('opus'), prompt_version: 'report-narrative@1', staff: { narrative: { state: 'done' } } })
      expect(v.provenance.tools).toContain('llm.narrative')
      const [runRow] = await prisma.$queryRaw<Array<{ tier: string; llm_calls: number; cost_usd: string }>>`
        SELECT tier, llm_calls, cost_usd::text FROM public.agent_runs WHERE id = ${rep!.runId}::uuid`
      expect(runRow).toMatchObject({ tier: 'premium', llm_calls: 1 })
      expect(Number(runRow.cost_usd)).toBeCloseTo(0.05, 4)

      await run(s.companyId)
      expect(calls).toHaveLength(1)
      expect(await versions(s.companyId)).toHaveLength(1)
    })

    it('a narrative with invented figures is dropped and the version is created without it', async () => {
      const s = await seed()
      await enable()
      stubModel('Выручка вырастет на 35% за 18 месяцев, если внедрить CRM.')
      const { rep, task } = await run(s.companyId)
      expect(rep?.summary).toContain('резюме отклонено проверкой')
      const [v] = await versions(s.companyId)
      expect(v.status).toBe('in_review')
      expect(v.content.narrative).toBeNull()
      expect(v.provenance.staff.narrative).toMatchObject({ state: 'rejected', reason: expect.stringContaining('35') })
      expect(task.result_summary).toMatchObject({ narrative: 'rejected' })
    })

    it('without a model key the version is created and the reason recorded', async () => {
      const s = await seed()
      await enable()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const { rep } = await run(s.companyId)
      expect(rep?.summary).toContain('модель не настроена')
      expect(fetchSpy).not.toHaveBeenCalled()
      const [v] = await versions(s.companyId)
      expect(v.provenance.staff.narrative).toEqual({ state: 'unavailable', reason: 'OPENROUTER_API_KEY не задан' })
    })
  })
})
