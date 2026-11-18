/**
 * Migration 155 (CRM revival 2026-11-18) on the real schema, each case in a rolled-back transaction:
 *   L1      an interaction / a reminder can only be attached to the user's OWN client (044 checked
 *           only user_id: a user could write a row of their own onto another user's client);
 *           the staff read policies of 140 still work;
 *   ids     crm_clients.external_source / external_id: one client per CRM contact (unique), both
 *           or neither (CHECK), any number of unlinked clients;
 *   M7      the legacy 'ok' becomes 'success';
 *   rollback 155 → rollback → rollback again → 155 → 155 again: the L1 hole is back after the
 *           rollback (so the L1 cases really test 155) and closed again after re-applying.
 */
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const UP = readFileSync('supabase/migrations/155_crm_sync_external_ids.sql', 'utf8')
const DOWN = readFileSync('supabase/migrations/rollback/155_crm_sync_external_ids.down.sql', 'utf8')

afterAll(closeTestPool)

async function client(db: Db, userId: string, name = 'Клиент'): Promise<string> {
  const { rows } = await db.query(`INSERT INTO public.crm_clients (user_id, name) VALUES ($1, $2) RETURNING id`, [userId, name])
  return rows[0].id as string
}
const addInteraction = (db: Db, as: string, clientId: string) =>
  asUser(db, as, () => db.query(`INSERT INTO public.crm_interactions (client_id, user_id, kind, comment) VALUES ($1, $2, 'note', 'x') RETURNING id`, [clientId, as]))
const addReminder = (db: Db, as: string, clientId: string) =>
  asUser(db, as, () => db.query(`INSERT INTO public.crm_reminders (client_id, user_id, due_at) VALUES ($1, $2, now()) RETURNING id`, [clientId, as]))

describe('rollback file of 155', () => {
  it('never touches the journal schema_migrations', () => {
    const code = DOWN.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(code).not.toMatch(/schema_migrations/i)
  })
})

describe.skipIf(!dbTestsEnabled)('migration 155', () => {
  it('L1: a user cannot attach an interaction or a reminder to another user\'s client, only to their own', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const stranger = await seedUser(db, { status: 'approved' })
      const ownersClient = await client(db, owner)
      const strangersClient = await client(db, stranger)

      expect(await pgErrorCode(addInteraction(db, stranger, ownersClient))).toBe('42501')
      expect(await pgErrorCode(addReminder(db, stranger, ownersClient))).toBe('42501')

      const own = await addInteraction(db, stranger, strangersClient)
      const ownReminder = await addReminder(db, stranger, strangersClient)
      expect(own.rows).toHaveLength(1)
      // Moving an own row onto someone else's client is refused as well.
      expect(await pgErrorCode(asUser(db, stranger, () => db.query(`UPDATE public.crm_interactions SET client_id = $1 WHERE id = $2`, [ownersClient, own.rows[0].id])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, stranger, () => db.query(`UPDATE public.crm_reminders SET client_id = $1 WHERE id = $2`, [ownersClient, ownReminder.rows[0].id])))).toBe('42501')
      // Own updates keep working.
      const upd = await asUser(db, stranger, () => db.query(`UPDATE public.crm_reminders SET status = 'done' WHERE id = $1 RETURNING id`, [ownReminder.rows[0].id]))
      expect(upd.rows).toHaveLength(1)

      expect((await addInteraction(db, owner, ownersClient)).rows).toHaveLength(1)
      const ownerRows = await db.query(`SELECT count(*)::int AS n FROM public.crm_interactions WHERE client_id = $1`, [ownersClient])
      expect(ownerRows.rows[0].n).toBe(1)
    }))

  it('the staff read policies of 140 still let an admin read a client\'s interactions', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const admin = await seedStaff(db, 'admin')
      const c = await client(db, owner)
      await addInteraction(db, owner, c)
      const seen = await asUser(db, admin, () => db.query(`SELECT id FROM public.crm_interactions WHERE client_id = $1`, [c]))
      expect(seen.rows).toHaveLength(1)
      const { rows } = await db.query(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('crm_interactions', 'crm_reminders') AND policyname LIKE '%sel_staff' ORDER BY 1`,
      )
      expect(rows.map((r) => r.policyname)).toEqual(['crm_interactions_sel_staff', 'crm_reminders_sel_staff'])
    }))

  it('external ids: one client per CRM contact, both or neither, unlinked clients never collide', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const other = await seedUser(db, { status: 'approved' })
      // Each insert in its own savepoint: a refused one leaves the transaction usable.
      const ins = (user: string, src: string | null, ext: string | null) =>
        asService(db, async () => {
          await db.query('SAVEPOINT ins')
          try {
            await db.query(`INSERT INTO public.crm_clients (user_id, name, external_source, external_id) VALUES ($1, 'К', $2, $3)`, [user, src, ext])
            await db.query('RELEASE SAVEPOINT ins')
          } catch (e) {
            await db.query('ROLLBACK TO SAVEPOINT ins')
            throw e
          }
        })
      await ins(owner, 'bitrix24:acme.bitrix24.kz', '7')
      expect(await pgErrorCode(ins(owner, 'bitrix24:acme.bitrix24.kz', '7'))).toBe('23505')
      await ins(owner, 'bitrix24:other.bitrix24.kz', '7')
      await ins(other, 'bitrix24:acme.bitrix24.kz', '7')
      expect(await pgErrorCode(ins(owner, null, '8'))).toBe('23514')
      expect(await pgErrorCode(ins(owner, 'bitrix24:acme.bitrix24.kz', null))).toBe('23514')
      await ins(owner, null, null)
      await ins(owner, null, null)
      // The sync's upsert target (no predicate, as PostgREST sends it) is accepted.
      await db.query(
        `INSERT INTO public.crm_clients (user_id, name, external_source, external_id) VALUES ($1, 'К', 'bitrix24:acme.bitrix24.kz', '7')
         ON CONFLICT (user_id, external_source, external_id) DO NOTHING`,
        [owner],
      )
    }))

  it('M7: re-applying turns the legacy status \'ok\' into \'success\'', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const { rows } = await db.query(
        `INSERT INTO public.crm_provider_connections (user_id, provider, base_url, access_token, last_sync_status) VALUES ($1, 'bitrix24', 'a.bitrix24.kz', 't', 'ok') RETURNING id`,
        [owner],
      )
      await db.query(UP)
      const after = await db.query(`SELECT last_sync_status FROM public.crm_provider_connections WHERE id = $1`, [rows[0].id])
      expect(after.rows[0].last_sync_status).toBe('success')
    }))

  it('155 → rollback → rollback → 155 → 155: the hole is back after the rollback and closed again after re-applying', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const stranger = await seedUser(db, { status: 'approved' })
      const ownersClient = await client(db, owner)
      const columns = async () =>
        (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'crm_clients' AND column_name IN ('external_source', 'external_id') ORDER BY 1`)).rows.map((r) => r.column_name)

      // SEC-P2-18: every auth.uid() of these policies in the initplan form (SELECT auth.uid()), in both states.
      const perRowAuthCalls = async () =>
        (await db.query(
          `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('crm_interactions', 'crm_reminders')
              AND (coalesce(qual, '') ~ '(?<!SELECT )auth\\.uid\\(\\)' OR coalesce(with_check, '') ~ '(?<!SELECT )auth\\.uid\\(\\)')`,
        )).rows.map((r) => r.policyname)
      expect(await perRowAuthCalls()).toEqual([])
      const definitions = async () =>
        (await db.query(
          `SELECT policyname, cmd, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('crm_interactions', 'crm_reminders') AND policyname ~ '_(ins|upd)_own$'
            ORDER BY policyname`,
        )).rows
      const with155 = await definitions()
      expect(with155.every((p) => /EXISTS/.test(p.with_check))).toBe(true)

      await db.query(DOWN)
      await db.query(DOWN)
      expect(await columns()).toEqual([])
      expect(await pgErrorCode(addInteraction(db, stranger, ownersClient))).toBeNull() // the 044 hole
      // Exactly the definitions before 155: 044 in the initplan form 096 gave them.
      const own = '(( SELECT auth.uid() AS uid) = user_id)'
      expect(await definitions()).toEqual([
        { policyname: 'crm_interactions_ins_own', cmd: 'INSERT', qual: null, with_check: own },
        { policyname: 'crm_interactions_upd_own', cmd: 'UPDATE', qual: own, with_check: own },
        { policyname: 'crm_reminders_ins_own', cmd: 'INSERT', qual: null, with_check: own },
        { policyname: 'crm_reminders_upd_own', cmd: 'UPDATE', qual: own, with_check: own },
      ])

      await db.query(UP)
      await db.query(UP)
      expect(await definitions()).toEqual(with155)
      expect(await perRowAuthCalls()).toEqual([])
      expect(await columns()).toEqual(['external_id', 'external_source'])
      expect(await pgErrorCode(addInteraction(db, stranger, ownersClient))).toBe('42501')
      expect(await pgErrorCode(addReminder(db, stranger, ownersClient))).toBe('42501')
      // The upsert target of the sync, without a predicate as PostgREST sends it, works on the re-applied index
      // (a partial index would refuse it: «no unique or exclusion constraint matching the ON CONFLICT specification»).
      const upsert = () => db.query(
        `INSERT INTO public.crm_clients (user_id, name, external_source, external_id) VALUES ($1, 'К', 'bitrix24:acme.bitrix24.kz', '1')
         ON CONFLICT (user_id, external_source, external_id) DO NOTHING RETURNING id`,
        [owner],
      )
      expect((await upsert()).rows).toHaveLength(1)
      expect((await upsert()).rows).toHaveLength(0)
    }))
})
