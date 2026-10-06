/**
 * Diagnostics / metrics fixes on the real database:
 *   • migration 097 removes exactly the wrongly-sourced metric values (and their
 *     history points) and nothing else, collapses duplicate current
 *     diagnostics and enforces one current row per user;
 *   • under RLS an API caller cannot retire its current diagnostic (why
 *     POST /api/v1/diagnostics/recalculate now writes with the service role);
 *   • replaceRecommendations / replaceFindings respect staff decisions;
 *   • scoreCompany moves calculated_at when it reuses an unchanged result.
 * Run: npm run test:db:setup && npm run test:db
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'
import { LEGACY_WEAK } from '../../unit/point-a/fixtures/answer-sets'

const MIGRATION_097 = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/097_diagnostics_fixes.sql'), 'utf8')

async function metric(db: Db, company: string, key: string, value: number, picked: Record<string, unknown> | null, periodYear: number | null = null, source = 'survey') {
  await db.query(
    `INSERT INTO public.metrics (company_id, metric_key, metric_value, metric_unit, source, confidence, provenance, period_year, computed_at)
     VALUES ($1, $2, $3, '₸', $4, 0.9, $5, $6, now())`,
    [company, key, value, source, picked ? JSON.stringify({ picked }) : null, periodYear],
  )
}

describe.skipIf(!dbTestsEnabled)('097: wrongly-sourced metric values', () => {
  afterAll(closeTestPool)

  it('deletes only the removed (metric, survey key) pairs, in metrics and in history', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      // removed sources → deleted
      await metric(db, company, 'biz.marketing.cac', 4_000_000, { type: 'survey', step: 9, key: 's9n_expense_marketing' }, 2024)
      await metric(db, company, 'goal.09.cac', 12, { type: 'survey', step: 5, key: 's5_marketing_budget_pct' })
      await metric(db, company, 'goal.03.sredniy_chek', 84_000_000, { type: 'survey', step: 9, key: 's9n_revenue_2024' })
      // legitimate → kept
      await metric(db, company, 'biz.marketing.cac', 15_000, { type: 'survey', step: 2, key: 's2_cac' }, 2025)
      await metric(db, company, 'goal.03.sredniy_chek', 45_000, { type: 'document', doc_type: 'pl_report', field: 'avg_check' }, null, 'document')
      await metric(db, company, 'goal.01.stoimost_lida_cpl', 900_000, { type: 'survey', step: 9, key: 's9n_expense_marketing' }) // still declared for CPL
      await metric(db, company, 'goal.01.stoimost_privlecheniya_cac', 20_000, null) // no resolver provenance

      await db.query(MIGRATION_097)

      const { rows } = await db.query(
        `SELECT metric_key, metric_value::float AS v FROM public.metrics WHERE company_id = $1 ORDER BY metric_key, v`, [company])
      expect(rows).toEqual([
        { metric_key: 'biz.marketing.cac', v: 15_000 },
        { metric_key: 'goal.01.stoimost_lida_cpl', v: 900_000 },
        { metric_key: 'goal.01.stoimost_privlecheniya_cac', v: 20_000 },
        { metric_key: 'goal.03.sredniy_chek', v: 45_000 },
      ])
      const { rows: history } = await db.query(
        `SELECT metric_key, value::float AS v FROM public.metric_value_history WHERE company_id = $1 ORDER BY metric_key, v`, [company])
      expect(history).toEqual(rows)
    }))
})

describe.skipIf(!dbTestsEnabled)('097: one current diagnostic per user', () => {
  it('under RLS the owner cannot retire its own current diagnostic (UPDATE matches 0 rows)', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      await db.query(`INSERT INTO public.diagnostics (user_id, company_id, overall_score, is_current) VALUES ($1, $2, 50, true)`, [owner, company])
      const res = await asUser(db, owner, () =>
        db.query(`UPDATE public.diagnostics SET is_current = false WHERE user_id = $1 AND is_current`, [owner]))
      expect(res.rowCount).toBe(0)
    }))

  it('collapses duplicate current rows to the newest and rejects a second current row', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      // The state the old recalculate route produced (the index did not exist yet).
      await db.query(`DROP INDEX IF EXISTS public.diagnostics_one_current_per_user_uidx`)
      const { rows: [older] } = await db.query(
        `INSERT INTO public.diagnostics (user_id, company_id, overall_score, is_current, calculated_at)
         VALUES ($1, $2, 50, true, now() - interval '1 day') RETURNING id`, [owner, company])
      const { rows: [newer] } = await db.query(
        `INSERT INTO public.diagnostics (user_id, company_id, overall_score, is_current) VALUES ($1, NULL, 60, true) RETURNING id`, [owner])
      expect((await db.query(`SELECT 1 FROM public.diagnostics WHERE user_id = $1 AND is_current`, [owner])).rowCount).toBe(2)

      await db.query(MIGRATION_097)

      const { rows } = await db.query(`SELECT id FROM public.diagnostics WHERE user_id = $1 AND is_current`, [owner])
      expect(rows).toEqual([{ id: newer.id }])
      expect(await pgErrorCode(db.query(`UPDATE public.diagnostics SET is_current = true WHERE id = $1`, [older.id]))).toBe('23505')
    }))
})

describe.skipIf(!dbTestsEnabled)('097: point_a_insights provenance guard', () => {
  const INSERT = `INSERT INTO public.point_a_insights (user_id, company_id, type, category, question_text, author_name, status, answer_text, answer_author_role)
                  VALUES ($1, $2, $3, 'finance', 'Как считать маржу?', $4, $5, $6, $7) RETURNING id`

  it('a client creates only its own open question; provenance fields are refused', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      const other = await seedCompany(db, await seedUser(db, { status: 'approved' }))
      const ins = (args: unknown[]) => asUser(db, owner, () => db.query(INSERT, [owner, ...args]))
      expect(await pgErrorCode(ins([company, 'expert', null, 'awaiting_answer', null, null]))).toBe('42501')
      expect(await pgErrorCode(ins([company, 'client', 'Эксперт Иванов', 'awaiting_answer', null, null]))).toBe('42501')
      expect(await pgErrorCode(ins([company, 'client', null, 'confirmed', null, null]))).toBe('42501')
      expect(await pgErrorCode(ins([company, 'client', null, 'awaiting_answer', 'ответ', 'expert']))).toBe('42501')
      expect(await pgErrorCode(ins([other, 'client', null, 'awaiting_answer', null, null]))).toBe('42501')
      const ok = await ins([company, 'client', null, 'pending_ai', null, null])
      expect(ok.rowCount).toBe(1)
    }))

  it('a client answer is attributed to the client; frozen fields cannot change', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      await db.query(`UPDATE public.profiles SET full_name = 'Айгерим' WHERE id = $1`, [owner])
      const company = await seedCompany(db, owner)
      const { rows: [q] } = await asService(db, () =>
        db.query(INSERT, [owner, company, 'expert', 'Эксперт', 'awaiting_answer', null, null]))
      await asUser(db, owner, () => db.query(
        `UPDATE public.point_a_insights SET answer_text = 'Так', answer_author_role = 'expert', answer_author_name = 'Эксперт Иванов' WHERE id = $1`, [q.id]))
      const { rows: [row] } = await db.query(`SELECT answer_author_role, answer_author_name FROM public.point_a_insights WHERE id = $1`, [q.id])
      expect(row).toEqual({ answer_author_role: 'client', answer_author_name: 'Айгерим' })
      for (const set of [`type = 'admin'`, `author_name = 'Я'`, `answer_author_role = 'admin'`, `published_at = now()`]) {
        expect(await pgErrorCode(asUser(db, owner, () => db.query(`UPDATE public.point_a_insights SET ${set} WHERE id = $1`, [q.id]))), set).toBe('42501')
      }
      // The client's own confirmation still works.
      await asUser(db, owner, () => db.query(`UPDATE public.point_a_insights SET status = 'confirmed' WHERE id = $1`, [q.id]))
    }))

  it('platform staff are unaffected', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      const expert = await seedUser(db, { status: 'approved', role: 'expert' })
      const res = await asUser(db, expert, () => db.query(INSERT, [owner, company, 'expert', 'Эксперт', 'awaiting_answer', null, null]))
      expect(res.rowCount).toBe(1)
    }))
})

describe.skipIf(!dbTestsEnabled)('staff decisions and score reuse', async () => {
  const { prisma } = await import('@/lib/db')
  const { replaceFindings, replaceRecommendations } = await import('@/lib/diagnostics/findings-store')
  const { scoreCompany } = await import('@/lib/diagnostics/scoring')
  const users: string[] = []
  const companies: string[] = []

  async function seed(answers: Record<string, unknown> = {}) {
    const owner = randomUUID()
    users.push(owner)
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${owner}::uuid, ${`${owner}@t.local`})`
    const companyId = randomUUID()
    companies.push(companyId)
    await prisma.$executeRaw`
      INSERT INTO public.companies (id, name, user_id, industry, stage, "updatedAt")
      VALUES (${companyId}, 'Fixes Co', ${owner}::uuid, 'Розничная торговля', 'early', now())`
    for (const [key, value] of Object.entries(answers)) {
      await prisma.$executeRaw`
        INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer)
        VALUES (${owner}::uuid, ${companyId}, 2, ${key}, ${JSON.stringify({ value })}::jsonb)`
    }
    return { owner, companyId }
  }

  afterAll(async () => {
    if (companies.length) {
      await prisma.$executeRaw`DELETE FROM public.diagnostic_recommendations WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.diagnostic_findings WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.diagnostics WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ANY(${companies}::text[])`
    }
    if (users.length) await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${users}::uuid[])`
  })

  const rec = (title: string) => ({
    key: title, area: 'finance', title, priority: 2 as const, provenance: 'AI_HYPOTHESIS' as const, confidence: 0.6, visibleToClient: false,
  })

  it('a rejected or accepted AI recommendation is not proposed again on the next run', async () => {
    const { companyId } = await seed()
    const meta = { companyId, sessionId: null, producedBy: 'agent:recommendations:ai', agentRunId: null, model: 'm' }
    await replaceRecommendations(meta, [rec('Внедрить ежемесячный P&L'), rec('Нанять РОПа')])
    await prisma.$executeRaw`UPDATE public.diagnostic_recommendations SET status = 'rejected' WHERE company_id = ${companyId} AND title = 'Внедрить ежемесячный P&L'`
    await prisma.$executeRaw`UPDATE public.diagnostic_recommendations SET status = 'accepted' WHERE company_id = ${companyId} AND title = 'Нанять РОПа'`

    const res = await replaceRecommendations(meta, [rec('Внедрить  ежемесячный P&L.'), rec('нанять РОПа'), rec('Запустить программу лояльности')])
    expect(res).toMatchObject({ inserted: 1, suppressed: 2 })
    const rows = await prisma.$queryRaw<Array<{ title: string; status: string }>>`
      SELECT title, status FROM public.diagnostic_recommendations WHERE company_id = ${companyId} ORDER BY title`
    expect(rows).toEqual([
      { title: 'Внедрить ежемесячный P&L', status: 'rejected' },
      { title: 'Запустить программу лояльности', status: 'proposed' },
      { title: 'Нанять РОПа', status: 'accepted' },
    ])
  })

  it('a dismissed AI hypothesis does not come back as a new unreviewed finding', async () => {
    const { companyId } = await seed()
    const meta = { companyId, sessionId: null, producedBy: 'agent:hypotheses:ai', agentRunId: null, model: 'm' }
    const hyp = (body: string) => ({
      key: 'ai:продажи зависят от одного канала', kind: 'risk' as const, area: 'sales', title: 'Продажи зависят от одного канала', body,
      severity: 'high' as const, provenance: 'AI_HYPOTHESIS' as const, confidence: 0.6, evidence: [{ type: 'survey', ref: 's5_marketing_channels' }],
    })
    await replaceFindings(meta, [hyp('Один канал.')])
    await prisma.$executeRaw`UPDATE public.diagnostic_findings SET status = 'dismissed' WHERE company_id = ${companyId}`

    const res = await replaceFindings(meta, [hyp('Другая формулировка того же вывода.')])
    expect(res).toMatchObject({ inserted: 0, suppressed: 1 })
    const active = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM public.diagnostic_findings WHERE company_id = ${companyId} AND status = 'active'`
    expect(active).toEqual([])
  })

  it('a rule finding dismissed earlier comes back when its numbers change', async () => {
    const { companyId } = await seed()
    const meta = { companyId, sessionId: null, producedBy: 'agent:data_quality', agentRunId: null }
    const f = (value: number) => ({
      key: 'anomaly:biz.marketing.cac:manual:', kind: 'anomaly' as const, area: 'marketing', title: `«CAC»: невозможное значение ${value}`,
      severity: 'high' as const, provenance: 'CALCULATED' as const, confidence: 0.99, evidence: [{ type: 'metric', ref: 'biz.marketing.cac', value }],
    })
    await replaceFindings(meta, [f(-500)])
    await prisma.$executeRaw`UPDATE public.diagnostic_findings SET status = 'dismissed' WHERE company_id = ${companyId}`
    expect(await replaceFindings(meta, [f(-500)])).toMatchObject({ inserted: 0, suppressed: 1 })
    expect(await replaceFindings(meta, [f(-900)])).toMatchObject({ inserted: 1, suppressed: 0 })
  })

  it('reusing an unchanged score moves calculated_at to now (the overview is not «stale»)', async () => {
    const { owner, companyId } = await seed(LEGACY_WEAK)
    const first = await scoreCompany(companyId, null)
    expect(first.reused).toBe(false)
    await prisma.$executeRaw`UPDATE public.diagnostics SET calculated_at = now() - interval '3 days' WHERE id = ${first.diagnosticId}::uuid`

    const second = await scoreCompany(companyId, null)
    expect(second).toMatchObject({ reused: true, diagnosticId: first.diagnosticId })
    const [row] = await prisma.$queryRaw<Array<{ calculated_at: Date }>>`
      SELECT calculated_at FROM public.diagnostics WHERE id = ${first.diagnosticId}::uuid`
    expect(Date.now() - row.calculated_at.getTime()).toBeLessThan(60_000)
    expect(second.calculatedAt.getTime()).toBe(row.calculated_at.getTime())
    const current = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM public.diagnostics WHERE user_id = ${owner}::uuid AND is_current`
    expect(Number(current[0].n)).toBe(1)
  })
})
