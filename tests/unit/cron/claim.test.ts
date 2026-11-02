/**
 * lib/cron/claim.ts — the cross-instance claim behind the in-process scheduler. While a redeploy
 * overlaps (the new instance is up, the old one is still draining) both run the same ticker; the
 * claim is what keeps a digest from going out twice. A fake pool stands in for Postgres.
 */
import type { Pool } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pg = vi.hoisted(() => ({ Pool: vi.fn() }))
vi.mock('pg', () => ({ Pool: pg.Pool, default: { Pool: pg.Pool } }))

import { createPgCronClaim } from '@/lib/cron/claim'

const MINUTE = new Date('2026-11-02T04:00:00Z')
const PATH = '/api/cron/crm-digest'

/** `won` decides what every INSERT answers: a row when this process won the claim, none when it lost. */
function fakePool(won: () => boolean = () => true) {
  const query = vi.fn(async (text: string) => {
    if (/^\s*INSERT/i.test(text)) return { rows: won() ? [{ '?column?': 1 }] : [] }
    return { rows: [] }
  })
  return { query }
}
/** The fake only has to answer query(); createPgCronClaim asks for no more. */
const asPool = (fake: { query: ReturnType<typeof vi.fn> }) => fake as unknown as Pick<Pool, 'query'>
const inserts = (pool: { query: ReturnType<typeof vi.fn> }) =>
  pool.query.mock.calls.filter(([text]) => /^\s*INSERT/i.test(String(text)))
const creates = (pool: { query: ReturnType<typeof vi.fn> }) =>
  pool.query.mock.calls.filter(([text]) => /CREATE TABLE/i.test(String(text)))

beforeEach(() => {
  pg.Pool.mockReset()
})

describe('createPgCronClaim', () => {
  it('creates the cron_runs table once, then inserts the (path, minute) pair', async () => {
    const pool = fakePool()
    const claim = createPgCronClaim('postgres://unused.invalid/db', { pool: asPool(pool) })

    await expect(claim(PATH, MINUTE)).resolves.toBe(true)
    await expect(claim('/api/cron/reminders', new Date('2026-11-02T06:00:00Z'))).resolves.toBe(true)

    expect(creates(pool)).toHaveLength(1)
    const [create] = creates(pool)
    expect(String(create[0])).toMatch(/CREATE TABLE IF NOT EXISTS cron_runs/i)
    expect(String(create[0])).toMatch(/PRIMARY KEY \(path, minute\)/i)
    expect(String(create[0])).toMatch(/claimed_at timestamptz NOT NULL DEFAULT now\(\)/i)

    // the table exists before the first insert
    const firstInsertAt = pool.query.mock.calls.findIndex(([text]) => /^\s*INSERT/i.test(String(text)))
    const createAt = pool.query.mock.calls.findIndex(([text]) => /CREATE TABLE/i.test(String(text)))
    expect(createAt).toBeLessThan(firstInsertAt)

    expect(inserts(pool)).toHaveLength(2)
    const [insert] = inserts(pool)
    expect(String(insert[0])).toMatch(/ON CONFLICT DO NOTHING RETURNING 1/i)
    // an ISO string, so the minute does not depend on the time zone of the process
    expect(insert[1]).toEqual([PATH, '2026-11-02T04:00:00.000Z'])
  })

  it('answers true when it won the claim and false when another instance already had it', async () => {
    let wins = [true, false, false]
    const pool = fakePool(() => wins.shift() ?? false)
    const claim = createPgCronClaim('postgres://unused.invalid/db', { pool: asPool(pool) })

    expect(await claim(PATH, MINUTE)).toBe(true)
    expect(await claim(PATH, MINUTE)).toBe(false)
    expect(await claim(PATH, MINUTE)).toBe(false)
  })

  it('two claims racing on the first use still create the table once', async () => {
    const pool = fakePool()
    const claim = createPgCronClaim('postgres://unused.invalid/db', { pool: asPool(pool) })

    await Promise.all([claim(PATH, MINUTE), claim('/api/cron/reminders', MINUTE)])

    expect(creates(pool)).toHaveLength(1)
    expect(inserts(pool)).toHaveLength(2)
  })

  it('a failed CREATE rejects that claim and is tried again on the next one', async () => {
    const pool = fakePool()
    pool.query.mockRejectedValueOnce(new Error('connection refused'))
    const claim = createPgCronClaim('postgres://unused.invalid/db', { pool: asPool(pool) })

    await expect(claim(PATH, MINUTE)).rejects.toThrow('connection refused')
    expect(inserts(pool)).toHaveLength(0)

    await expect(claim(PATH, MINUTE)).resolves.toBe(true)
    expect(creates(pool)).toHaveLength(2)
    expect(inserts(pool)).toHaveLength(1)
  })

  it('a failed INSERT rejects: the caller must not take silence for a win', async () => {
    const pool = fakePool()
    const claim = createPgCronClaim('postgres://unused.invalid/db', { pool: asPool(pool) })
    await claim(PATH, MINUTE) // table is there
    pool.query.mockRejectedValueOnce(new Error('deadlock detected'))

    await expect(claim(PATH, new Date('2026-11-02T04:01:00Z'))).rejects.toThrow('deadlock detected')
  })

  it('opens no connection until the first claim, then uses a small pool of two', async () => {
    const created: { query: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[] = []
    pg.Pool.mockImplementation(function () {
      const pool = { ...fakePool(), on: vi.fn() }
      created.push(pool)
      return pool
    })

    const claim = createPgCronClaim('postgres://user:pw@db.invalid:5432/app')
    expect(pg.Pool).not.toHaveBeenCalled()

    await claim(PATH, MINUTE)
    await claim(PATH, new Date('2026-11-02T04:01:00Z'))

    expect(pg.Pool).toHaveBeenCalledTimes(1)
    expect(pg.Pool.mock.calls[0][0]).toMatchObject({ connectionString: 'postgres://user:pw@db.invalid:5432/app', max: 2 })
    // an idle client dropping must not become an unhandled 'error' that kills the server
    expect(created[0].on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})
