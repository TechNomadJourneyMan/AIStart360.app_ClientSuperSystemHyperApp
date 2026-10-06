/**
 * Recalculating the metrics of a company must not depend on WHO clicks
 * «пересчитать» (lib/metrics/materialize-tenant.ts, lib/point-a/aggregator.ts).
 *
 * Under RLS (migration 084) a member / partner / staff user does not see the
 * owner's survey answers, documents and GRI assessment that carry no
 * company_id. Reading the resolver inputs with their session made the
 * resolver see «no inputs», and the superseded-row cleanup then DELETED the
 * owner's metric values. The inputs are read with the service role, scoped to
 * the company's owner + company_id, after the tenant check.
 *
 * Real SQL + real RLS policies (scripts/test-db/setup.mjs); every test rolls back.
 * Run: npm run test:db:setup && npm run test:db
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'
import { pgSupabase } from './metrics-pg-client'
import { materializeForTenant } from '@/lib/metrics/materialize-tenant'
import { aggregatePointA } from '@/lib/point-a/aggregator'

interface Fixture {
  owner: string
  member: string
  staff: string
  partner: string
  company: string
}

async function seed(db: Db): Promise<Fixture> {
  const owner = await seedUser(db, { status: 'approved' })
  const member = await seedUser(db, { status: 'approved' })
  const partner = await seedUser(db, { status: 'approved' })
  const staff = await seedStaff(db, 'analyst')
  const company = await seedCompany(db, owner)
  await db.query(`INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [company, member])
  const { rows: [org] } = await db.query(`INSERT INTO public.partner_organizations (name, slug) VALUES ('Agency', $1) RETURNING id`, [`agency-${company.slice(0, 8)}`])
  await db.query(`INSERT INTO public.partner_members (partner_id, user_id, role) VALUES ($1, $2, 'partner_expert')`, [org.id, partner])
  await db.query(`UPDATE public.companies SET partner_id = $1 WHERE id = $2`, [org.id, company])

  // The owner's questionnaire, P&L and GRI assessment WITHOUT company_id (onboarding before 084).
  const answers: Array<[number, string, unknown]> = [
    [1, 's1_current_revenue_year', 66_000_000],
    [1, 's1_employee_count', 24],
    [3, 's3_deal_cycle_days', 21],
    [5, 's3_deals_2025', 420],
    [5, 's3_rejections_2025', 180],
    [7, 's7_leads_per_month', 300],
  ]
  for (const [step, key, value] of answers) {
    await db.query(`INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer) VALUES ($1, NULL, $2, $3, $4)`, [owner, step, key, JSON.stringify({ value })])
  }
  await db.query(
    `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type, parse_status, parsed_data, uploaded_at)
     VALUES ($1, NULL, 'P&L 2025.xlsx', 'p/pl.xlsx', 'pl_report', 'parsed', $2, '2026-09-01T00:00:00Z')`,
    [owner, JSON.stringify({ fields: [{ key: 'revenue', label: 'Выручка', value: 72_000_000, period: '2025' }, { key: 'net_profit', label: 'Чистая прибыль', value: 9_500_000, period: '2025' }] })],
  )
  // A member's upload bound to the company (visible to every reader).
  await db.query(
    `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type, parse_status, parsed_data, uploaded_at)
     VALUES ($1, $2, 'marketing.xlsx', 'p/mk.xlsx', 'marketing_report', 'parsed', $3, '2026-09-02T00:00:00Z')`,
    [member, company, JSON.stringify({ fields: [{ key: 'cac', label: 'CAC', value: 18_500 }] })],
  )
  await db.query(
    `INSERT INTO public.gri_assessments (user_id, company_id, section_avgs, gri_index, is_current) VALUES ($1, NULL, $2, 6.5, true)`,
    [owner, JSON.stringify({ team: 7, operations: 6 })],
  )
  return { owner, member, staff, partner, company }
}

async function snapshot(db: Db, company: string): Promise<Array<{ metric_key: string; v: number; source: string }>> {
  const { rows } = await db.query(
    `SELECT metric_key, metric_value::float8 AS v, source FROM public.metrics WHERE company_id = $1 ORDER BY metric_key, source`,
    [company],
  )
  return rows
}

describe.skipIf(!dbTestsEnabled)('metrics recalculation by a non-owner (RLS-hidden owner inputs)', () => {
  afterAll(closeTestPool)

  it('a member / partner / staff recalculation keeps the owner\'s rows, identical to the owner\'s recalculation', () =>
    inRollback(async (db) => {
      const fx = await seed(db)
      const service = pgSupabase(db, null)

      const ownerRun = await materializeForTenant(pgSupabase(db, fx.owner), service, { companyId: fx.company, userId: fx.owner, role: 'owner' })
      expect(ownerRun.result.errors).toEqual([])
      const afterOwner = await snapshot(db, fx.company)
      const byKey = new Map(afterOwner.map((r) => [r.metric_key, r]))
      // Owner inputs without company_id + the member's company upload all count.
      expect(byKey.get('biz.finansy.vyruchka_god')).toMatchObject({ v: 72_000_000, source: 'document' })
      expect(byKey.get('biz.marketing.cac')).toMatchObject({ v: 18_500, source: 'document' })
      expect(byKey.get('biz.prodazhi.tsikl_zakrytiya_sdelki')).toMatchObject({ v: 21, source: 'survey' })
      expect(afterOwner.some((r) => r.metric_key.startsWith('gri.'))).toBe(true)

      for (const [who, role] of [[fx.member, 'member'], [fx.partner, 'partner_expert'], [fx.staff, 'staff']] as const) {
        const run = await materializeForTenant(pgSupabase(db, who), service, { companyId: fx.company, userId: who, role: role as never })
        expect(run.result.errors, who).toEqual([])
        expect(run.result.superseded ?? 0, `${role}: superseded`).toBe(0)
        expect(await snapshot(db, fx.company), `${role}: rows`).toEqual(afterOwner)
      }
    }))

  it('Point A aggregate (POST) by a member reads the inputs with the service client: owner rows intact', () =>
    inRollback(async (db) => {
      const fx = await seed(db)
      const service = pgSupabase(db, null)
      await materializeForTenant(pgSupabase(db, fx.owner), service, { companyId: fx.company, userId: fx.owner, role: 'owner' })
      const afterOwner = await snapshot(db, fx.company)
      expect(afterOwner.length).toBeGreaterThan(5)

      await aggregatePointA(pgSupabase(db, fx.member), fx.owner, fx.company, {
        documentsScope: 'company',
        inputClient: service,
        writeClient: service,
      })
      expect(await snapshot(db, fx.company)).toEqual(afterOwner)
    }))

  it('the owner\'s uploads to ANOTHER company (where they are a member) do not feed this company', () =>
    inRollback(async (db) => {
      const fx = await seed(db)
      const other = await seedCompany(db, await seedUser(db), 'Other Co')
      await db.query(`INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')`, [other, fx.owner])
      await db.query(
        `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type, parse_status, parsed_data, uploaded_at)
         VALUES ($1, $2, 'other.xlsx', 'p/o.xlsx', 'marketing_report', 'parsed', $3, '2026-09-03T00:00:00Z')`,
        [fx.owner, other, JSON.stringify({ fields: [{ key: 'cac', label: 'CAC', value: 99_000 }] })],
      )
      const service = pgSupabase(db, null)
      await materializeForTenant(pgSupabase(db, fx.member), service, { companyId: fx.company, userId: fx.member, role: 'member' })
      const rows = await snapshot(db, fx.company)
      expect(rows.find((r) => r.metric_key === 'biz.marketing.cac')).toMatchObject({ v: 18_500 })
    }))
})
