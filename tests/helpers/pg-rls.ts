/**
 * Helpers for exercising real RLS policies against the disposable test DB
 * (scripts/test-db/setup.mjs). They reproduce what PostgREST does for a
 * request: switch to the `anon` / `authenticated` role and publish the JWT
 * claims in `request.jwt.claims`, all inside a transaction that is rolled
 * back, so tests never leave rows behind.
 */
import pg from 'pg'
import { randomUUID } from 'node:crypto'

export type Db = pg.PoolClient

let pool: pg.Pool | null = null

export function testPool(): pg.Pool {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set')
  pool ??= new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 })
  return pool
}

export async function closeTestPool(): Promise<void> {
  await pool?.end()
  pool = null
}

/** Run `fn` in a transaction that always rolls back. */
export async function inRollback<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await testPool().connect()
  try {
    await db.query('BEGIN')
    return await fn(db)
  } finally {
    await db.query('ROLLBACK').catch(() => {})
    db.release()
  }
}

/** Execute `fn` as a PostgREST request from `userId` (or anon when null). */
export async function asUser<T>(db: Db, userId: string | null, fn: () => Promise<T>): Promise<T> {
  const role = userId ? 'authenticated' : 'anon'
  const claims = userId ? { sub: userId, role } : { role }
  await db.query('SAVEPOINT as_user')
  await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
  await db.query(`SET LOCAL ROLE ${role}`)
  try {
    const out = await fn()
    await db.query('RESET ROLE')
    await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    await db.query('RELEASE SAVEPOINT as_user')
    return out
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT as_user')
    await db.query('RESET ROLE')
    await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    throw err
  }
}

/** Execute `fn` with the service-role privileges (BYPASSRLS), like createServiceClient(). */
export async function asService<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
  await db.query('SET LOCAL ROLE service_role')
  try {
    return await fn()
  } finally {
    await db.query('RESET ROLE')
    await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
  }
}

export interface SeedUserOptions {
  role?: string
  status?: string
  email?: string
  userMeta?: Record<string, unknown>
  appMeta?: Record<string, unknown>
}

/**
 * Create an auth user the way GoTrue does (the handle_new_user trigger builds
 * the profile), then optionally force role/status like the server-side
 * service-role upserts in the app do.
 */
export async function seedUser(db: Db, opts: SeedUserOptions = {}): Promise<string> {
  const id = randomUUID()
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
     VALUES ($1, $2, $3, $4)`,
    [id, opts.email ?? `${id}@test.local`, opts.userMeta ?? {}, opts.appMeta ?? {}],
  )
  if (opts.role || opts.status) {
    await db.query(
      `UPDATE public.profiles SET role = coalesce($2, role), status = coalesce($3, status) WHERE id = $1`,
      [id, opts.role ?? null, opts.status ?? null],
    )
  }
  return id
}

/** Create a company owned by `userId` (companies.id is TEXT in prod). */
export async function seedCompany(db: Db, userId: string, name = 'Test Co'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES ($1, $2, $3, now()) RETURNING id`,
    [randomUUID(), name, userId],
  )
  return rows[0].id as string
}

/** Grant a GIGA staff role (staff_roles), approved profile. */
export async function seedStaff(db: Db, role: string): Promise<string> {
  const id = await seedUser(db, { status: 'approved', role: role === 'super_admin' ? 'super_admin' : 'client' })
  await db.query(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, $2)`, [id, role])
  return id
}

/** Postgres error code of a rejected promise (e.g. '42501' insufficient_privilege). */
export async function pgErrorCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown'
  }
}
