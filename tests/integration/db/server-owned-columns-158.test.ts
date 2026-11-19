/**
 * Migration 158 (Round 5, wave 1) — data the client may not change — on the real schema, each case
 * in a rolled-back transaction:
 *   N5-2   profiles: email / id / created_at and the server-set columns (last_seen_at, vertical,
 *          widget_config, branding) are refused for the API roles — a client, a platform admin
 *          signed in with their own session, anon; what the UI edits under the session still saves
 *          (settings «Профиль», preferences, the expert profile, a Telegram unlink); the server
 *          (service_role, postgres) and the auth.users → profiles path (handle_new_user) keep working;
 *   R-139  profiles.telegram_link_code_expires_at: only the server sets it (a client may clear it);
 *   R-053в companies: the owner writes only the step-1 fields of the questionnaire and the revenue
 *          targets (column grants; the exact writes of /api/v1/onboarding/company and
 *          /api/v1/companies/targets); partner_id / status / domain / notes / user_id … are refused;
 *          the service role writes every column; updated_at is kept by the trigger;
 *   R-054  admin_purge_user leaves no answer history behind (the cascade writes history rows of its
 *          own) and is all-or-nothing;
 *   R-055  profiles.approved_by ON DELETE SET NULL (validated): purging an approver works;
 *   R-152  email_deliveries: 'pending' + claimed_at;
 *   rollback 158 → rollback → rollback → 158 → 158: the previous definitions, then the same again.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const FILE = 'supabase/migrations/158_server_owned_columns.sql'
const DOWN_FILE = 'supabase/migrations/rollback/158_server_owned_columns.down.sql'
const up = () => readFileSync(FILE, 'utf8')
const down = () => readFileSync(DOWN_FILE, 'utf8')

afterAll(closeTestPool)

/** `sql` in its own savepoint, so a refused statement leaves the transaction usable. */
async function attempt(db: Db, sql: string, args: unknown[] = []) {
  await db.query('SAVEPOINT t158')
  try {
    const r = await db.query(sql, args)
    await db.query('RELEASE SAVEPOINT t158')
    return r
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT t158')
    throw e
  }
}
const asOwner = (db: Db, user: string, sql: string, args: unknown[] = []) => asUser(db, user, () => attempt(db, sql, args))
const profile = async (db: Db, id: string) => (await db.query(`SELECT * FROM public.profiles WHERE id = $1`, [id])).rows[0] as Record<string, unknown> | undefined

/** The real storage.objects has owner_id (TEXT); an old local stub may not. */
async function ensureStorageOwnerId(db: Db) {
  const { rows } = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id'`)
  if (!rows[0]) await db.query(`ALTER TABLE storage.objects ADD COLUMN owner_id TEXT`)
}

/** The writes of /api/v1/onboarding/company (OnboardingCompanyBody + updated_at) and /api/v1/companies/targets. */
const STEP1 = {
  name: 'ТОО Ромашка', industry: 'Розница', employee_count: 12, founded_at: '2019-05-01', business_model: 'B2C',
  regions: ['Алматы', 'Астана'], contact_name: 'Айгерим', contact_position: 'CEO', contact_phone: '+77010000000', contact_email: 'a@romashka.kz',
}
const STEP1_COLS = Object.keys(STEP1)
async function onboardingUpdate(db: Db, owner: string, company: string) {
  const sets = STEP1_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')
  return asOwner(db, owner, `UPDATE public.companies SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [company, ...Object.values(STEP1)])
}

async function probeIdentityGuardActive(db: Db, client: string): Promise<boolean> {
  return (await pgErrorCode(asOwner(db, client, `UPDATE public.profiles SET email = 'x-' || email WHERE id = $1`, [client]))) === '42501'
}
async function probeCompanyGrantsActive(db: Db, owner: string, company: string): Promise<boolean> {
  return (await pgErrorCode(asOwner(db, owner, `UPDATE public.companies SET notes = 'x' WHERE id = $1`, [company]))) === '42501'
}
async function approvedByRule(db: Db) {
  return (await db.query(`SELECT confdeltype, convalidated FROM pg_constraint WHERE conname = 'profiles_approved_by_fkey' AND conrelid = 'public.profiles'::regclass`)).rows[0] as { confdeltype: string; convalidated: boolean } | undefined
}
async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  return Boolean((await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [table, column])).rows[0])
}

describe('rollback file of 158', () => {
  it('never touches the journal schema_migrations', () => {
    const code = down().split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(code).not.toMatch(/schema_migrations/i)
  })
})

describe.skipIf(!dbTestsEnabled)('migration 158', () => {
  it('N5-2: a client cannot change their own e-mail (nor id, created_at or a server-set column) through PostgREST', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved', email: `c-${randomUUID()}@test.local` })
      const before = await profile(db, client)
      for (const [col, value] of [
        ['email', 'owner@example.test'], ['id', randomUUID()], ['created_at', '2000-01-01T00:00:00Z'],
        ['last_seen_at', '2000-01-01T00:00:00Z'], ['vertical', 'medical'], ['widget_config', '["all"]'], ['branding', '{"product_name":"X"}'],
      ] as const) {
        expect(await pgErrorCode(asOwner(db, client, `UPDATE public.profiles SET ${col} = $2 WHERE id = $1`, [client, value])), col).toBe('42501')
      }
      // Also with the e-mail only differing in case, and with an allowed column in the same statement.
      expect(await pgErrorCode(asOwner(db, client, `UPDATE public.profiles SET full_name = 'Имя', email = upper(email) WHERE id = $1`, [client]))).toBe('42501')
      const after = await profile(db, client)
      expect(after?.email).toBe(before?.email)
      expect(after?.full_name).toBe(before?.full_name)
      // anon has no row to update at all.
      const { rowCount } = await asUser(db, null, () => db.query(`UPDATE public.profiles SET email = 'x@x' WHERE id = $1`, [client]))
      expect(rowCount).toBe(0)
    }))

  it('N5-2: a platform admin signed in with their own session cannot change their e-mail either (the GIGA owner login looks profiles up by it)', () =>
    inRollback(async (db) => {
      const admin = await seedStaff(db, 'super_admin')
      expect(await pgErrorCode(asOwner(db, admin, `UPDATE public.profiles SET email = 'owner@example.test' WHERE id = $1`, [admin]))).toBe('42501')
      // What the existing guard already allows an admin stays allowed.
      await asOwner(db, admin, `UPDATE public.profiles SET full_name = 'Админ' WHERE id = $1`, [admin])
      expect((await profile(db, admin))?.full_name).toBe('Админ')
    }))

  it('N5-2: what the UI edits under the session still saves (settings, preferences, expert profile, Telegram unlink)', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      await db.query(`UPDATE public.profiles SET telegram_chat_id = '42', telegram_link_code = 'abc', telegram_link_code_expires_at = now() + interval '15 minutes' WHERE id = $1`, [client])
      // /api/v1/settings/profile PATCH
      await asOwner(db, client, `UPDATE public.profiles SET full_name = $2, position = $3, organization = $4, phone = $5 WHERE id = $1 RETURNING full_name, email, position, organization, phone, avatar_url`, [client, 'Айгерим', 'CEO', 'ТОО', '+77010000000'])
      // /api/v1/settings/preferences PATCH, mascot settings
      await asOwner(db, client, `UPDATE public.profiles SET preferences = $2::jsonb WHERE id = $1`, [client, '{"theme":"dark"}'])
      // /api/expert/profile PATCH (expert_title, full_name, avatar_url)
      await asOwner(db, client, `UPDATE public.profiles SET expert_title = 'Эксперт', avatar_url = 'https://x/a.png' WHERE id = $1`, [client])
      // A user may unlink Telegram (set to NULL), including the new expiry.
      await asOwner(db, client, `UPDATE public.profiles SET telegram_chat_id = NULL, telegram_link_code = NULL, telegram_link_code_expires_at = NULL WHERE id = $1`, [client])
      const p = await profile(db, client)
      expect(p).toMatchObject({ full_name: 'Айгерим', position: 'CEO', organization: 'ТОО', phone: '+77010000000', expert_title: 'Эксперт', avatar_url: 'https://x/a.png', telegram_chat_id: null, telegram_link_code: null, telegram_link_code_expires_at: null })
      expect(p?.preferences).toEqual({ theme: 'dark' })
    }))

  it('R-139: only the server sets the link-code expiry', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      expect(await pgErrorCode(asOwner(db, client, `UPDATE public.profiles SET telegram_link_code_expires_at = now() + interval '1 year' WHERE id = $1`, [client]))).toBe('42501')
      await asService(db, () => db.query(`UPDATE public.profiles SET telegram_link_code = 'c0de', telegram_link_code_expires_at = now() + interval '15 minutes' WHERE id = $1`, [client]))
      expect((await profile(db, client))?.telegram_link_code_expires_at).toBeInstanceOf(Date)
    }))

  it('N5-2: the server changes e-mail (service_role, postgres); a new auth user still gets a profile with its e-mail', () =>
    inRollback(async (db) => {
      const email = `new-${randomUUID()}@test.local`
      const client = await seedUser(db, { email }) // auth.users INSERT → handle_new_user
      expect((await profile(db, client))?.email).toBe(email)
      await asService(db, () => db.query(`UPDATE public.profiles SET email = 'svc-' || email, last_seen_at = now(), vertical = 'medical', widget_config = '[]' WHERE id = $1`, [client]))
      expect((await profile(db, client))?.email).toBe(`svc-${email}`)
      await db.query(`UPDATE public.profiles SET email = $2 WHERE id = $1`, [client, email]) // migrations / psql
      expect((await profile(db, client))?.email).toBe(email)
      // There is no auth.users UPDATE → profiles sync: an auth e-mail change does not reach profiles.
      const { rows } = await db.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal AND (tgtype & 16) <> 0`,
      )
      expect(rows).toEqual([])
    }))

  it('R-053в: the owner writes the step-1 fields and the revenue targets, exactly as the two routes do', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      // /api/v1/onboarding/company POST, first time: INSERT {...fields, user_id} RETURNING *
      const cols = ['user_id', ...STEP1_COLS]
      const { rows: inserted } = await asOwner(db, owner,
        `INSERT INTO public.companies (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        [owner, ...Object.values(STEP1)])
      const company = inserted[0].id as string
      expect(inserted[0]).toMatchObject({ name: 'ТОО Ромашка', user_id: owner, status: 'lead', partner_id: null })
      // …then UPDATE {...fields, updated_at} RETURNING *
      await db.query(`UPDATE public.companies SET updated_at = now() - interval '1 day' WHERE id = $1`, [company])
      const { rows: updated } = await onboardingUpdate(db, owner, company)
      expect(updated[0]).toMatchObject({ contact_email: 'a@romashka.kz', employee_count: 12, regions: ['Алматы', 'Астана'] })
      expect(Date.now() - new Date(updated[0].updated_at).getTime()).toBeLessThan(60_000)
      // /api/v1/companies/targets PATCH: UPDATE … WHERE user_id = me RETURNING id, targets
      const { rows: targets } = await asOwner(db, owner,
        `UPDATE public.companies SET target_revenue_12m_kzt = $2, target_revenue_3y_kzt = $3 WHERE user_id = $1 RETURNING id, target_revenue_12m_kzt, target_revenue_3y_kzt`,
        [owner, 120_000_000, null])
      expect(targets[0]).toMatchObject({ id: company, target_revenue_3y_kzt: null })
      expect(Number(targets[0].target_revenue_12m_kzt)).toBe(120_000_000)
    }))

  it('R-053в: the owner cannot set partner_id, status, domain, notes, stage, size, ownership or timestamps', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      const partner = (await db.query(`INSERT INTO public.partner_organizations (name, slug) VALUES ('P', 'p-' || gen_random_uuid()) RETURNING id`)).rows[0].id as string
      for (const [col, value] of [
        ['partner_id', partner], ['status', 'active'], ['domain', `d-${randomUUID()}.kz`], ['notes', 'staff note'], ['stage', 'Growth'],
        ['size', 'large'], ['user_id', owner], ['id', `x-${randomUUID()}`], ['created_at', '2000-01-01T00:00:00Z'],
        ['"createdAt"', '2000-01-01T00:00:00'], ['"updatedAt"', '2000-01-01T00:00:00'],
      ] as const) {
        expect(await pgErrorCode(asOwner(db, owner, `UPDATE public.companies SET ${col} = $2 WHERE id = $1`, [company, value])), col).toBe('42501')
      }
      // A first company with a server-owned column is refused as well.
      const other = await seedUser(db, { status: 'approved' })
      expect(await pgErrorCode(asOwner(db, other, `INSERT INTO public.companies (user_id, name, partner_id) VALUES ($1, 'X', $2)`, [other, partner]))).toBe('42501')
      expect(await pgErrorCode(asOwner(db, other, `INSERT INTO public.companies (user_id, name, status) VALUES ($1, 'X', 'active')`, [other]))).toBe('42501')
      expect(await pgErrorCode(asUser(db, null, () => attempt(db, `INSERT INTO public.companies (name) VALUES ('anon')`)))).toBe('42501')
      // The service role (GIGA, medical onboarding, registration) writes every column.
      await asService(db, () => db.query(`UPDATE public.companies SET partner_id = $2, status = 'active', notes = 'n', stage = 'Growth' WHERE id = $1`, [company, partner]))
      const row = (await db.query(`SELECT partner_id, status, notes FROM public.companies WHERE id = $1`, [company])).rows[0]
      expect(row).toMatchObject({ partner_id: partner, status: 'active', notes: 'n' })
    }))

  it('R-054: purge leaves no answer history behind — the cascade writes history rows of its own', () =>
    inRollback(async (db) => {
      await ensureStorageOwnerId(db)
      const user = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, user)
      await db.query(
        `INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer, answered_at) VALUES ($1, $2, 1, 's1_company_name', '"Ромашка"', now()), ($1, $2, 1, 's1_industry', '"Розница"', now())`,
        [user, company],
      )
      expect(Number((await db.query(`SELECT count(*) FROM public.survey_answer_history WHERE user_id = $1`, [user])).rows[0].count)).toBeGreaterThan(0)
      const { rows } = await asService(db, () => db.query(`SELECT public.admin_purge_user($1, false) AS r`, [user]))
      expect(rows[0].r).toMatchObject({ found: true, dry_run: false })
      for (const [table, col] of [['survey_answer_history', 'user_id'], ['survey_answers', 'user_id'], ['profiles', 'id'], ['companies', 'user_id']] as const) {
        expect(Number((await db.query(`SELECT count(*) FROM public.${table} WHERE ${col} = $1`, [user])).rows[0].count), table).toBe(0)
      }
      expect((await db.query(`SELECT 1 FROM auth.users WHERE id = $1`, [user])).rows).toEqual([])
    }))

  it('R-054: purge is all-or-nothing — a failing last step keeps the history, the answers and the account', () =>
    inRollback(async (db) => {
      await ensureStorageOwnerId(db)
      const user = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, user)
      await db.query(`INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer, answered_at) VALUES ($1, $2, 1, 's1_company_name', '"Ромашка"', now())`, [user, company])
      const history = Number((await db.query(`SELECT count(*) FROM public.survey_answer_history WHERE user_id = $1`, [user])).rows[0].count)
      await db.query(`CREATE FUNCTION pg_temp.t158_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'auth delete refused (test)'; END $f$`)
      await db.query(`CREATE TRIGGER t158_refuse BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION pg_temp.t158_refuse()`)
      const err = await pgErrorCode(asService(db, () => attempt(db, `SELECT public.admin_purge_user($1, false)`, [user])))
      expect(err).toBe('P0001')
      expect(Number((await db.query(`SELECT count(*) FROM public.survey_answer_history WHERE user_id = $1`, [user])).rows[0].count)).toBe(history)
      expect((await db.query(`SELECT 1 FROM public.survey_answers WHERE user_id = $1`, [user])).rows).toHaveLength(1)
      expect(await profile(db, user)).toBeTruthy()
      await db.query(`DROP TRIGGER t158_refuse ON auth.users`)
    }))

  it('R-055: approved_by is ON DELETE SET NULL (validated) — purging the approver keeps the approved user', () =>
    inRollback(async (db) => {
      await ensureStorageOwnerId(db)
      expect(await approvedByRule(db)).toEqual({ confdeltype: 'n', convalidated: true })
      const approver = await seedUser(db, { status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      await db.query(`UPDATE public.profiles SET approved_by = $2, approved_at = now() WHERE id = $1`, [client, approver])
      await asService(db, () => db.query(`SELECT public.admin_purge_user($1, false)`, [approver]))
      expect(await profile(db, client)).toMatchObject({ status: 'approved', approved_by: null })
    }))

  it('R-152: an e-mail claim may be «pending» and records when it was claimed', () =>
    inRollback(async (db) => {
      const { rows } = await asService(db, () => db.query(
        `INSERT INTO public.email_deliveries (kind, recipient, subject, dedupe_key, status) VALUES ('notification', 'a@b.kz', 'S', $1, 'pending') RETURNING status, claimed_at`,
        [`t158:${randomUUID()}`],
      ))
      expect(rows[0].status).toBe('pending')
      expect(rows[0].claimed_at).toBeInstanceOf(Date)
      expect(await pgErrorCode(attempt(db, `INSERT INTO public.email_deliveries (kind, recipient, subject, status) VALUES ('notification', 'a@b.kz', 'S', 'queued')`))).toBe('23514')
    }))

  it('rollback: 158 → down → down → up → up restores the previous definitions, then the same again', () =>
    inRollback(async (db) => {
      await ensureStorageOwnerId(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      await asService(db, () => db.query(
        `INSERT INTO public.email_deliveries (kind, recipient, subject, dedupe_key, status) VALUES ('notification', 'a@b.kz', 'S', $1, 'pending')`,
        [`t158:${randomUUID()}`],
      ))
      const check = async (applied: boolean) => {
        expect(await probeIdentityGuardActive(db, client)).toBe(applied)
        expect(await probeCompanyGrantsActive(db, client, company)).toBe(applied)
        expect((await approvedByRule(db))?.confdeltype).toBe(applied ? 'n' : 'a')
        expect((await approvedByRule(db))?.convalidated).toBe(true)
        expect(await hasColumn(db, 'profiles', 'telegram_link_code_expires_at')).toBe(applied)
        expect(await hasColumn(db, 'email_deliveries', 'claimed_at')).toBe(applied)
        const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_purge_user(uuid, boolean)'::regprocedure`)).rows[0].prosrc as string
        // 158 deletes the answer history after the profile and the account (the cascade writes history rows).
        expect(src.indexOf('survey_answer_history') > src.indexOf('DELETE FROM auth.users')).toBe(applied)
      }
      await check(true)
      await db.query(down())
      // A pending claim becomes «sent» (the meaning a claim had before 158): never sent twice.
      expect((await db.query(`SELECT count(*) FROM public.email_deliveries WHERE status = 'pending'`)).rows[0].count).toBe('0')
      await check(false)
      await db.query(down())
      await check(false)
      await db.query(up())
      await check(true)
      await db.query(up())
      await check(true)
    }))
})
