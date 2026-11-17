/**
 * R4-A4: the rollbacks of migrations 141 and 142 (supabase/migrations/rollback/141_*.down.sql,
 * 142_*.down.sql). On the real schema of the disposable test DB (built with every migration), each
 * case in a transaction that is rolled back: migration → rollback → rollback again (idempotent) →
 * the migration again, and what each state really allows.
 */
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedUser, type Db } from '../../helpers/pg-rls'

const UP_141 = readFileSync('supabase/migrations/141_ai_messages_client_insert_user_only.sql', 'utf8')
const DOWN_141 = readFileSync('supabase/migrations/rollback/141_ai_messages_client_insert_user_only.down.sql', 'utf8')
const UP_142 = readFileSync('supabase/migrations/142_ops_backup_runs.sql', 'utf8')
const DOWN_142 = readFileSync('supabase/migrations/rollback/142_ops_backup_runs.down.sql', 'utf8')

afterAll(async () => {
  await closeTestPool()
})

describe('rollback files: what they promise in their header', () => {
  it('they never touch the journal schema_migrations (whoever rolls back records it)', () => {
    for (const sql of [DOWN_141, DOWN_142]) {
      const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
      expect(code).not.toMatch(/schema_migrations/i)
    }
  })
})

describe.skipIf(!dbTestsEnabled)('rollback of 141 — ai_messages owner policy', () => {
  type Policy = { policyname: string; cmd: string; qual: string | null; with_check: string | null }
  const ownerPolicies = (db: Db) =>
    db.query<Policy>(
      `SELECT policyname, cmd, qual, with_check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ai_messages' AND policyname LIKE 'ai_messages_owner%'
        ORDER BY policyname`,
    ).then((r) => r.rows)
  const surveyPolicies = (db: Db) =>
    db.query<{ policyname: string; permissive: string }>(
      `SELECT policyname, permissive FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ai_messages' AND policyname LIKE 'ai_messages_survey%'
        ORDER BY policyname`,
    ).then((r) => r.rows)

  async function conversation(db: Db, owner: string): Promise<string> {
    const { rows } = await db.query(
      `INSERT INTO public.ai_conversations (user_id, surface, title) VALUES ($1, 'dashboard', 't') RETURNING id`,
      [owner],
    )
    return rows[0].id as string
  }
  const insertAs = (db: Db, user: string, conv: string, role: string) =>
    asUser(db, user, () => db.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, $2, 'x')`, [conv, role]))

  it('141 → rollback → rollback again → 141: the 053 policy comes back (initplan form), then 141 applies again', () =>
    inRollback(async (db) => {
      const survey = await surveyPolicies(db)
      expect(survey.length).toBeGreaterThan(0)
      const owner = await seedUser(db, { status: 'approved' })
      const stranger = await seedUser(db, { status: 'approved' })
      const conv = await conversation(db, owner)

      // State after 141 (the test DB has it): only role=user from the owner.
      expect((await ownerPolicies(db)).map((p) => p.policyname)).toEqual([
        'ai_messages_owner_delete', 'ai_messages_owner_insert_user', 'ai_messages_owner_select',
      ])
      expect(await pgErrorCode(insertAs(db, owner, conv, 'assistant'))).toBe('42501')

      await db.query(DOWN_141)
      const restored = await ownerPolicies(db)
      expect(restored.map((p) => `${p.policyname}:${p.cmd}`)).toEqual(['ai_messages_owner_all:ALL'])
      // No per-row auth.uid() (tests/integration/db/tenant-write-guards.test.ts): every call is the initplan form.
      for (const expr of [restored[0].qual, restored[0].with_check]) {
        expect(expr).toContain('auth.uid()')
        expect(expr!.replace(/\(\s*SELECT auth\.uid\(\) AS uid\)/g, '')).not.toContain('auth.uid()')
      }
      // The old semantics really are back (R-228 re-opened): the owner may write role=assistant and update.
      expect((await insertAs(db, owner, conv, 'assistant')).rowCount).toBe(1)
      const upd = await asUser(db, owner, () => db.query(`UPDATE public.ai_messages SET content = 'edited' WHERE conversation_id = $1`, [conv]))
      expect(upd.rowCount).toBe(1)
      // …but still only in one's own conversation.
      expect(await pgErrorCode(insertAs(db, stranger, conv, 'user'))).toBe('42501')
      // The survey policies of 136/138 are untouched.
      expect(await surveyPolicies(db)).toEqual(survey)

      await db.query(DOWN_141) // idempotent
      expect((await ownerPolicies(db)).map((p) => p.policyname)).toEqual(['ai_messages_owner_all'])

      await db.query(UP_141)
      expect((await ownerPolicies(db)).map((p) => p.policyname)).toEqual([
        'ai_messages_owner_delete', 'ai_messages_owner_insert_user', 'ai_messages_owner_select',
      ])
      expect(await pgErrorCode(insertAs(db, owner, conv, 'assistant'))).toBe('42501')
      expect((await insertAs(db, owner, conv, 'user')).rowCount).toBe(1)
      expect(await surveyPolicies(db)).toEqual(survey)
    }))
})

describe.skipIf(!dbTestsEnabled)('rollback of 142 — journal of backups ops_backup_runs', () => {
  const exists = (db: Db) =>
    db.query<{ t: string | null }>(`SELECT to_regclass('public.ops_backup_runs')::text AS t`).then((r) => r.rows[0].t !== null)

  it('142 → rollback → rollback again → 142: the table goes, comes back empty with RLS, grants, checks and indexes', () =>
    inRollback(async (db) => {
      expect(await exists(db)).toBe(true)
      await db.query(`INSERT INTO public.ops_backup_runs (ok, kind, bytes, tables) VALUES (true, 'db', 2000000, 300)`)

      await db.query(DOWN_142)
      expect(await exists(db)).toBe(false)
      await db.query(DOWN_142) // idempotent
      expect(await exists(db)).toBe(false)

      await db.query(UP_142)
      expect(await exists(db)).toBe(true)
      expect((await db.query(`SELECT count(*)::int AS n FROM public.ops_backup_runs`)).rows[0].n).toBe(0)

      const rls = await db.query<{ on: boolean; policies: number }>(
        `SELECT c.relrowsecurity AS on,
                (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'ops_backup_runs') AS policies
           FROM pg_class c WHERE c.oid = 'public.ops_backup_runs'::regclass`,
      )
      expect(rls.rows[0]).toEqual({ on: true, policies: 0 })
      const grants = await db.query<{ role: string; sel: boolean; ins: boolean }>(
        `SELECT r AS role, has_table_privilege(r, 'public.ops_backup_runs', 'SELECT') AS sel,
                has_table_privilege(r, 'public.ops_backup_runs', 'INSERT') AS ins
           FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r ORDER BY r`,
      )
      expect(grants.rows).toEqual([
        { role: 'anon', sel: false, ins: false },
        { role: 'authenticated', sel: false, ins: false },
        { role: 'service_role', sel: true, ins: true },
      ])
      const indexes = await db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ops_backup_runs' ORDER BY 1`,
      )
      expect(indexes.rows.map((r) => r.indexname)).toEqual([
        'ops_backup_runs_kind_ok_finished_idx', 'ops_backup_runs_kind_started_idx', 'ops_backup_runs_pkey',
      ])

      // The writer of the journal (service role) works again; the checks hold.
      await asService(db, () => db.query(`INSERT INTO public.ops_backup_runs (ok, kind, error) VALUES (false, 'storage', 'x')`))
      await db.query('SAVEPOINT bad_kind')
      expect(await pgErrorCode(db.query(`INSERT INTO public.ops_backup_runs (ok, kind) VALUES (true, 'tape')`))).toBe('23514')
      await db.query('ROLLBACK TO SAVEPOINT bad_kind')
      await db.query(UP_142) // 142 itself is idempotent on top
      expect((await db.query(`SELECT count(*)::int AS n FROM public.ops_backup_runs`)).rows[0].n).toBe(1)
    }))
})
