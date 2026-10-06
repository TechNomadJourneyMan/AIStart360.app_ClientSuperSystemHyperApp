/**
 * Migration 083 against a real Postgres with the production RLS policies.
 * Run: npm run test:db:setup && npm run test:db
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, pgErrorCode, seedUser } from '../../helpers/pg-rls'

describe.skipIf(!dbTestsEnabled)('083 security hardening', () => {
  afterAll(closeTestPool)

  describe('S1: signup trigger', () => {
    it('ignores a self-claimed staff role and keeps the account pending', () =>
      inRollback(async (db) => {
        const id = await seedUser(db, { userMeta: { role: 'super_admin', status: 'approved' } })
        const { rows } = await db.query('SELECT role, status FROM public.profiles WHERE id = $1', [id])
        expect(rows[0]).toEqual({ role: 'client', status: 'pending_approval' })
      }))

    it('allows the owner role from user metadata, still pending', () =>
      inRollback(async (db) => {
        const id = await seedUser(db, { userMeta: { role: 'owner' } })
        const { rows } = await db.query('SELECT role, status FROM public.profiles WHERE id = $1', [id])
        expect(rows[0]).toEqual({ role: 'owner', status: 'pending_approval' })
      }))

    it('trusts role and status from app metadata (service-role only)', () =>
      inRollback(async (db) => {
        const id = await seedUser(db, { appMeta: { role: 'expert', status: 'approved' } })
        const { rows } = await db.query('SELECT role, status FROM public.profiles WHERE id = $1', [id])
        expect(rows[0]).toEqual({ role: 'expert', status: 'approved' })
      }))
  })

  describe('S2: protected profile columns', () => {
    it('lets a user edit their name but not their tier, flags, role or approval', () =>
      inRollback(async (db) => {
        const id = await seedUser(db, { status: 'approved' })
        await asUser(db, id, () =>
          db.query(`UPDATE public.profiles SET full_name = 'Новое имя' WHERE id = $1`, [id]),
        )
        for (const patch of [
          `tier = 'pro'`,
          `feature_flags = '{"ai_chat":true}'::jsonb`,
          `role = 'super_admin'`,
          `approved_at = now()`,
        ]) {
          const code = await pgErrorCode(
            asUser(db, id, () => db.query(`UPDATE public.profiles SET ${patch} WHERE id = $1`, [id])),
          )
          expect(code, patch).toBe('42501')
        }
        const { rows } = await db.query('SELECT full_name, tier FROM public.profiles WHERE id = $1', [id])
        expect(rows[0]).toEqual({ full_name: 'Новое имя', tier: 'free' })
      }))

    it('lets a user unlink Telegram but not bind an arbitrary chat', () =>
      inRollback(async (db) => {
        const id = await seedUser(db, { status: 'approved' })
        await db.query(`UPDATE public.profiles SET telegram_chat_id = '111' WHERE id = $1`, [id])
        const bind = await pgErrorCode(
          asUser(db, id, () => db.query(`UPDATE public.profiles SET telegram_chat_id = '999' WHERE id = $1`, [id])),
        )
        expect(bind).toBe('42501')
        await asUser(db, id, () =>
          db.query(`UPDATE public.profiles SET telegram_chat_id = NULL WHERE id = $1`, [id]),
        )
        const { rows } = await db.query('SELECT telegram_chat_id FROM public.profiles WHERE id = $1', [id])
        expect(rows[0].telegram_chat_id).toBeNull()
      }))

    it('still lets the service role and platform admins change entitlements', () =>
      inRollback(async (db) => {
        const id = await seedUser(db, { status: 'approved' })
        await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [id])
        const admin = await seedUser(db, { role: 'admin', status: 'approved' })
        await asUser(db, admin, () =>
          db.query(`UPDATE public.profiles SET tier = 'free' WHERE id = $1`, [id]),
        )
        const { rows } = await db.query('SELECT tier FROM public.profiles WHERE id = $1', [id])
        expect(rows[0].tier).toBe('free')
      }))
  })

  describe('S3/S4: server-only tables and views', () => {
    it.each(['users', 'accounts', 'crm_integrations', 'shared_reports', 'mini_gri_leads', 'financial_snapshots'])(
      'anon and authenticated cannot read %s',
      (table) =>
        inRollback(async (db) => {
          const user = await seedUser(db, { status: 'approved' })
          expect(await pgErrorCode(asUser(db, null, () => db.query(`SELECT 1 FROM public.${table} LIMIT 1`)))).toBe('42501')
          expect(await pgErrorCode(asUser(db, user, () => db.query(`SELECT 1 FROM public.${table} LIMIT 1`)))).toBe('42501')
        }),
    )

    it('RLS-bypassing admin views are closed to API roles', () =>
      inRollback(async (db) => {
        const user = await seedUser(db, { status: 'approved' })
        for (const view of ['v_pending_users', 'v_client_diagnostics']) {
          expect(await pgErrorCode(asUser(db, user, () => db.query(`SELECT 1 FROM public.${view}`)))).toBe('42501')
        }
      }))
  })
})
