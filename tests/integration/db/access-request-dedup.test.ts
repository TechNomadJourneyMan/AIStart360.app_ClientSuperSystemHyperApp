/**
 * R2-A, migration 144: one OPEN paid-access request (source 'paywall') per
 * client — the unique partial index admin_requests_open_paywall_per_user that
 * closes the race of two simultaneous clicks (lib/access/upgrade-requests.ts
 * merges into the winner on 23505). Real schema of the disposable test DB
 * (scripts/test-db/setup.mjs); every case runs in a rolled-back transaction.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { closeTestPool, inRollback, type Db } from '../../helpers/pg-rls'

async function insert(db: Db, row: { userId: string; status?: string; source?: string; type?: string }): Promise<string | null> {
  await db.query('SAVEPOINT ins')
  try {
    await db.query(
      `INSERT INTO public.admin_requests (id, type, status, priority, source, payload, "createdAt", "updatedAt")
       VALUES ($1, $2::"AdminRequestType", $3::"AdminRequestStatus", 'medium', $4, $5::jsonb, now(), now())`,
      [randomUUID(), row.type ?? 'access', row.status ?? 'new', row.source ?? 'paywall', JSON.stringify({ userId: row.userId, features: ['point_a'] })],
    )
    await db.query('RELEASE SAVEPOINT ins')
    return null
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT ins')
    return (err as { code?: string }).code ?? 'unknown'
  }
}

describe.skipIf(!dbTestsEnabled)('admin_requests: one open paywall request per client (144)', () => {
  afterAll(closeTestPool)

  it('the index exists with the documented predicate', async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'admin_requests_open_paywall_per_user'`)
      expect(rows).toHaveLength(1)
      expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/)
      expect(rows[0].indexdef).toMatch(/payload ->> 'userId'/)
      expect(rows[0].indexdef).toMatch(/source = 'paywall'/)
    })
  })

  it('a second OPEN paywall request of the same client is refused (23505); another client is fine', async () => {
    await inRollback(async (db) => {
      const a = randomUUID()
      expect(await insert(db, { userId: a })).toBeNull()
      expect(await insert(db, { userId: a })).toBe('23505')
      expect(await insert(db, { userId: a, status: 'in_review' })).toBe('23505')
      expect(await insert(db, { userId: randomUUID() })).toBeNull()
    })
  })

  it('a closed request does not block a new one; closing the open one frees the slot', async () => {
    await inRollback(async (db) => {
      const a = randomUUID()
      for (const status of ['approved', 'rejected', 'archived']) expect(await insert(db, { userId: a, status })).toBeNull()
      expect(await insert(db, { userId: a })).toBeNull()
      await db.query(`UPDATE public.admin_requests SET status = 'approved' WHERE payload ->> 'userId' = $1 AND status = 'new'`, [a])
      expect(await insert(db, { userId: a })).toBeNull()
    })
  })

  it('older rows (upgrade_modal), registrations and other sources are not constrained', async () => {
    await inRollback(async (db) => {
      const a = randomUUID()
      expect(await insert(db, { userId: a, source: 'upgrade_modal' })).toBeNull()
      expect(await insert(db, { userId: a, source: 'upgrade_modal' })).toBeNull()
      expect(await insert(db, { userId: a, type: 'registration', source: 'register' })).toBeNull()
      expect(await insert(db, { userId: a, type: 'registration', source: 'register' })).toBeNull()
      expect(await insert(db, { userId: a })).toBeNull()
    })
  })
})
