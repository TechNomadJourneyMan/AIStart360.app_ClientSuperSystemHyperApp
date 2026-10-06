/**
 * Tenant isolation across the three tenancy levels (migration 084) on the
 * real RLS policies: company owner, company member, partner staff, platform
 * staff. Run: npm run test:db:setup && npm run test:db
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'

interface World {
  ownerA: string
  ownerB: string
  companyA: string
  companyB: string
}

async function world(db: Db): Promise<World> {
  const ownerA = await seedUser(db, { status: 'approved' })
  const ownerB = await seedUser(db, { status: 'approved' })
  const companyA = await seedCompany(db, ownerA, 'Company A')
  const companyB = await seedCompany(db, ownerB, 'Company B')
  for (const [owner, company] of [[ownerA, companyA], [ownerB, companyB]] as const) {
    await db.query(
      `INSERT INTO public.diagnostics (user_id, company_id, overall_score) VALUES ($1, $2, 50)`,
      [owner, company],
    )
    await db.query(
      `INSERT INTO public.metrics (company_id, metric_key, metric_value, source) VALUES ($1, 'biz.revenue', 100, 'survey')`,
      [company],
    )
    await db.query(
      `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type)
       VALUES ($1, $2, 'p&l.xlsx', 'https://x/storage/v1/object/a', 'financial_report')`,
      [owner, company],
    )
    await db.query(
      `INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer)
       VALUES ($1, $2, 1, 's1_company_name', '{"value":"x"}')`,
      [owner, company],
    )
  }
  return { ownerA, ownerB, companyA, companyB }
}

/** Company ids visible to `userId` in each tenant-scoped table. */
async function visible(db: Db, userId: string) {
  return asUser(db, userId, async () => {
    const q = async (sql: string) => (await db.query(sql)).rows.map((r) => r.company_id as string).sort()
    return {
      companies: await q(`SELECT id AS company_id FROM public.companies`),
      diagnostics: await q(`SELECT company_id FROM public.diagnostics`),
      metrics: await q(`SELECT company_id FROM public.metrics`),
      documents: await q(`SELECT company_id FROM public.documents`),
      survey: await q(`SELECT company_id FROM public.survey_answers`),
    }
  })
}

const only = (id: string) => ({ companies: [id], diagnostics: [id], metrics: [id], documents: [id], survey: [id] })

describe.skipIf(!dbTestsEnabled)('tenant isolation (084)', () => {
  afterAll(closeTestPool)

  it('backfills/syncs the primary owner into company_members', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const { rows } = await db.query(
        `SELECT role, status FROM public.company_members WHERE company_id = $1 AND user_id = $2`,
        [w.companyA, w.ownerA],
      )
      expect(rows).toEqual([{ role: 'owner', status: 'active' }])
    }))

  it('an owner sees only their own company data', () =>
    inRollback(async (db) => {
      const w = await world(db)
      expect(await visible(db, w.ownerA)).toEqual(only(w.companyA))
      expect(await visible(db, w.ownerB)).toEqual(only(w.companyB))
    }))

  it('a member of company A sees A only, and loses access when removed', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const cfo = await seedUser(db, { status: 'approved' })
      await db.query(
        `INSERT INTO public.company_members (company_id, user_id, role) VALUES ($1, $2, 'viewer')`,
        [w.companyA, cfo],
      )
      expect(await visible(db, cfo)).toEqual(only(w.companyA))

      await db.query(`UPDATE public.company_members SET status = 'removed' WHERE user_id = $1`, [cfo])
      expect(await visible(db, cfo)).toEqual({ companies: [], diagnostics: [], metrics: [], documents: [], survey: [] })
    }))

  it('partner staff see the partner companies only, and nothing once the partner is suspended', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const partner = randomUUID()
      await db.query(
        `INSERT INTO public.partner_organizations (id, name, slug) VALUES ($1, 'Agency', $2)`,
        [partner, `agency-${partner.slice(0, 8)}`],
      )
      await db.query(`UPDATE public.companies SET partner_id = $1 WHERE id = $2`, [partner, w.companyA])
      const consultant = await seedUser(db, { status: 'approved' })
      await db.query(
        `INSERT INTO public.partner_members (partner_id, user_id, role) VALUES ($1, $2, 'partner_expert')`,
        [partner, consultant],
      )
      expect(await visible(db, consultant)).toEqual(only(w.companyA))

      await db.query(`UPDATE public.partner_organizations SET status = 'suspended' WHERE id = $1`, [partner])
      expect((await visible(db, consultant)).companies).toEqual([])
    }))

  it('partner admins see their partner roster; others see only themselves', () =>
    inRollback(async (db) => {
      const partner = randomUUID()
      await db.query(
        `INSERT INTO public.partner_organizations (id, name, slug) VALUES ($1, 'Agency', $2)`,
        [partner, `agency-${partner.slice(0, 8)}`],
      )
      const admin = await seedUser(db, { status: 'approved' })
      const expert = await seedUser(db, { status: 'approved' })
      const outsider = await seedUser(db, { status: 'approved' })
      await db.query(
        `INSERT INTO public.partner_members (partner_id, user_id, role) VALUES ($1, $2, 'partner_admin'), ($1, $3, 'partner_expert')`,
        [partner, admin, expert],
      )
      const roster = (uid: string) =>
        asUser(db, uid, async () => (await db.query(`SELECT user_id FROM public.partner_members`)).rows.length)
      const orgs = (uid: string) =>
        asUser(db, uid, async () => (await db.query(`SELECT id FROM public.partner_organizations`)).rows.length)
      expect(await roster(admin)).toBe(2)
      expect(await roster(expert)).toBe(1)
      expect(await roster(outsider)).toBe(0)
      expect(await orgs(expert)).toBe(1)
      expect(await orgs(outsider)).toBe(0)
    }))

  it('platform staff see every company', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const v = await visible(db, expert)
      expect(v.companies).toEqual(expect.arrayContaining([w.companyA, w.companyB]))
      expect(v.metrics).toEqual(expect.arrayContaining([w.companyA, w.companyB]))
    }))

  it('an unapproved expert gets no platform-wide access', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const pending = await seedUser(db, { role: 'expert', status: 'pending_approval' })
      const v = await visible(db, pending)
      expect(v.companies).not.toContain(w.companyA)
      expect(v.companies).not.toContain(w.companyB)
    }))

  it('anonymous requests see nothing', () =>
    inRollback(async (db) => {
      await world(db)
      const rows = await asUser(db, null, async () => (await db.query(`SELECT id FROM public.companies`)).rows)
      expect(rows).toEqual([])
    }))

  it('membership tables cannot be written through the API roles', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const outsider = await seedUser(db, { status: 'approved' })
      const join = asUser(db, outsider, () =>
        db.query(`INSERT INTO public.company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [w.companyA, outsider]),
      )
      expect(await pgErrorCode(join)).toBe('42501')
      const promote = asUser(db, w.ownerA, () =>
        db.query(`UPDATE public.company_members SET role = 'viewer' WHERE company_id = $1`, [w.companyA]),
      )
      expect(await pgErrorCode(promote)).toBe('42501')
    }))

  it('helpers agree with the policies', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const res = await asUser(db, w.ownerA, async () =>
        (await db.query(
          `SELECT public.can_read_company($1) AS own, public.can_read_company($2) AS other,
                  public.can_manage_company($1) AS manage_own,
                  ARRAY(SELECT public.accessible_company_ids()) AS ids`,
          [w.companyA, w.companyB],
        )).rows[0],
      )
      expect(res).toEqual({ own: true, other: false, manage_own: true, ids: [w.companyA] })
    }))
})
