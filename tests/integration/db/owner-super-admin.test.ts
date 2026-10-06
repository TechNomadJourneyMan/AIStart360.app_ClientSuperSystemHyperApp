/**
 * Migration 099 (owner super_admin, legacy admins listed without access, no self-registered
 * 'owner') against the disposable Postgres. The migration is re-applied inside
 * a rolled-back transaction after seeding, which also proves it is idempotent.
 * Run: npm run test:db:setup && npm run test:db
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { closeTestPool, inRollback, seedUser, type Db } from '../../helpers/pg-rls'

const SQL = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/099_owner_super_admin.sql'), 'utf8')
const OWNER = 'technomadjourneyman@gmail.com'

async function apply(db: Db): Promise<string[]> {
  const notices: string[] = []
  const onNotice = (n: { message?: string }) => { if (n.message) notices.push(n.message) }
  db.on('notice', onNotice)
  try {
    await db.query(SQL)
  } finally {
    db.off('notice', onNotice)
  }
  return notices
}

async function access(db: Db, id: string) {
  const { rows } = await db.query(
    `SELECT p.role, p.status, s.role AS staff_role, s.granted_by
     FROM public.profiles p LEFT JOIN public.staff_roles s ON s.user_id = p.id WHERE p.id = $1`,
    [id],
  )
  return rows[0]
}

describe.skipIf(!dbTestsEnabled)('099 owner super_admin', () => {
  afterAll(closeTestPool)

  it('makes the owner account (any e-mail case) an approved super_admin with a staff_roles row', () =>
    inRollback(async (db) => {
      await db.query(`DELETE FROM auth.users WHERE lower(email) = $1`, [OWNER])
      const id = await seedUser(db, { email: 'TechnoMadJourneyman@Gmail.com' })
      expect(await access(db, id)).toMatchObject({ role: 'client', status: 'pending_approval', staff_role: null })

      const notices = await apply(db)
      expect(await access(db, id)).toMatchObject({ role: 'super_admin', status: 'approved', staff_role: 'super_admin' })
      expect(notices.some((n) => n.includes('is super_admin'))).toBe(true)

      // Idempotent: a second run changes nothing and does not fail.
      await apply(db)
      expect(await access(db, id)).toMatchObject({ role: 'super_admin', status: 'approved', staff_role: 'super_admin' })
    }))

  it('upgrades an existing lower staff_roles row of the owner to super_admin', () =>
    inRollback(async (db) => {
      await db.query(`DELETE FROM auth.users WHERE lower(email) = $1`, [OWNER])
      const id = await seedUser(db, { email: OWNER, status: 'approved' })
      await db.query(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, 'support')`, [id])
      await apply(db)
      expect(await access(db, id)).toMatchObject({ role: 'super_admin', staff_role: 'super_admin', granted_by: 'migration:099' })
    }))

  it('reports when the owner account does not exist and grants nothing', () =>
    inRollback(async (db) => {
      await db.query(`DELETE FROM auth.users WHERE lower(email) = $1`, [OWNER])
      const notices = await apply(db)
      expect(notices.some((n) => n.includes('not found in auth.users'))).toBe(true)
    }))

  it('lists other super_admin accounts without demoting them', () =>
    inRollback(async (db) => {
      const viaProfile = await seedUser(db, { email: 'other-sa@test.local', role: 'super_admin', status: 'approved' })
      const viaStaff = await seedUser(db, { email: 'staff-sa@test.local', status: 'approved' })
      await db.query(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, 'super_admin')`, [viaStaff])

      const notices = await apply(db)
      const report = notices.find((n) => n.includes('OTHER super_admin accounts')) ?? ''
      expect(report).toContain('other-sa@test.local')
      expect(report).toContain('staff-sa@test.local')
      expect(await access(db, viaProfile)).toMatchObject({ role: 'super_admin', status: 'approved' })
      expect(await access(db, viaStaff)).toMatchObject({ staff_role: 'super_admin' })
    }))

  it('lists approved legacy admin profiles without granting panel access (only the owner has it)', () =>
    inRollback(async (db) => {
      const approved = await seedUser(db, { email: 'legacy-admin@test.local', role: 'admin', status: 'approved' })
      const pending = await seedUser(db, { role: 'admin', status: 'pending_approval' })
      const alreadyStaff = await seedUser(db, { role: 'admin', status: 'approved' })
      await db.query(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, 'analyst')`, [alreadyStaff])

      const notices = await apply(db)
      expect(await access(db, approved)).toMatchObject({ staff_role: null })
      expect(await access(db, pending)).toMatchObject({ staff_role: null })
      expect(await access(db, alreadyStaff)).toMatchObject({ staff_role: 'analyst' })
      const report = notices.find((n) => n.includes('legacy admin profiles WITHOUT panel access')) ?? ''
      expect(report).toContain('legacy-admin@test.local')
    }))

  it('sign-up can no longer self-assign the legacy owner role', () =>
    inRollback(async (db) => {
      const id = await seedUser(db, { userMeta: { role: 'owner' } })
      expect(await access(db, id)).toMatchObject({ role: 'client', status: 'pending_approval' })
    }))

  it('removes the retired break_glass_enabled setting', () =>
    inRollback(async (db) => {
      await db.query(
        `INSERT INTO public.system_settings (key, value) VALUES ('break_glass_enabled', 'true'::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      )
      await apply(db)
      const { rowCount } = await db.query(`SELECT 1 FROM public.system_settings WHERE key = 'break_glass_enabled'`)
      expect(rowCount).toBe(0)
    }))
})
