/**
 * Migration 157 (CRM revival, wave 2) on the real schema, each case in a rolled-back transaction:
 *   M4      avg_check provenance: the trigger marks every owner write 'manual' (null when cleared),
 *           the sync's own write stays 'crm'; the CHECKs; the backfill of existing figures;
 *   M3      crm_sync_acquire_lease: one holder, an expired lease is taken over, never another
 *           user's connection;
 *   M1/race crm_sync_insert_clients skips any unique conflict; crm_sync_update_clients never fills a
 *           phone another client has and never links a contact another client already has;
 *   access  the functions: authenticated and service_role only (never anon); crm_sync_deals owner-only;
 *   rollback 157 → rollback → rollback → 157 → 157: everything gone after the rollback, then the same
 *           definitions again.
 */
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedUser, type Db } from '../../helpers/pg-rls'

const UP = readFileSync('supabase/migrations/157_crm_sync_catchup_lease_provenance.sql', 'utf8')
const DOWN = readFileSync('supabase/migrations/rollback/157_crm_sync_catchup_lease_provenance.down.sql', 'utf8')
const SRC = 'bitrix24:acme.bitrix24.kz'

afterAll(closeTestPool)

/** `sql` in its own savepoint, so a refused statement leaves the transaction usable. */
async function attempt(db: Db, sql: string, args: unknown[] = []) {
  await db.query('SAVEPOINT t157')
  try {
    const r = await db.query(sql, args)
    await db.query('RELEASE SAVEPOINT t157')
    return r
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT t157')
    throw e
  }
}
const source = async (db: Db, id: string) =>
  (await db.query(`SELECT avg_check::float8 AS avg, avg_check_source AS src FROM public.crm_clients WHERE id = $1`, [id])).rows[0] as { avg: number | null; src: string | null }
async function client(db: Db, user: string, cols: Record<string, unknown> = {}): Promise<string> {
  const keys = ['user_id', 'name', ...Object.keys(cols)]
  const vals = [user, 'К', ...Object.values(cols)]
  const { rows } = await db.query(`INSERT INTO public.crm_clients (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)
  return rows[0].id as string
}
async function connection(db: Db, user: string): Promise<string> {
  const { rows } = await db.query(`INSERT INTO public.crm_provider_connections (user_id, provider, base_url, access_token) VALUES ($1, 'bitrix24', 'a.bitrix24.kz', 't') RETURNING id`, [user])
  return rows[0].id as string
}

describe('rollback file of 157', () => {
  it('never touches the journal schema_migrations', () => {
    const code = DOWN.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(code).not.toMatch(/schema_migrations/i)
  })
})

describe.skipIf(!dbTestsEnabled)('migration 157', () => {
  it('M4: owner writes are «manual» (null when cleared); the sync keeps «crm»; a figure always has a source', () =>
    inRollback(async (db) => {
      await db.query(UP) // the functions and trigger exactly as in the file
      const owner = await seedUser(db, { status: 'approved' })
      const typed = await client(db, owner, { avg_check: 5000 })
      expect(await source(db, typed)).toEqual({ avg: 5000, src: 'manual' })
      const crm = await client(db, owner, { avg_check: 7000, avg_check_source: 'crm', external_source: SRC, external_id: '1' })
      expect((await source(db, crm)).src).toBe('crm')

      // An owner's edit that does not say where the figure comes from (an import, a script) is theirs.
      await asUser(db, owner, () => db.query(`UPDATE public.crm_clients SET avg_check = 7100 WHERE id = $1`, [crm]))
      expect(await source(db, crm)).toEqual({ avg: 7100, src: 'manual' })
      await asUser(db, owner, () => db.query(`UPDATE public.crm_clients SET avg_check = NULL WHERE id = $1`, [crm]))
      expect(await source(db, crm)).toEqual({ avg: null, src: null })
      // Other columns leave it alone.
      await asUser(db, owner, () => db.query(`UPDATE public.crm_clients SET note = 'x' WHERE id = $1`, [typed]))
      expect((await source(db, typed)).src).toBe('manual')

      // The sync's own write (crm_sync_apply_deal_totals) stays 'crm', and never touches 'manual'.
      const conn = await connection(db, owner)
      const pass = new Date().toISOString()
      await db.query(
        `INSERT INTO public.crm_sync_deals (connection_id, user_id, deal_id, contact_id, amount, pass_started_at) VALUES ($1, $2, 'd1', '1', 900, $3), ($1, $2, 'd2', '1', 1100, $3)`,
        [conn, owner, pass],
      )
      const { rows } = await asUser(db, owner, () => db.query(`SELECT * FROM public.crm_sync_apply_deal_totals($1, $2, $3, $4)`, [conn, owner, SRC, pass]))
      expect(rows[0]).toEqual({ updated: 1, cleared: 0 })
      expect(await source(db, crm)).toEqual({ avg: 1000, src: 'crm' })
      await db.query(`UPDATE public.crm_clients SET external_source = $2, external_id = '2' WHERE id = $1`, [typed, SRC])
      await asUser(db, owner, () => db.query(`SELECT * FROM public.crm_sync_apply_deal_totals($1, $2, $3, $4)`, [conn, owner, SRC, pass]))
      expect(await source(db, typed)).toEqual({ avg: 5000, src: 'manual' })
      // A 'crm' figure whose contact has no qualifying deal left is cleared; 'manual' ones stay.
      const lone = await client(db, owner, { avg_check: 300, avg_check_source: 'crm', external_source: SRC, external_id: '3' })
      const { rows: cleared } = await asUser(db, owner, () => db.query(`SELECT * FROM public.crm_sync_apply_deal_totals($1, $2, $3, $4)`, [conn, owner, SRC, pass]))
      expect(cleared[0]).toEqual({ updated: 0, cleared: 1 })
      expect(await source(db, lone)).toEqual({ avg: null, src: null })
      // The flag does not outlive the function: a later owner write in the same transaction is 'manual'.
      await db.query(`UPDATE public.crm_clients SET avg_check = 1200 WHERE id = $1`, [crm])
      expect((await source(db, crm)).src).toBe('manual')

      expect(await pgErrorCode(attempt(db, `UPDATE public.crm_clients SET avg_check_source = NULL, avg_check = 5 WHERE id = $1`, [typed]))).toBe('23514')
      expect(await pgErrorCode(attempt(db, `UPDATE public.crm_clients SET avg_check_source = 'robot' WHERE id = $1`, [typed]))).toBe('23514')
    }))

  it('M3: one lease holder; an expired lease is taken over; another user\'s connection never', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const stranger = await seedUser(db, { status: 'approved' })
      const conn = await connection(db, owner)
      const take = (as: string) => asUser(db, as, () => db.query(`SELECT public.crm_sync_acquire_lease($1, 60) AS t`, [conn])).then((r) => r.rows[0].t as string | null)
      const first = await take(owner)
      expect(first).toMatch(/^[0-9a-f-]{36}$/)
      expect(await take(owner)).toBeNull()
      expect(await take(stranger)).toBeNull()
      await db.query(`UPDATE public.crm_provider_connections SET sync_lease_until = now() - interval '1 second' WHERE id = $1`, [conn])
      expect(await take(stranger)).toBeNull() // RLS: not their connection, even when free
      const second = await take(owner)
      expect(second).toMatch(/^[0-9a-f-]{36}$/)
      expect(second).not.toBe(first)
    }))

  it('M1/race: inserts skip any unique conflict; updates never take another client\'s phone or contact, never overwrite, never re-insert', () =>
    inRollback(async (db) => {
      await db.query(UP) // the functions exactly as in the file
      const owner = await seedUser(db, { status: 'approved' })
      const holder = await client(db, owner, { phone: '+77010000001' })
      await client(db, owner, { external_source: SRC, external_id: '5' })
      const seen = new Date().toISOString()
      const ins = await asUser(db, owner, () => db.query(`SELECT * FROM public.crm_sync_insert_clients($1, $2, $3, $4)`, [owner, SRC, seen, JSON.stringify([
        { external_id: '1', name: 'Новый', phone: '+77010000001', phone_raw: null, email: null }, // phone taken
        { external_id: '5', name: 'Дубль', phone: null, phone_raw: null, email: null }, // contact taken
        { external_id: '6', name: '', phone: null, phone_raw: null, email: null },
      ])]))
      expect(ins.rows.map((r) => r.external_id)).toEqual(['6'])
      const six = ins.rows[0].id as string
      expect((await db.query(`SELECT name, source, external_seen_at FROM public.crm_clients WHERE id = $1`, [six])).rows[0]).toMatchObject({ name: 'Без имени', source: 'bitrix24' })

      const manual = await client(db, owner, {})
      const upd = await asUser(db, owner, () => db.query(`SELECT * FROM public.crm_sync_update_clients($1, $2, $3, $4)`, [owner, SRC, seen, JSON.stringify([
        { id: six, external_id: '6', name: 'Имя', phone: '+77010000001', phone_raw: '+7 701 000 0001', email: null, link: false },
        { id: manual, external_id: '5', name: 'Связать', phone: null, phone_raw: null, email: null, link: true }, // 5 has a client
      ])]))
      expect(upd.rows).toEqual([{ id: six, changed: true }])
      const row = (await db.query(`SELECT name, phone, phone_raw FROM public.crm_clients WHERE id = $1`, [six])).rows[0]
      expect(row).toEqual({ name: 'Имя', phone: null, phone_raw: null })
      expect((await db.query(`SELECT external_id FROM public.crm_clients WHERE id = $1`, [manual])).rows[0].external_id).toBeNull()
      expect((await db.query(`SELECT phone FROM public.crm_clients WHERE id = $1`, [holder])).rows[0].phone).toBe('+77010000001')

      // A non-empty field is never overwritten; a client deleted meanwhile is never re-inserted.
      const gone = await client(db, owner, { external_source: SRC, external_id: '8' })
      await db.query(`DELETE FROM public.crm_clients WHERE id = $1`, [gone])
      const again = await asUser(db, owner, () => db.query(`SELECT * FROM public.crm_sync_update_clients($1, $2, $3, $4)`, [owner, SRC, seen, JSON.stringify([
        { id: six, external_id: '6', name: 'Другое имя', phone: null, phone_raw: null, email: 'a@b.kz', link: false },
        { id: gone, external_id: '8', name: 'Из CRM', phone: null, phone_raw: null, email: null, link: false },
      ])]))
      expect(again.rows).toEqual([{ id: six, changed: true }])
      expect((await db.query(`SELECT name, email FROM public.crm_clients WHERE id = $1`, [six])).rows[0]).toEqual({ name: 'Имя', email: 'a@b.kz' })
      expect((await db.query(`SELECT count(*)::int AS n FROM public.crm_clients WHERE id = $1 OR external_id = '8'`, [gone])).rows[0].n).toBe(0)
    }))

  it('access: the functions for authenticated and service_role only; crm_sync_deals is the owner\'s', () =>
    inRollback(async (db) => {
      const { rows } = await db.query(`
        SELECT p.proname,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
               has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
               p.prosecdef AS definer
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname LIKE 'crm\\_%' ESCAPE '\\' ORDER BY 1`)
      expect(rows).toEqual([
        { proname: 'crm_clients_avg_check_provenance', anon: false, auth: false, service: true, definer: false },
        ...['crm_sync_acquire_lease', 'crm_sync_apply_deal_totals', 'crm_sync_insert_clients', 'crm_sync_relink', 'crm_sync_update_clients']
          .map((proname) => ({ proname, anon: false, auth: true, service: true, definer: false })),
      ])

      const owner = await seedUser(db, { status: 'approved' })
      const stranger = await seedUser(db, { status: 'approved' })
      const conn = await connection(db, owner)
      await db.query(`INSERT INTO public.crm_sync_deals (connection_id, user_id, deal_id, contact_id, amount, pass_started_at) VALUES ($1, $2, 'd', 'c', 1, now())`, [conn, owner])
      expect((await asUser(db, stranger, () => db.query(`SELECT * FROM public.crm_sync_deals WHERE connection_id = $1`, [conn]))).rows).toEqual([])
      expect(await pgErrorCode(asUser(db, stranger, () => db.query(
        `INSERT INTO public.crm_sync_deals (connection_id, user_id, deal_id, contact_id, amount, pass_started_at) VALUES ($1, $2, 'x', 'c', 1, now())`, [conn, owner],
      )))).toBe('42501')
      expect((await asUser(db, owner, () => db.query(`SELECT deal_id FROM public.crm_sync_deals WHERE connection_id = $1`, [conn]))).rows).toEqual([{ deal_id: 'd' }])
      expect(await pgErrorCode(asUser(db, null, () => db.query(`SELECT * FROM public.crm_sync_deals`)))).toBe('42501')
    }))

  it('157 → rollback → rollback → 157 → 157: all gone, then the same definitions; the backfill marks existing figures', () =>
    inRollback(async (db) => {
      const snapshot = async () => ({
        columns: (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
                                   WHERE table_schema = 'public' AND ((table_name = 'crm_clients' AND column_name IN ('avg_check_source', 'external_seen_at'))
                                      OR (table_name = 'crm_provider_connections' AND column_name LIKE 'sync\\_%' ESCAPE '\\')) ORDER BY 1, 2`)).rows,
        functions: (await db.query(`SELECT p.proname, md5(p.prosrc) AS src, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                     WHERE n.nspname = 'public' AND p.proname LIKE 'crm\\_%' ESCAPE '\\' ORDER BY 1`)).rows,
        policies: (await db.query(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'crm_sync_deals' ORDER BY 1`)).rows,
        triggers: (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.crm_clients'::regclass AND NOT tgisinternal ORDER BY 1`)).rows,
        checks: (await db.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.crm_clients'::regclass AND conname LIKE 'crm_clients_avg%' ORDER BY 1`)).rows,
        table: (await db.query(`SELECT to_regclass('public.crm_sync_deals') IS NOT NULL AS exists`)).rows[0].exists,
      })
      const before = await snapshot()
      expect(before.columns).toHaveLength(5)
      expect(before.functions).toHaveLength(6)
      expect(before.table).toBe(true)

      await db.query(DOWN)
      await db.query(DOWN)
      const after = await snapshot()
      expect(after).toEqual({ columns: [], functions: [], policies: [], triggers: [], checks: [], table: false })

      const owner = await seedUser(db, { status: 'approved' })
      const fromCrm = await client(db, owner, { avg_check: 3000, source: 'bitrix24' })
      const typed = await client(db, owner, { avg_check: 4000, source: 'csv' })
      const empty = await client(db, owner, {})

      await db.query(UP)
      await db.query(UP)
      expect(await snapshot()).toEqual(before)
      expect(await source(db, fromCrm)).toEqual({ avg: 3000, src: 'crm' })
      expect(await source(db, typed)).toEqual({ avg: 4000, src: 'manual' })
      expect(await source(db, empty)).toEqual({ avg: null, src: null })
    }))
})

// The service role reaches every function (the cron) — exercised end to end in crm-sync.test.ts.
void asService
