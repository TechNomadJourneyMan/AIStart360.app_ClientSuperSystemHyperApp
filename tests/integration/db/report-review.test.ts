/**
 * Owner decision (migration 103): the report version built after an AI
 * diagnostic goes to the expert as a PDF («Версия N · дата», watermark);
 * «Подтвердить» publishes it to the client at once; «Нужны правки» sends it
 * back to the report agent with a comment, a bounded number of times.
 * On the real database:
 *   • schema: status 'in_review', report_version_reviews (one decision per
 *     version, comment required for changes), RLS — the client never reads an
 *     in_review version nor any review, staff (experts) do, nobody but the
 *     server writes;
 *   • the agent builds an in_review version, renders and stores its PDF once,
 *     emits REPORT_GENERATED (status in_review) once;
 *   • approve publishes (client notified with a link to that version), is
 *     audited first, is idempotent; the opposite decision afterwards is refused;
 *   • the person is re-checked on every decision: approval, role / reports.review,
 *     the 2FA rule for Telegram; the version status too;
 *   • changes requested: comment saved, version retired, agent task queued with
 *     the review; unchanged data → no new version, staff told; changed data →
 *     a new in_review version; past the cap nothing is queued and staff are told;
 *   • concurrent approvals: exactly one decision;
 *   • the signed /r/v link opens a published version only.
 * Run: TEST_DATABASE_URL=… npx vitest run tests/integration/db/report-review.test.ts
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import type { AuditEntry } from '@/lib/admin/audit'
import type { AuditWriter } from '@/lib/admin/staff-actions'
import { lockAgentConfig } from '../../helpers/agent-config-lock'

const spy = vi.hoisted(() => ({
  staff: [] as Array<Record<string, unknown>>,
  client: [] as Array<Record<string, unknown>>,
  whatsapp: [] as Array<{ versionId: string; recipients: string[] | null | undefined; reviewPath?: string | null }>,
}))
vi.mock('@/lib/whatsapp/report-review', () => ({
  enqueueReportReviewWhatsApp: async (versionId: string, recipients?: string[] | null, opts?: { reviewPath?: string | null }) => {
    spy.whatsapp.push({ versionId, recipients, reviewPath: opts?.reviewPath })
    return (recipients ?? []).map((userId) => ({ userId, outboxId: `wa-${userId}`, created: true }))
  },
}))
vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: async (n: Record<string, unknown>) => { spy.staff.push(n); return { eventId: null, duplicate: false, deliveries: [] } },
}))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (n: Record<string, unknown>) => { spy.client.push(n) },
}))

describe.skipIf(!dbTestsEnabled)('report review by the expert (103)', async () => {
  const { prisma } = await import('@/lib/db')
  const { __useTestAgents } = await import('@/lib/agents/registry')
  const { enqueueAgentTask, executeTaskById } = await import('@/lib/agents/queue')
  const { reportAgent } = await import('@/lib/agents/definitions/report')
  const { reviewItem } = await import('@/lib/reports/review')
  const flow = await import('@/lib/reports/review-flow')
  const { setReportPdfStorage } = await import('@/lib/reports/pdf-store')
  const { resolveVersionLink, signVersionLink } = await import('@/lib/reports/version-link')
  const { reportReviewRecipients, reportReviewPackage, deliverReportForReview } = await import('@/lib/reports/review-delivery')
  const { asUser, closeTestPool, inRollback, pgErrorCode } = await import('../../helpers/pg-rls')

  const users: string[] = []
  const companies: string[] = []
  const stored = new Map<string, Buffer>()
  const audits: Array<{ entry: AuditEntry; opts?: { required?: boolean } }> = []
  let auditFails = false
  const audit: AuditWriter = async (entry, opts) => {
    if (auditFails && opts?.required) throw new Error('Audit log unavailable — action refused')
    audits.push({ entry, opts })
    return true
  }

  async function user(role: string, status = 'approved', staffRole: string | null = null): Promise<string> {
    const id = randomUUID()
    users.push(id)
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${`${id}@t.local`})`
    await prisma.$executeRaw`UPDATE public.profiles SET role = ${role}, status = ${status} WHERE id = ${id}::uuid`
    if (staffRole) await prisma.$executeRaw`INSERT INTO public.staff_roles (user_id, role) VALUES (${id}::uuid, ${staffRole})`
    return id
  }

  async function seed(name = 'Review Co') {
    const owner = await user('client')
    const companyId = randomUUID()
    companies.push(companyId)
    await prisma.$executeRaw`
      INSERT INTO public.companies (id, name, user_id, industry, stage, "updatedAt")
      VALUES (${companyId}, ${name}, ${owner}::uuid, 'Розничная торговля', 'early', now())`
    const block = (score: number, status: string) => JSON.stringify({ score, status, top_issues: [], recommendations: [] })
    const [diag] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostics (user_id, company_id, overall_score, health_index, stage,
        finance_score, sales_score, operations_score, marketing_score, strategy_score, risks, insights, quick_wins, data_gaps, is_current)
      VALUES (${owner}::uuid, ${companyId}, '47'::numeric, '38'::numeric, 'early',
        ${block(52, 'average')}::jsonb, ${block(28, 'critical')}::jsonb, ${block(61, 'average')}::jsonb,
        ${block(44, 'weak')}::jsonb, ${block(73, 'strong')}::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, TRUE)
      RETURNING id::text`
    const overview = { companyId, companyName: name, overallScore: 47, status: 'ready', completeness: 0.55, completenessLevel: 'medium', dataGaps: [], sources: null }
    const [session] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_sessions (company_id, kind, status, trigger, diagnostic_id, overview, completeness, completed_at)
      VALUES (${companyId}, 'point_a', 'ready', 'event', ${diag.id}::uuid, ${JSON.stringify(overview)}::jsonb, '0.55'::numeric, now())
      RETURNING id::text`
    const [rules] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_findings
        (company_id, session_id, kind, area, title, severity, provenance_type, confidence, evidence, produced_by, visible_to_client)
      VALUES (${companyId}, ${session.id}::uuid, 'risk', 'sales', 'Продажи держатся на собственнике', 'high', 'CALCULATED', '0.70'::numeric,
              '[]'::jsonb, 'agent:data_quality', TRUE)
      RETURNING id::text`
    const [hidden] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_findings
        (company_id, session_id, kind, area, title, severity, provenance_type, confidence, evidence, produced_by, model, visible_to_client)
      VALUES (${companyId}, ${session.id}::uuid, 'risk', 'finance', 'Гипотеза ИИ: кассовый разрыв', 'critical', 'AI_HYPOTHESIS', '0.60'::numeric,
              '[]'::jsonb, 'agent:diagnostic:ai', 'm', FALSE)
      RETURNING id::text`
    return { owner, companyId, sessionId: session.id, rules: rules.id, hidden: hidden.id }
  }

  async function runAgent(companyId: string, input: Record<string, unknown> = {}) {
    const { id } = await enqueueAgentTask({ agentKey: 'report', companyId, trigger: 'manual', requestedBy: 'test', input, idempotencyKey: `t:${randomUUID()}`, kick: false })
    return executeTaskById(id)
  }
  const versions = (companyId: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT id::text, version, status, data_hash, published_by, published_at, pdf_storage_path, pdf_rendered_at, provenance
    FROM public.report_versions WHERE company_id = ${companyId} ORDER BY version`
  const reviews = (versionId: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT decision, comment, channel, reviewer_id::text, reviewer_role FROM public.report_version_reviews WHERE report_version_id = ${versionId}::uuid`
  const tasks = (companyId: string) => prisma.$queryRaw<Array<{ id: string; status: string; input: Record<string, any>; requested_by: string; trigger_ref: string | null }>>`
    SELECT id::text, status, input, requested_by, trigger_ref FROM public.agent_tasks
    WHERE company_id = ${companyId} AND trigger_ref = 'report_review:changes_requested' ORDER BY created_at`
  const decide = (versionId: string, reviewerId: string, decision: 'approve' | 'changes_requested', extra: Partial<Parameters<typeof flow.decideReportReview>[0]> = {}) =>
    flow.decideReportReview({ versionId, reviewerId, decision, channel: 'web', mfaVerified: true, audit, ...extra })

  let unlockReportConfig: (() => Promise<void>) | null = null
  beforeAll(async () => {
    // report-agent.test.ts writes the same agent_configs row in a parallel worker.
    unlockReportConfig = await lockAgentConfig('report')
    process.env.AGENT_INLINE_EXECUTION = 'false'
    process.env.GIGA_COOKIE_SECRET = process.env.GIGA_COOKIE_SECRET || 'w5-test-secret-0123456789abcdef0123456789'
    __useTestAgents([reportAgent])
    setReportPdfStorage({
      configured: () => true,
      upload: async (path, bytes) => { stored.set(path, bytes) },
      download: async (path) => stored.get(path) ?? null,
    })
  }, 180_000) // may wait for the other file to release the lock

  beforeEach(async () => {
    spy.staff.length = 0
    spy.client.length = 0
    audits.length = 0
    auditFails = false
    await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key = 'report'`
    await prisma.$executeRaw`DELETE FROM public.system_settings WHERE key = 'staff_require_mfa'`
  })

  afterAll(async () => {
    await unlockReportConfig?.()
    setReportPdfStorage(null)
    await prisma.$executeRaw`DELETE FROM public.system_settings WHERE key = 'staff_require_mfa'`
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

  it('schema: in_review status, one decision per version, comment required for changes', async () => {
    const s = await seed()
    await runAgent(s.companyId)
    const [v] = await versions(s.companyId)
    expect(v.status).toBe('in_review')
    const expert = await user('expert')
    const insert = (db: Parameters<Parameters<typeof inRollback>[0]>[0], decision: string, comment: string | null) => db.query(
      `INSERT INTO public.report_version_reviews (report_version_id, company_id, reviewer_id, decision, comment, channel)
       VALUES ($1, $2, $3, $4, $5, 'web')`, [v.id, s.companyId, expert, decision, comment])
    await inRollback(async (db) => {
      expect(await pgErrorCode(insert(db, 'changes_requested', ' '))).toBe('23514')
    })
    await inRollback(async (db) => {
      await insert(db, 'approve', null)
      expect(await pgErrorCode(insert(db, 'approve', null))).toBe('23505')
    })
    await inRollback(async (db) => {
      expect(await pgErrorCode(db.query(`UPDATE public.report_versions SET status = 'pending' WHERE id = $1`, [v.id]))).toBe('23514')
    })
  })

  it('the agent builds an in_review version with its review PDF stored once and announces it once', async () => {
    const s = await seed()
    const rep = await runAgent(s.companyId, { session_id: s.sessionId })
    expect(rep?.summary).toContain('отправлена эксперту на проверку')
    const [v] = await versions(s.companyId)
    expect(v).toMatchObject({ version: 1, status: 'in_review', published_at: null })
    expect(v.pdf_storage_path).toBe(`${s.companyId}/${v.id}/review-v1.pdf`)
    expect(v.pdf_rendered_at).toBeInstanceOf(Date)
    expect(stored.get(v.pdf_storage_path)?.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const ev = await prisma.$queryRaw<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM public.platform_events WHERE company_id = ${s.companyId} AND name = 'REPORT_GENERATED'`
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({ status: 'in_review', review_required: true, version: 1 })

    // Hook for other channels (W6): recipients and the package for this version.
    const expert = await user('expert')
    const recipients = await reportReviewRecipients(v.id)
    expect(recipients.find((r) => r.userId === expert)).toMatchObject({ profileRole: 'expert', isExpert: true })
    expect(recipients.find((r) => r.userId === s.owner)).toBeUndefined()
    const pkg = await reportReviewPackage(v.id)
    expect(pkg).toMatchObject({ versionId: v.id, version: 1, filename: expect.stringMatching(/^aistart360-point_a-v1-\d{4}-\d{2}-\d{2}-review\.pdf$/) })
    expect(pkg!.stamp).toMatch(/^Версия 1 · \d{2}\.\d{2}\.\d{4}$/)
  })

  it('the review request also goes to experts on WhatsApp when Cloud API is configured (link to the cabinet, not the PDF)', async () => {
    const s = await seed()
    await runAgent(s.companyId, { session_id: s.sessionId })
    const [v] = await versions(s.companyId)
    const expert = await user('expert')
    const saved = { token: process.env.WHATSAPP_TOKEN, phone: process.env.WHATSAPP_PHONE_NUMBER_ID }
    spy.whatsapp = []
    try {
      delete process.env.WHATSAPP_TOKEN
      delete process.env.WHATSAPP_PHONE_NUMBER_ID
      const off = await deliverReportForReview(v.id)
      expect(off?.skipped.whatsapp).toMatch(/не настроен/)
      expect(spy.whatsapp).toHaveLength(0)

      process.env.WHATSAPP_TOKEN = 'test-token-not-real'
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000000'
      const on = await deliverReportForReview(v.id)
      expect(spy.whatsapp).toHaveLength(1)
      expect(spy.whatsapp[0]).toMatchObject({ versionId: v.id, reviewPath: `expert/reports?review=${v.id}` })
      expect(spy.whatsapp[0].recipients).toContain(expert)
      expect(spy.whatsapp[0].recipients).not.toContain(s.owner)
      expect(on?.whatsapp.map((w) => w.userId)).toContain(expert)
    } finally {
      if (saved.token === undefined) delete process.env.WHATSAPP_TOKEN; else process.env.WHATSAPP_TOKEN = saved.token
      if (saved.phone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID; else process.env.WHATSAPP_PHONE_NUMBER_ID = saved.phone
    }
  })

  it('RLS: the client never reads an in_review version or a review; experts do; nobody writes reviews', async () => {
    const s = await seed()
    await runAgent(s.companyId)
    const [v] = await versions(s.companyId)
    const expert = await user('expert')
    await decide(v.id, expert, 'changes_requested', { comment: 'Проверьте выручку' })
    await reviewItem({ kind: 'finding', id: s.hidden, decision: 'approve', actorId: 'staff-1' })
    await runAgent(s.companyId)
    const [, v2] = await versions(s.companyId)
    expect(v2.status).toBe('in_review')

    await inRollback(async (db) => {
      const read = (uid: string, sql: string) => asUser(db, uid, async () => (await db.query(sql, [s.companyId])).rows)
      expect(await read(s.owner, `SELECT id FROM public.report_versions WHERE company_id = $1`)).toEqual([])
      expect(await read(s.owner, `SELECT id FROM public.report_version_reviews WHERE company_id = $1`)).toEqual([])
      expect((await read(expert, `SELECT id FROM public.report_versions WHERE company_id = $1`)).length).toBe(2)
      expect((await read(expert, `SELECT decision FROM public.report_version_reviews WHERE company_id = $1`))).toEqual([{ decision: 'changes_requested' }])
      const forge = asUser(db, expert, () => db.query(
        `INSERT INTO public.report_version_reviews (report_version_id, company_id, reviewer_id, decision, channel) VALUES ($1, $2, $3, 'approve', 'web')`,
        [v2.id, s.companyId, expert]))
      expect(await pgErrorCode(forge)).toBe('42501')
    })
  })

  it('approve publishes at once, audited first, client notified with a link to this version; a repeat is a no-op', async () => {
    const s = await seed()
    await runAgent(s.companyId)
    const [v] = await versions(s.companyId)
    const expert = await user('expert')

    auditFails = true
    expect(await decide(v.id, expert, 'approve')).toEqual({ ok: false, code: 'audit_unavailable' })
    expect((await versions(s.companyId))[0].status).toBe('in_review')
    expect(await reviews(v.id)).toEqual([])
    auditFails = false

    const res = await decide(v.id, expert, 'approve')
    expect(res).toMatchObject({ ok: true, decision: 'approve', already: false, rerun: null })
    const [pub] = await versions(s.companyId)
    expect(pub).toMatchObject({ status: 'published', published_by: expert })
    expect(pub.pdf_storage_path).toBe(`${s.companyId}/${v.id}/v1.pdf`)
    expect(await reviews(v.id)).toEqual([{ decision: 'approve', comment: null, channel: 'web', reviewer_id: expert, reviewer_role: 'expert' }])
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ opts: { required: true }, entry: { action: 'report.review.approve', entityId: v.id, oldValue: { status: 'in_review' }, newValue: { status: 'published' } } })

    expect(spy.client).toHaveLength(1)
    expect(spy.client[0]).toMatchObject({ userId: s.owner, category: 'report', metadata: { report_version_id: v.id, version: 1 } })
    const link = String(spy.client[0].link)
    expect(link).toMatch(/^\/r\/v\//)
    const opened = await resolveVersionLink(link.slice('/r/v/'.length))
    expect(opened.ok && opened.version.id).toBe(v.id)

    // Repeat: nothing changes, nothing is audited, the answer says so.
    const again = await decide(v.id, expert, 'approve', { channel: 'telegram', mfaVerified: false })
    expect(again).toMatchObject({ ok: true, already: true })
    expect(audits).toHaveLength(1)
    expect(spy.client).toHaveLength(1)
    // The opposite decision after the version was published is refused.
    expect(await decide(v.id, expert, 'changes_requested', { comment: 'Поздно' })).toMatchObject({ ok: false, code: 'wrong_status', decided: 'approve' })
  })

  it('re-checks the person on every decision: approval, role, the 2FA rule on Telegram', async () => {
    const s = await seed()
    await runAgent(s.companyId)
    const [v] = await versions(s.companyId)

    expect(await decide(v.id, s.owner, 'approve')).toEqual({ ok: false, code: 'forbidden' })
    expect(await decide(v.id, await user('expert', 'pending_approval'), 'approve')).toEqual({ ok: false, code: 'forbidden' })
    expect(await decide(v.id, await user('client', 'approved', 'crm_manager'), 'approve')).toEqual({ ok: false, code: 'forbidden' })
    expect(await decide(v.id, randomUUID(), 'approve')).toEqual({ ok: false, code: 'forbidden' })

    // Telegram: the platform requires staff 2FA and the expert has none enrolled.
    const expert = await user('expert')
    await prisma.$executeRaw`
      INSERT INTO public.system_settings (key, value) VALUES ('staff_require_mfa', 'true'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    expect(await decide(v.id, expert, 'approve', { channel: 'telegram', mfaVerified: false })).toEqual({ ok: false, code: 'mfa_required' })
    expect(audits).toHaveLength(0)
    // Enrolled (TOTP) → allowed; a SuperExpert staff role decides too.
    await prisma.$executeRaw`INSERT INTO public.user_security (user_id, totp_enabled) VALUES (${expert}::uuid, TRUE)`
    const superExpert = await user('client', 'approved', 'super_expert')
    expect(flow.canReviewReports({ profileRole: 'client', staffRole: 'super_expert' })).toBe(true)
    const res = await decide(v.id, expert, 'approve', { channel: 'telegram', mfaVerified: false })
    expect(res).toMatchObject({ ok: true })
    expect((await reviews(v.id))[0]).toMatchObject({ channel: 'telegram' })
    expect(await decide(v.id, superExpert, 'approve')).toMatchObject({ ok: true, already: true })

    // A version that is no longer in review cannot be decided.
    await prisma.$executeRaw`UPDATE public.report_versions SET status = 'superseded' WHERE company_id = ${s.companyId}`
    const s2 = await seed()
    await runAgent(s2.companyId)
    const [w] = await versions(s2.companyId)
    await prisma.$executeRaw`UPDATE public.report_versions SET status = 'superseded' WHERE id = ${w.id}::uuid`
    expect(await decide(w.id, expert, 'approve')).toMatchObject({ ok: false, code: 'wrong_status', status: 'superseded' })
  })

  it('changes requested: comment required, version retired, agent re-run queued; unchanged data → no new version, staff told; new data → new in_review version', async () => {
    const s = await seed()
    await runAgent(s.companyId, { session_id: s.sessionId })
    const [v1] = await versions(s.companyId)
    const expert = await user('expert')

    expect(await decide(v1.id, expert, 'changes_requested', { comment: ' ' })).toEqual({ ok: false, code: 'comment_required' })
    const res = await decide(v1.id, expert, 'changes_requested', { comment: 'Выручка в выводе не совпадает с P&L' })
    expect(res).toMatchObject({ ok: true, decision: 'changes_requested', rerun: { state: 'queued', attempt: 1, max: 3 } })
    const [retired] = await versions(s.companyId)
    expect(retired.status).toBe('superseded')
    expect(retired.provenance.review).toMatchObject({ action: 'changes_requested', by: expert, reason: 'Выручка в выводе не совпадает с P&L' })
    expect(spy.client).toHaveLength(0)

    const [task] = await tasks(s.companyId)
    expect(task).toMatchObject({ status: 'queued', requested_by: `expert:${expert}` })
    expect(task.input).toMatchObject({ session_id: s.sessionId, review: { version_id: v1.id, comment: 'Выручка в выводе не совпадает с P&L' } })

    // Same data: the same document would go back — nothing is created, staff are told.
    const rep = await executeTaskById(task.id)
    expect(rep?.summary).toContain('правки эксперта к версии 1')
    expect(await versions(s.companyId)).toHaveLength(1)
    expect(spy.staff.map((n) => n.type)).toContain('report.review_unchanged')

    // The data changes (a hypothesis reviewed), the next requested rebuild makes v2 in_review.
    await prisma.$executeRaw`UPDATE public.report_versions SET status = 'in_review', provenance = provenance - 'review' WHERE id = ${v1.id}::uuid`
    await prisma.$executeRaw`DELETE FROM public.report_version_reviews WHERE report_version_id = ${v1.id}::uuid`
    const second = await decide(v1.id, expert, 'changes_requested', { comment: 'Добавьте гипотезу про кассу после проверки' })
    expect(second).toMatchObject({ ok: true, rerun: { state: 'queued' } })
    await reviewItem({ kind: 'finding', id: s.hidden, decision: 'approve', actorId: 'staff-1' })
    const t2 = (await tasks(s.companyId)).at(-1)!
    const rep2 = await executeTaskById(t2.id)
    expect(rep2?.summary).toContain('версия 2 отправлена эксперту на проверку')
    expect((await versions(s.companyId)).map((v) => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'in_review']])
  })

  it('caps the rebuilds per diagnostic session, then stops and tells staff', async () => {
    const s = await seed()
    await prisma.$executeRaw`
      INSERT INTO public.agent_configs (agent_key, settings) VALUES ('report', '{"review_reruns_max": 1}'::jsonb)
      ON CONFLICT (agent_key) DO UPDATE SET settings = EXCLUDED.settings`
    expect(await flow.reviewRerunsMax()).toBe(1)
    await runAgent(s.companyId, { session_id: s.sessionId })
    const expert = await user('expert')
    const [v1] = await versions(s.companyId)
    expect(await decide(v1.id, expert, 'changes_requested', { comment: 'Первая правка' })).toMatchObject({ rerun: { state: 'queued', attempt: 1, max: 1 } })

    // New data → v2 in_review for the same session; a second «Нужны правки» exceeds the cap.
    await reviewItem({ kind: 'finding', id: s.hidden, decision: 'approve', actorId: 'staff-1' })
    await executeTaskById((await tasks(s.companyId))[0].id)
    const v2 = (await versions(s.companyId)).at(-1)!
    expect(v2.status).toBe('in_review')
    const capped = await decide(v2.id, expert, 'changes_requested', { comment: 'Вторая правка' })
    expect(capped).toMatchObject({ ok: true, rerun: { state: 'cap_reached', attempt: 2, max: 1 } })
    expect(await tasks(s.companyId)).toHaveLength(1)
    expect(spy.staff.map((n) => n.type)).toContain('report.review_rerun_cap')
  })

  it('concurrent approvals: exactly one decision is stored and the version is published once', async () => {
    const s = await seed()
    await runAgent(s.companyId)
    const [v] = await versions(s.companyId)
    const a = await user('expert')
    const b = await user('expert')
    const results = await Promise.all([decide(v.id, a, 'approve'), decide(v.id, b, 'approve'), decide(v.id, a, 'approve')])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.filter((r) => r.ok && !r.already)).toHaveLength(1)
    expect(await reviews(v.id)).toHaveLength(1)
    expect((await versions(s.companyId))[0].status).toBe('published')
    expect(spy.client).toHaveLength(1)
  })

  it('signed version link: never opens an in_review version; opens it once published; stops after a withdraw', async () => {
    const s = await seed()
    await runAgent(s.companyId)
    const [v] = await versions(s.companyId)
    const { token } = await signVersionLink(v.id, 1)
    expect(await resolveVersionLink(token)).toEqual({ ok: false })
    await decide(v.id, await user('expert'), 'approve')
    const open = await resolveVersionLink(token)
    expect(open.ok && open.version.version).toBe(1)
    // Wrong version number in the token (e.g. a forged copy for another version) → closed.
    expect(await resolveVersionLink((await signVersionLink(v.id, 2)).token)).toEqual({ ok: false })
    await prisma.$executeRaw`
      UPDATE public.report_versions SET status = 'superseded', provenance = provenance || '{"review": {"action": "withdraw"}}'::jsonb WHERE id = ${v.id}::uuid`
    expect(await resolveVersionLink(token)).toEqual({ ok: false })
  })
})
