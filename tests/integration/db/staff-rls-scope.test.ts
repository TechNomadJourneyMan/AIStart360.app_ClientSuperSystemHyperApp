/**
 * Staff rights in RLS come from staff_roles only (R-002), and the platform
 * staff / expert view of client companies follows the client scope (R-004).
 * Migration 140 (supabase/migrations/140_staff_rls_from_staff_roles.sql).
 *
 * Real policies on the disposable test DB (scripts/test-db/setup.mjs); every
 * case runs in a transaction that is rolled back.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

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
    await db.query(`INSERT INTO public.diagnostics (user_id, company_id, overall_score) VALUES ($1, $2, 50)`, [owner, company])
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
    // A survey row without a company: only the *_admin_select path covers it.
    await db.query(
      `INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer)
       VALUES ($1, NULL, 2, 's2_orphan', '{"value":"y"}')`,
      [owner],
    )
  }
  return { ownerA, ownerB, companyA, companyB }
}

/** Owners whose rows `userId` sees, per table (profiles: ids among the two owners). */
async function visibleOwners(db: Db, userId: string, w: World) {
  const owners = [w.ownerA, w.ownerB]
  return asUser(db, userId, async () => {
    const q = async (sql: string) =>
      Array.from(new Set((await db.query(sql, [owners])).rows.map((r) => r.owner as string))).sort()
    return {
      companies: await q(`SELECT user_id::text AS owner FROM public.companies WHERE user_id = ANY($1)`),
      survey: await q(`SELECT user_id::text AS owner FROM public.survey_answers WHERE user_id = ANY($1)`),
      documents: await q(`SELECT user_id::text AS owner FROM public.documents WHERE user_id = ANY($1)`),
      diagnostics: await q(`SELECT user_id::text AS owner FROM public.diagnostics WHERE user_id = ANY($1)`),
      metrics: await q(
        `SELECT c.user_id::text AS owner FROM public.metrics m JOIN public.companies c ON c.id = m.company_id WHERE c.user_id = ANY($1)`,
      ),
      profiles: await q(`SELECT id::text AS owner FROM public.profiles WHERE id = ANY($1)`),
    }
  })
}

const none = { companies: [], survey: [], documents: [], diagnostics: [], metrics: [], profiles: [] }

async function setStatus(db: Db, id: string, status: string) {
  await db.query(`UPDATE public.profiles SET status = $2 WHERE id = $1`, [id, status])
}

async function assign(db: Db, client: string, assignee: string) {
  await db.query(
    `INSERT INTO public.user_assignments (user_id, assignee_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET assignee_id = EXCLUDED.assignee_id`,
    [client, assignee],
  )
}

async function isStaff(db: Db, uid: string): Promise<boolean> {
  return asUser(db, uid, async () => (await db.query(`SELECT public.is_platform_staff() AS s`)).rows[0].s as boolean)
}

describe.skipIf(!dbTestsEnabled)('R-002: staff rights in RLS come from staff_roles only (140)', () => {
  afterAll(closeTestPool)

  for (const legacy of ['admin', 'super_admin', 'manager', 'analyst']) {
    it(`R-002: an approved legacy profiles.role='${legacy}' without staff_roles reads no foreign client data`, () =>
      inRollback(async (db) => {
        const w = await world(db)
        const legacyUser = await seedUser(db, { role: legacy, status: 'approved' })
        expect(await visibleOwners(db, legacyUser, w)).toEqual(none)
        expect(await isStaff(db, legacyUser)).toBe(false)
      }))
  }

  for (const legacy of ['manager', 'analyst', 'admin']) {
    it(`R-002: a legacy '${legacy}' cannot write another user's survey_answers`, () =>
      inRollback(async (db) => {
        const w = await world(db)
        const legacyUser = await seedUser(db, { role: legacy, status: 'approved' })
        const upd = await asUser(db, legacyUser, () =>
          db.query(`UPDATE public.survey_answers SET answer = '{"value":"hacked"}' WHERE user_id = $1`, [w.ownerA]),
        )
        expect(upd.rowCount).toBe(0)
        const ins = asUser(db, legacyUser, () =>
          db.query(
            `INSERT INTO public.survey_answers (user_id, step, question_key, answer) VALUES ($1, 3, 's3_x', '{"value":"z"}')`,
            [w.ownerA],
          ),
        )
        expect(await pgErrorCode(ins)).toBe('42501')
      }))
  }

  it('R-002: staff with a staff_roles row (sensitive roles, scope all) read every client as before', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const both = [w.ownerA, w.ownerB].sort()
      for (const role of ['super_admin', 'admin', 'crm_manager', 'support', 'super_expert']) {
        const staff = await seedStaff(db, role)
        const v = await visibleOwners(db, staff, w)
        expect(v.companies, role).toEqual(both)
        expect(v.survey.length ? v.survey : both, role).toEqual(both)
        expect(v.metrics, role).toEqual(both)
        expect(v.documents, role).toEqual(both)
        expect(await isStaff(db, staff), role).toBe(true)
      }
    }))

  it('R-002: staff admins (staff_roles) keep the staff paths of the legacy policies (survey edit, all survey rows)', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const admin = await seedStaff(db, 'admin')
      const v = await visibleOwners(db, admin, w)
      expect(v.profiles).toEqual([w.ownerA, w.ownerB].sort())
      const orphanRows = await asUser(db, admin, async () =>
        (await db.query(`SELECT 1 FROM public.survey_answers WHERE company_id IS NULL AND user_id = ANY($1)`, [[w.ownerA, w.ownerB]])).rowCount,
      )
      expect(orphanRows).toBe(2)
      const upd = await asUser(db, admin, () =>
        db.query(`UPDATE public.survey_answers SET answer = '{"value":"fixed"}' WHERE user_id = $1 AND step = 1`, [w.ownerA]),
      )
      expect(upd.rowCount).toBe(1)
    }))

  it('R-002: analyst / content_manager staff get no client data (096 rule kept)', () =>
    inRollback(async (db) => {
      const w = await world(db)
      for (const role of ['analyst', 'content_manager']) {
        const staff = await seedStaff(db, role)
        expect(await visibleOwners(db, staff, w), role).toEqual(none)
      }
    }))

  for (const status of ['blocked', 'archived', 'rejected', 'pending_approval', 'requires_clarification']) {
    it(`R-002: staff_roles admin with profile status '${status}' gets nothing`, () =>
      inRollback(async (db) => {
        const w = await world(db)
        const staff = await seedStaff(db, 'admin')
        await setStatus(db, staff, status)
        expect(await visibleOwners(db, staff, w)).toEqual(none)
        expect(await isStaff(db, staff)).toBe(false)
        const admin = await asUser(db, staff, async () => (await db.query(`SELECT public.is_platform_admin() AS a`)).rows[0].a)
        expect(admin).toBe(false)
      }))
  }

  it('R-002: a client reads only their own rows', () =>
    inRollback(async (db) => {
      const w = await world(db)
      expect(await visibleOwners(db, w.ownerA, w)).toEqual({
        companies: [w.ownerA], survey: [w.ownerA], documents: [w.ownerA], diagnostics: [w.ownerA], metrics: [w.ownerA], profiles: [w.ownerA],
      })
    }))

  it('R-002: no RLS policy takes rights from current_user_role() or a profiles.role list any more', () =>
    inRollback(async (db) => {
      const { rows } = await db.query(
        `SELECT schemaname || '.' || tablename || '.' || policyname AS p
           FROM pg_policies
          WHERE schemaname IN ('public', 'storage')
            AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(current_user_role|role = ANY|role IN|\\.role\\s*=\\s*''(admin|super_admin|manager|analyst|expert)'')'
          ORDER BY 1`,
      )
      expect(rows.map((r) => r.p)).toEqual([])
    }))

  it('R-002: the profiles privileged-column guard trusts staff admins, not a legacy admin profile', () =>
    inRollback(async (db) => {
      const legacy = await seedUser(db, { role: 'admin', status: 'approved' })
      const { rows } = await db.query(`SELECT pg_get_functiondef('public.profiles_guard_privileged_columns'::regproc) AS d`)
      expect(rows[0].d).not.toMatch(/current_user_role/)
      expect(await asUser(db, legacy, async () => (await db.query(`SELECT public.is_platform_admin() AS a`)).rows[0].a)).toBe(false)
    }))
})

describe.skipIf(!dbTestsEnabled)('R-004: client scope of staff and experts in can_read_company (140)', () => {
  afterAll(closeTestPool)

  it('R-004: an approved expert (profiles.role) sees only assigned clients', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const before = await visibleOwners(db, expert, w)
      expect(before.companies).toEqual([])
      expect(before.survey).toEqual([])
      await assign(db, w.ownerA, expert)
      const v = await visibleOwners(db, expert, w)
      expect(v.companies).toEqual([w.ownerA])
      expect(v.survey).toEqual([w.ownerA])
      expect(v.metrics).toEqual([w.ownerA])
      expect(v.documents).toEqual([w.ownerA])
      expect(v.diagnostics).toEqual([w.ownerA])
      const canB = await asUser(db, expert, async () =>
        (await db.query(`SELECT public.can_read_company($1) AS c`, [w.companyB])).rows[0].c,
      )
      expect(canB).toBe(false)
    }))

  it('R-004: a pending expert, even assigned, sees nothing', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const expert = await seedUser(db, { role: 'expert', status: 'pending_approval' })
      await assign(db, w.ownerA, expert)
      expect((await visibleOwners(db, expert, w)).companies).toEqual([])
    }))

  for (const role of ['super_expert', 'support']) {
    it(`R-004: ${role} with client_scope 'assigned' sees only assigned clients`, () =>
      inRollback(async (db) => {
        const w = await world(db)
        const staff = await seedStaff(db, role)
        await db.query(`UPDATE public.staff_roles SET client_scope = 'assigned' WHERE user_id = $1`, [staff])
        expect((await visibleOwners(db, staff, w)).companies).toEqual([])
        await assign(db, w.ownerB, staff)
        const v = await visibleOwners(db, staff, w)
        expect(v.companies).toEqual([w.ownerB])
        expect(v.metrics).toEqual([w.ownerB])
        expect(v.survey).toEqual([w.ownerB])
      }))
  }

  it("R-004: crm_manager / admin / super_admin always see every client, whatever client_scope says", () =>
    inRollback(async (db) => {
      const w = await world(db)
      for (const role of ['crm_manager', 'admin', 'super_admin']) {
        const staff = await seedStaff(db, role)
        await db.query(`UPDATE public.staff_roles SET client_scope = 'assigned' WHERE user_id = $1`, [staff])
        expect((await visibleOwners(db, staff, w)).companies, role).toEqual([w.ownerA, w.ownerB].sort())
      }
    }))

  it('R-004: hidden diagnostic findings follow the scope too', () =>
    inRollback(async (db) => {
      const w = await world(db)
      for (const company of [w.companyA, w.companyB]) {
        await db.query(
          `INSERT INTO public.diagnostic_findings (company_id, kind, area, title, provenance_type, confidence, produced_by, visible_to_client)
           VALUES ($1, 'risk', 'finance', 'Гипотеза', 'AI_HYPOTHESIS', 0.5, 'agent:diagnostic', FALSE)`,
          [company],
        )
      }
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      await assign(db, w.ownerA, expert)
      const rows = await asUser(db, expert, async () =>
        (await db.query(`SELECT company_id FROM public.diagnostic_findings WHERE company_id = ANY($1)`, [[w.companyA, w.companyB]])).rows,
      )
      expect(rows.map((r) => r.company_id)).toEqual([w.companyA])
    }))

  it('R-004: accessible_company_ids() follows the same scope', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      await assign(db, w.ownerB, expert)
      const ids = await asUser(db, expert, async () =>
        (await db.query(`SELECT x AS id FROM public.accessible_company_ids() x WHERE x = ANY($1)`, [[w.companyA, w.companyB]])).rows.map((r) => r.id),
      )
      expect(ids).toEqual([w.companyB])
    }))

  it('R-004: experts keep their expert paths on assigned clients only (point_a_insights)', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      await assign(db, w.ownerA, expert)
      const INSERT = `INSERT INTO public.point_a_insights (user_id, company_id, type, category, question_text, author_name, status)
                      VALUES ($1, $2, 'expert', 'finance', 'Как считать маржу?', 'Эксперт', 'awaiting_answer')`
      const ok = await asUser(db, expert, () => db.query(INSERT, [w.ownerA, w.companyA]))
      expect(ok.rowCount).toBe(1)
      expect(await pgErrorCode(asUser(db, expert, () => db.query(INSERT, [w.ownerB, w.companyB])))).toBe('42501')
    }))
})

describe.skipIf(!dbTestsEnabled)('R-228: a client inserts only role=user into ai_messages (141)', () => {
  afterAll(closeTestPool)

  const pending = path.resolve(__dirname, '../../../supabase/migrations/141_ai_messages_client_insert_user_only.sql')

  async function conversation(db: Db, owner: string): Promise<string> {
    const { rows } = await db.query(
      `INSERT INTO public.ai_conversations (user_id, surface, title) VALUES ($1, 'dashboard', 't') RETURNING id`,
      [owner],
    )
    return rows[0].id as string
  }

  it('R-228: role=assistant / update are refused for the client, role=user and reads still work', () =>
    inRollback(async (db) => {
      await db.query(fs.readFileSync(pending, 'utf8'))
      const owner = await seedUser(db, { status: 'approved' })
      const conv = await conversation(db, owner)
      const ins = (role: string) =>
        asUser(db, owner, () => db.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, $2, 'x')`, [conv, role]))
      expect((await ins('user')).rowCount).toBe(1)
      expect(await pgErrorCode(ins('assistant'))).toBe('42501')
      await db.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', 'server reply')`, [conv])
      const upd = await asUser(db, owner, () =>
        db.query(`UPDATE public.ai_messages SET content = 'forged', role = 'assistant' WHERE conversation_id = $1`, [conv]),
      )
      expect(upd.rowCount).toBe(0)
      const read = await asUser(db, owner, async () =>
        (await db.query(`SELECT role FROM public.ai_messages WHERE conversation_id = $1 ORDER BY role`, [conv])).rows.map((r) => r.role),
      )
      expect(read).toEqual(['assistant', 'user'])
      const stranger = await seedUser(db, { status: 'approved' })
      const foreign = asUser(db, stranger, () =>
        db.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', 'x')`, [conv]),
      )
      expect(await pgErrorCode(foreign)).toBe('42501')
    }))
})
