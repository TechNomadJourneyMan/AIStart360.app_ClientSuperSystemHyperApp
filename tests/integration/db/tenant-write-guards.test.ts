/**
 * Migration 096 on the real RLS policies and triggers:
 *   - clients cannot stamp another tenant's company_id on diagnostics,
 *     gri_assessments or survey_answers (review finding #1);
 *   - documents.file_url on INSERT must stay in the caller's own folder (#12);
 *   - staff_roles grants platform-wide reads only with users.sensitive (#13);
 *   - tenants read agent_* status/cost columns, never raw error text (#14);
 *   - Telegram identity columns are bound by the server only (#50);
 *   - owners see approved point_b_versions only (SEC-P2-14);
 *   - search_path pinned, auth.uid() in initplan form (SEC-P2-18).
 * Every test fails on a database built without 096.
 * Run: node scripts/test-db/setup.mjs --db aistart360_test && TEST_DATABASE_URL=… npx vitest run tests/integration/db
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import {
  asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedStaff, seedUser, type Db,
} from '../../helpers/pg-rls'

interface World {
  ownerA: string
  ownerB: string
  companyA: string
  companyB: string
}

async function world(db: Db): Promise<World> {
  const ownerA = await seedUser(db, { status: 'approved' })
  const ownerB = await seedUser(db, { status: 'approved' })
  const companyA = await seedCompany(db, ownerA, 'Victim Co')
  const companyB = await seedCompany(db, ownerB, 'Attacker Co')
  return { ownerA, ownerB, companyA, companyB }
}

async function addMember(db: Db, companyId: string, userId: string, role: string, status = 'active') {
  await db.query(
    `INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
    [companyId, userId, role, status],
  )
}

const insertDiagnostic = (db: Db, userId: string, companyId: string | null) =>
  db.query(
    `INSERT INTO public.diagnostics (user_id, company_id, overall_score, is_current, risks)
     VALUES ($1, $2, 3, true, '[{"text":"planted"}]'::jsonb) RETURNING id`,
    [userId, companyId],
  )

const insertGri = (db: Db, userId: string, companyId: string | null) =>
  db.query(
    `INSERT INTO public.gri_assessments (user_id, company_id, gri_index, is_current) VALUES ($1, $2, 1.0, true) RETURNING id`,
    [userId, companyId],
  )

const upsertSurvey = (db: Db, userId: string, companyId: string | null, key = 's1_company_name') =>
  db.query(
    `INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer)
     VALUES ($1, $2, 1, $3, '{"value":"x"}'::jsonb)
     ON CONFLICT (user_id, question_key) DO UPDATE SET company_id = EXCLUDED.company_id, answer = EXCLUDED.answer`,
    [userId, companyId, key],
  )

describe.skipIf(!dbTestsEnabled)('tenant write guards (096)', () => {
  afterAll(closeTestPool)

  describe('#1 company_id on client writes', () => {
    it('a client cannot plant rows into another company', () =>
      inRollback(async (db) => {
        const w = await world(db)
        expect(await pgErrorCode(asUser(db, w.ownerB, () => insertDiagnostic(db, w.ownerB, w.companyA)))).toBe('42501')
        expect(await pgErrorCode(asUser(db, w.ownerB, () => insertGri(db, w.ownerB, w.companyA)))).toBe('42501')
        expect(await pgErrorCode(asUser(db, w.ownerB, () => upsertSurvey(db, w.ownerB, w.companyA)))).toBe('42501')

        // …nor move an existing own row there.
        const gri = await asUser(db, w.ownerB, async () => (await insertGri(db, w.ownerB, w.companyB)).rows[0].id as string)
        await asUser(db, w.ownerB, () => upsertSurvey(db, w.ownerB, w.companyB))
        expect(await pgErrorCode(asUser(db, w.ownerB, () =>
          db.query(`UPDATE public.gri_assessments SET company_id = $2 WHERE id = $1`, [gri, w.companyA]))),
        ).toBe('42501')
        expect(await pgErrorCode(asUser(db, w.ownerB, () =>
          db.query(`UPDATE public.survey_answers SET company_id = $2 WHERE user_id = $1`, [w.ownerB, w.companyA]))),
        ).toBe('42501')

        // The victim's tenant view stays clean.
        const seen = await asUser(db, w.ownerA, async () => ({
          diagnostics: (await db.query(`SELECT 1 FROM public.diagnostics WHERE company_id = $1`, [w.companyA])).rowCount,
          gri: (await db.query(`SELECT 1 FROM public.gri_assessments WHERE company_id = $1`, [w.companyA])).rowCount,
          survey: (await db.query(`SELECT 1 FROM public.survey_answers WHERE company_id = $1`, [w.companyA])).rowCount,
        }))
        expect(seen).toEqual({ diagnostics: 0, gri: 0, survey: 0 })
      }))

    it('read-only and removed members cannot write company rows; managers can', () =>
      inRollback(async (db) => {
        const w = await world(db)
        const viewer = await seedUser(db, { status: 'approved' })
        const admin = await seedUser(db, { status: 'approved' })
        await addMember(db, w.companyA, viewer, 'viewer')
        await addMember(db, w.companyA, admin, 'admin')

        expect(await pgErrorCode(asUser(db, viewer, () => upsertSurvey(db, viewer, w.companyA)))).toBe('42501')
        expect(await pgErrorCode(asUser(db, admin, () => upsertSurvey(db, admin, w.companyA)))).toBeNull()

        // Removal revokes the write ability, also for rows written before.
        await addMember(db, w.companyA, admin, 'admin', 'removed')
        expect(await pgErrorCode(asUser(db, admin, () =>
          db.query(`UPDATE public.survey_answers SET answer = '{"value":"later"}' WHERE user_id = $1`, [admin]))),
        ).toBe('42501')
        // Detaching the row from the company is always allowed.
        expect(await pgErrorCode(asUser(db, admin, () => upsertSurvey(db, admin, null)))).toBeNull()
      }))

    it('keeps every legitimate writer working', () =>
      inRollback(async (db) => {
        const w = await world(db)
        // Owner, own company (recalculate / GRI / survey routes use the session client).
        expect(await pgErrorCode(asUser(db, w.ownerA, () => insertDiagnostic(db, w.ownerA, w.companyA)))).toBeNull()
        expect(await pgErrorCode(asUser(db, w.ownerA, () => insertGri(db, w.ownerA, w.companyA)))).toBeNull()
        expect(await pgErrorCode(asUser(db, w.ownerA, () => upsertSurvey(db, w.ownerA, w.companyA)))).toBeNull()
        expect(await pgErrorCode(asUser(db, w.ownerA, () => upsertSurvey(db, w.ownerA, w.companyA)))).toBeNull()
        // No company (expert notes, users without a company).
        expect(await pgErrorCode(asUser(db, w.ownerB, () => upsertSurvey(db, w.ownerB, null, 'gri_expert_team')))).toBeNull()
        // Service role (pipeline, medical onboarding, GIGA admin) and the direct connection (Prisma scoring).
        expect(await pgErrorCode(asService(db, () => insertDiagnostic(db, w.ownerA, w.companyA)))).toBeNull()
        expect(await pgErrorCode(asService(db, () => upsertSurvey(db, w.ownerA, w.companyA, 'medical_x')))).toBeNull()
        expect(await pgErrorCode(insertDiagnostic(db, w.ownerA, w.companyA))).toBeNull()
        expect(await pgErrorCode(insertGri(db, w.ownerA, w.companyA))).toBeNull()
        // An ex-owner still submits a new GRI: the current-flip trigger retires
        // their old assessment (former company) as the invoker.
        const exOwner = await seedUser(db, { status: 'approved' })
        await insertGri(db, exOwner, w.companyA)
        expect(await pgErrorCode(asUser(db, exOwner, () => insertGri(db, exOwner, null)))).toBeNull()
        const flags = await db.query(`SELECT company_id, is_current FROM public.gri_assessments WHERE user_id = $1 ORDER BY is_current`, [exOwner])
        expect(flags.rows).toEqual([{ company_id: w.companyA, is_current: false }, { company_id: null, is_current: true }])
        // …but cannot edit the content of that old row.
        expect(await pgErrorCode(asUser(db, exOwner, () =>
          db.query(`UPDATE public.gri_assessments SET gri_index = 9 WHERE user_id = $1 AND company_id = $2`, [exOwner, w.companyA]))),
        ).toBe('42501')
        // Legacy staff (profiles.role) editing a client's survey through survey_admin_insert.
        const manager = await seedUser(db, { status: 'approved', role: 'manager' })
        expect(await pgErrorCode(asUser(db, manager, () => upsertSurvey(db, w.ownerA, w.companyA, 's2_x')))).toBeNull()
      }))
  })

  describe('#12 documents.file_url on INSERT', () => {
    const insertDoc = (db: Db, userId: string, fileUrl: string) =>
      db.query(
        `INSERT INTO public.documents (user_id, file_name, file_url, doc_type) VALUES ($1, 'p.csv', $2, 'patient_base') RETURNING id`,
        [userId, fileUrl],
      )

    it('rejects paths outside the caller’s own folder', () =>
      inRollback(async (db) => {
        const w = await world(db)
        for (const url of [
          `${w.ownerA}/medical/1_patients.csv`,
          `${w.ownerB}/../${w.ownerA}/medical/1_patients.csv`,
          `${w.ownerB}/%2e%2e/${w.ownerA}/medical/1_patients.csv`,
          `${w.ownerB}/..%2F${w.ownerA}/x.csv`,
          `${w.ownerB}//x.csv`,
          `${w.ownerB}/x.csv?download=1`,
          `https://evil.example/${w.ownerB}/x.csv`,
          `../client-documents/${w.ownerA}/x.pdf`,
        ]) {
          expect(await pgErrorCode(asUser(db, w.ownerB, () => insertDoc(db, w.ownerB, url))), url).toBe('42501')
        }
        expect(await pgErrorCode(asUser(db, w.ownerB, () => insertDoc(db, w.ownerB, `${w.ownerB}/medical/1_patients.csv`)))).toBeNull()
        // The server (service role) still registers any stored path.
        expect(await pgErrorCode(asService(db, () => insertDoc(db, w.ownerA, `${w.ownerA}/medical/2_patients.csv`)))).toBeNull()
      }))
  })

  describe('#13 staff_roles and platform-wide reads', () => {
    it('only roles with users.sensitive read every tenant', () =>
      inRollback(async (db) => {
        const w = await world(db)
        await upsertSurvey(db, w.ownerA, w.companyA)
        const expected: Record<string, boolean> = {
          super_admin: true, admin: true, super_expert: true, crm_manager: true, support: true,
          content_manager: false, analyst: false,
        }
        for (const [role, allowed] of Object.entries(expected)) {
          const staff = await seedStaff(db, role)
          const got = await asUser(db, staff, async () => {
            const { rows } = await db.query(
              `SELECT public.is_platform_staff() AS staff, public.can_read_company($1) AS can_read`,
              [w.companyA],
            )
            const survey = (await db.query(`SELECT 1 FROM public.survey_answers WHERE company_id = $1`, [w.companyA])).rowCount
            return { staff: rows[0].staff, canRead: rows[0].can_read, survey }
          })
          expect(got, role).toEqual({ staff: allowed, canRead: allowed, survey: allowed ? 1 : 0 })
        }
      }))
  })

  describe('#14 agent_* columns visible to tenants', () => {
    it('tenants read status and cost, never raw error text or inputs', () =>
      inRollback(async (db) => {
        const w = await world(db)
        const { rows } = await db.query(
          `INSERT INTO public.agent_tasks (agent_key, company_id, trigger, input, last_error, last_error_code)
           VALUES ('metrics', $1, 'manual', '{"secret":"x"}'::jsonb, 'Raw query failed. Code: 23514', 'UNEXPECTED') RETURNING id`,
          [w.companyA],
        )
        const taskId = rows[0].id as string
        await db.query(
          `INSERT INTO public.agent_runs (task_id, agent_key, agent_version, company_id, attempt, error_code, error_message, input_summary)
           VALUES ($1, 'metrics', '1', $2, 1, 'UNEXPECTED', 'Invalid prisma.$executeRaw() invocation', 'company profile …')`,
          [taskId, w.companyA],
        )
        await db.query(
          `INSERT INTO public.agent_events (task_id, agent_key, company_id, level, type, message)
           VALUES ($1, 'metrics', $2, 'error', 'run.failed', 'UNEXPECTED: violates check constraint')`,
          [taskId, w.companyA],
        )

        for (const sql of [
          `SELECT error_message FROM public.agent_runs`,
          `SELECT input_summary FROM public.agent_runs`,
          `SELECT * FROM public.agent_runs`,
          `SELECT last_error FROM public.agent_tasks`,
          `SELECT input FROM public.agent_tasks`,
          `SELECT lease_token FROM public.agent_tasks`,
          `SELECT message FROM public.agent_events`,
          `SELECT data FROM public.agent_events`,
        ]) {
          expect(await pgErrorCode(asUser(db, w.ownerA, () => db.query(sql))), sql).toBe('42501')
        }

        const own = await asUser(db, w.ownerA, async () => ({
          tasks: (await db.query(`SELECT status, last_error_code FROM public.agent_tasks`)).rows,
          runs: (await db.query(`SELECT status, error_code, cost_usd FROM public.agent_runs`)).rowCount,
          events: (await db.query(`SELECT level, type FROM public.agent_events`)).rows,
        }))
        expect(own.tasks).toEqual([{ status: 'queued', last_error_code: 'UNEXPECTED' }])
        expect(own.runs).toBe(1)
        expect(own.events).toEqual([{ level: 'error', type: 'run.failed' }])
        // Other tenants still see nothing.
        const other = await asUser(db, w.ownerB, async () => (await db.query(`SELECT id FROM public.agent_tasks`)).rowCount)
        expect(other).toBe(0)
        // The server keeps full access.
        const full = await asService(db, async () => (await db.query(`SELECT error_message FROM public.agent_runs WHERE task_id = $1`, [taskId])).rows)
        expect(full).toEqual([{ error_message: 'Invalid prisma.$executeRaw() invocation' }])
      }))
  })

  describe('#50 Telegram identity on profiles', () => {
    it('a user may only clear telegram_* columns, never bind them', () =>
      inRollback(async (db) => {
        const user = await seedUser(db, { status: 'approved' })
        for (const [col, value] of [
          ['telegram_user_id', '777000111'],
          ['telegram_username', 'victim'],
          ['telegram_linked_at', new Date().toISOString()],
          ['telegram_link_token_hash', 'a'.repeat(64)],
          ['telegram_link_token_expires_at', new Date(Date.now() + 3600_000).toISOString()],
          ['telegram_link_code', 'ABC123'],
          ['telegram_chat_id', '777000111'],
        ] as const) {
          expect(await pgErrorCode(asUser(db, user, () =>
            db.query(`UPDATE public.profiles SET ${col} = $2 WHERE id = $1`, [user, value]))), col).toBe('42501')
        }
        // Bound by the server, then unlinked by the user.
        await db.query(
          `UPDATE public.profiles SET telegram_user_id = '777000111', telegram_username = 'me', telegram_linked_at = now(),
                  telegram_chat_id = '777000111' WHERE id = $1`,
          [user],
        )
        expect(await pgErrorCode(asUser(db, user, () => db.query(
          `UPDATE public.profiles SET telegram_user_id = NULL, telegram_username = NULL, telegram_linked_at = NULL,
                  telegram_chat_id = NULL, telegram_link_code = NULL WHERE id = $1`,
          [user],
        )))).toBeNull()
        // Ordinary self-edits still work.
        expect(await pgErrorCode(asUser(db, user, () =>
          db.query(`UPDATE public.profiles SET full_name = 'New Name' WHERE id = $1`, [user])))).toBeNull()
      }))
  })

  describe('SEC-P2-14 point_b_versions', () => {
    it('owners see approved versions only; staff see drafts too', () =>
      inRollback(async (db) => {
        const w = await world(db)
        const diag = (await insertDiagnostic(db, w.ownerA, w.companyA)).rows[0].id as string
        await db.query(
          `INSERT INTO public.point_b_versions (diagnostic_id, expert_notes, is_approved) VALUES ($1, 'approved', true), ($1, 'draft', false)`,
          [diag],
        )
        const notes = (uid: string) => asUser(db, uid, async () =>
          (await db.query(`SELECT expert_notes FROM public.point_b_versions ORDER BY expert_notes`)).rows.map((r) => r.expert_notes))
        expect(await notes(w.ownerA)).toEqual(['approved'])
        expect(await notes(w.ownerB)).toEqual([])
        const expert = await seedUser(db, { status: 'approved', role: 'expert' })
        expect(await notes(expert)).toEqual(['approved', 'draft'])
      }))
  })

  describe('SEC-P2-18 search_path and initplan auth calls', () => {
    it('no public function without a pinned search_path, no per-row auth.uid() in policies', () =>
      inRollback(async (db) => {
        const fns = await db.query(`
          SELECT p.proname FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
          WHERE n.nspname = 'public' AND d.objid IS NULL
            AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`)
        expect(fns.rows.map((r) => r.proname)).toEqual([])

        // profiles_select_own keeps the plain call on purpose: profiles_update_own
        // reads profiles in a sub-select, and a sub-select in profiles' own
        // SELECT policy makes Postgres report infinite recursion (see 096 §7b).
        const pols = await db.query(`
          SELECT schemaname || '.' || tablename || '.' || policyname AS p FROM pg_policies
          WHERE schemaname IN ('public', 'storage')
            AND (coalesce(qual, '') ~ '(?<!SELECT )auth\\.(uid|role|jwt)\\(\\)'
              OR coalesce(with_check, '') ~ '(?<!SELECT )auth\\.(uid|role|jwt)\\(\\)')`)
        expect(pols.rows.map((r) => r.p)).toEqual(['public.profiles.profiles_select_own'])
      }))
  })
})
