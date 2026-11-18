/**
 * Migration 156 (supabase/migrations/156_archive_legacy_crm_integrations.sql) and its rollback: the
 * legacy Prisma CRM table public.crm_integrations moves to the closed `archive` schema with its rows
 * (PO 2026-11-18: «в архив», nothing deleted), and back.
 *
 * The disposable test DB is built from prisma/schema.prisma + every migration; the Prisma model
 * CrmIntegration is archived too, so a fresh DB has no such table. Each case therefore puts a
 * stand-in with the legacy shape and the prod grants (084: closed to the API roles; service_role
 * keeps ALL) in public first — inside a transaction that is rolled back.
 */
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedUser, type Db } from '../../helpers/pg-rls'

const UP = readFileSync('supabase/migrations/156_archive_legacy_crm_integrations.sql', 'utf8')
const DOWN = readFileSync('supabase/migrations/rollback/156_archive_legacy_crm_integrations.down.sql', 'utf8')

afterAll(async () => {
  await closeTestPool()
})

describe('rollback file of 156: what its header promises', () => {
  it('never touches the journal schema_migrations', () => {
    const code = DOWN.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(code).not.toMatch(/schema_migrations/i)
  })
})

/** The legacy table as prod has it (Prisma CrmIntegration, 084 grants), with one connection row. */
async function legacyTable(db: Db) {
  await db.query(`DROP TABLE IF EXISTS public.crm_integrations`)
  await db.query(`DROP TABLE IF EXISTS archive.crm_integrations`)
  await db.query(
    `CREATE TABLE public.crm_integrations (
       id TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, provider TEXT NOT NULL, domain TEXT NOT NULL,
       "accessToken" TEXT NOT NULL, "webhookUrl" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
       "lastSyncStatus" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(), UNIQUE ("orgId", provider),
       -- as prod (Prisma relation to Organization): the key moves with the table
       CONSTRAINT crm_integrations_orgId_fkey FOREIGN KEY ("orgId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT)`,
  )
  await db.query(`ALTER TABLE public.crm_integrations ENABLE ROW LEVEL SECURITY`)
  await db.query(`REVOKE ALL ON TABLE public.crm_integrations FROM anon, authenticated`)
  await db.query(`GRANT ALL ON TABLE public.crm_integrations TO service_role`)
  await db.query(
    `INSERT INTO public.organizations (id, name, slug, "createdAt", "updatedAt") VALUES ('org-1', 'Org', 'org-1-legacy-crm', now(), now())
     ON CONFLICT (id) DO NOTHING`,
  )
  await db.query(
    `INSERT INTO public.crm_integrations (id, "orgId", provider, domain, "accessToken", "webhookUrl", "lastSyncStatus")
     VALUES ('legacy-1', 'org-1', 'bitrix24', 'example.bitrix24.kz', 'token-x', 'https://example.invalid/hook', 'partial')`,
  )
}

/** Where the legacy table is: in public, in archive (both flags, so «moved», not «copied»). */
const where = (db: Db) =>
  db.query<{ public: boolean; archive: boolean }>(
    `SELECT to_regclass('public.crm_integrations') IS NOT NULL AS public,
            to_regclass('archive.crm_integrations') IS NOT NULL AS archive`,
  ).then((r) => r.rows[0])

const rowsIn = (db: Db, schema: 'public' | 'archive') =>
  db.query<{ id: string; accessToken: string; webhookUrl: string | null }>(
    `SELECT id, "accessToken", "webhookUrl" FROM ${schema}.crm_integrations ORDER BY id`,
  ).then((r) => r.rows)

const schemaExists = (db: Db) =>
  db.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'archive'`).then((r) => r.rowCount === 1)

describe.skipIf(!dbTestsEnabled)('migration 156 — legacy crm_integrations to the archive schema', () => {
  it('moves the table with its rows; the API roles cannot read it there; service_role can', () =>
    inRollback(async (db) => {
      await legacyTable(db)
      const user = await seedUser(db, { status: 'approved' })

      await db.query(UP)
      expect(await where(db)).toEqual({ public: false, archive: true })
      // nothing lost: the row, its token and webhook are exactly as they were
      expect(await rowsIn(db, 'archive')).toEqual([
        { id: 'legacy-1', accessToken: 'token-x', webhookUrl: 'https://example.invalid/hook' },
      ])
      // closed: no USAGE on the schema for anon / authenticated (permission denied, 42501)
      expect(await pgErrorCode(asUser(db, null, () => db.query(`SELECT 1 FROM archive.crm_integrations`)))).toBe('42501')
      expect(await pgErrorCode(asUser(db, user, () => db.query(`SELECT 1 FROM archive.crm_integrations`)))).toBe('42501')
      // the server role still reads it (SQL only — PostgREST does not expose the schema)
      expect(await asService(db, () => db.query(`SELECT count(*)::int AS n FROM archive.crm_integrations`).then((r) => r.rows[0].n))).toBe(1)

      // the foreign key to organizations moved with the table (still enforced)
      const fk = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = t.relnamespace
          WHERE ns.nspname = 'archive' AND t.relname = 'crm_integrations' AND c.contype = 'f'`,
      )
      expect(fk.rows[0].n).toBe(1)

      // idempotent: again → same state, no error
      await db.query(UP)
      expect(await where(db)).toEqual({ public: false, archive: true })
      expect(await rowsIn(db, 'archive')).toHaveLength(1)
    }))

  it('rollback → back in public with its rows, still closed; the empty archive schema goes; again → no-op; 156 again → archived', () =>
    inRollback(async (db) => {
      await legacyTable(db)
      const user = await seedUser(db, { status: 'approved' })
      await db.query(UP)

      await db.query(DOWN)
      expect(await where(db)).toEqual({ public: true, archive: false })
      expect(await rowsIn(db, 'public')).toEqual([
        { id: 'legacy-1', accessToken: 'token-x', webhookUrl: 'https://example.invalid/hook' },
      ])
      expect(await pgErrorCode(asUser(db, user, () => db.query(`SELECT 1 FROM public.crm_integrations`)))).toBe('42501')
      expect(await schemaExists(db)).toBe(false)

      await db.query(DOWN)
      expect(await where(db)).toEqual({ public: true, archive: false })

      await db.query(UP)
      expect(await where(db)).toEqual({ public: false, archive: true })
      expect(await rowsIn(db, 'archive')).toHaveLength(1)
    }))

  it('without the legacy table (a fresh DB): only the closed, empty archive schema', () =>
    inRollback(async (db) => {
      await db.query(`DROP TABLE IF EXISTS public.crm_integrations`)
      await db.query(`DROP TABLE IF EXISTS archive.crm_integrations`)
      await db.query(UP)
      expect(await where(db)).toEqual({ public: false, archive: false })
      expect(await schemaExists(db)).toBe(true)
      const usage = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(
        `SELECT has_schema_privilege('anon', 'archive', 'USAGE') AS anon,
                has_schema_privilege('authenticated', 'archive', 'USAGE') AS auth,
                has_schema_privilege('service_role', 'archive', 'USAGE') AS service`,
      )
      expect(usage.rows[0]).toEqual({ anon: false, auth: false, service: true })
    }))

  it('a rollback leaves a non-empty archive schema in place (only the CRM table goes back)', () =>
    inRollback(async (db) => {
      await legacyTable(db)
      await db.query(UP)
      await db.query(`CREATE TABLE archive.something_else (id int)`)
      await db.query(DOWN)
      expect(await where(db)).toEqual({ public: true, archive: false })
      expect(await schemaExists(db)).toBe(true)
    }))
})
