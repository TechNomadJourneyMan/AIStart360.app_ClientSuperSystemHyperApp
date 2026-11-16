/**
 * scripts/ops/inngest-history-prune.sql (R4-A1, N4A-8) against a throwaway database on the local
 * test server — never the real Inngest. The tables are a model of what was CONFIRMED on production
 * (function_runs / function_finishes by run_id, run_started_at) plus two unconfirmed ones; the
 * script's job is to touch only what it can verify:
 *   • the default is a dry run: nothing changes;
 *   • -v apply=1 removes FINISHED runs older than the period (and their finishes); a run without a
 *     finish (still going, or stuck) stays however old, and so do young runs;
 *   • an unconfirmed table is touched only with -v include_unconfirmed=1, and a «time» column that
 *     is not a timestamp is never touched;
 *   • another database name or a period under 7 days is refused.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

const psql = ['psql', '/opt/homebrew/bin/psql', '/usr/bin/psql', '/usr/local/bin/psql']
  .find((bin) => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0)

describe.skipIf(!dbTestsEnabled || !process.env.TEST_DB_ADMIN_URL || !psql)('inngest-history-prune.sql', () => {
  const DB = 'inngest_prune_test'
  const script = resolve(__dirname, '../../../scripts/ops/inngest-history-prune.sql')
  const adminUrl = new URL(process.env.TEST_DB_ADMIN_URL!)
  const dbUrl = new URL(adminUrl.toString())
  dbUrl.pathname = `/${DB}`
  let db: Client

  function run(...vars: string[]) {
    const args = [dbUrl.toString(), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `allow_db=${DB}`, ...vars.flatMap((v) => ['-v', v]), '-f', script]
    const res = spawnSync(psql!, args, { encoding: 'utf8' })
    return { status: res.status, out: `${res.stdout}\n${res.stderr}` }
  }
  const count = async (table: string) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${DB}`)
    await admin.end()
    db = new Client({ connectionString: dbUrl.toString() })
    await db.connect()
  })

  afterAll(async () => {
    await db?.end()
    const admin = new Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
    await admin.end()
  })

  beforeEach(async () => {
    await db.query(`
      DROP TABLE IF EXISTS function_runs, function_finishes, history, traces, functions;
      CREATE TABLE functions (id uuid PRIMARY KEY, slug text);
      CREATE TABLE function_runs (run_id bytea PRIMARY KEY, run_started_at timestamp NOT NULL, function_id uuid);
      CREATE TABLE function_finishes (run_id bytea PRIMARY KEY, status text, output text);
      CREATE TABLE history (id bytea, created_at timestamp NOT NULL, run_id bytea);
      CREATE TABLE traces ("timestamp" bigint, run_id text);
      INSERT INTO functions VALUES ('00000000-0000-0000-0000-000000000001', 'aistart360-point-a-nightly');
      INSERT INTO function_runs VALUES
        ('\\x01', (now() AT TIME ZONE 'UTC') - interval '40 days', '00000000-0000-0000-0000-000000000001'), -- old, finished: goes
        ('\\x02', (now() AT TIME ZONE 'UTC') - interval '40 days', '00000000-0000-0000-0000-000000000001'), -- old, never finished: stays
        ('\\x03', (now() AT TIME ZONE 'UTC') - interval '2 days',  '00000000-0000-0000-0000-000000000001'); -- young, finished: stays
      INSERT INTO function_finishes VALUES ('\\x01', 'Completed', '{}'), ('\\x03', 'Completed', '{}');
      INSERT INTO history VALUES ('\\x10', (now() AT TIME ZONE 'UTC') - interval '40 days', '\\x01'), ('\\x11', now() AT TIME ZONE 'UTC', '\\x03');
      INSERT INTO traces VALUES (1, 'a'), (2, 'b');
    `)
  })

  it('by default a dry run: an inventory, the counts, and nothing changed', async () => {
    const res = run()
    expect(res.status, res.out).toBe(0)
    expect(res.out).toContain('function_runs')
    expect(res.out).toMatch(/завершённых запусков старше срока — 1/)
    expect(res.out).toMatch(/Пробный прогон/)
    expect(await count('function_runs')).toBe(3)
    expect(await count('function_finishes')).toBe(2)
    expect(await count('history')).toBe(2)
  })

  it('-v apply=1: old FINISHED runs and their finishes go; unfinished and young ones stay; unconfirmed tables stay', async () => {
    const res = run('apply=1')
    expect(res.status, res.out).toBe(0)
    const runs = (await db.query(`SELECT encode(run_id, 'hex') AS id FROM function_runs ORDER BY 1`)).rows.map((r) => r.id)
    expect(runs).toEqual(['02', '03'])
    expect((await db.query(`SELECT encode(run_id, 'hex') AS id FROM function_finishes`)).rows.map((r) => r.id)).toEqual(['03'])
    expect(await count('history')).toBe(2)
    expect(res.out).toMatch(/нужен -v include_unconfirmed=1/)
    expect(await count('functions')).toBe(1)
  })

  it('-v include_unconfirmed=1 with apply: an unconfirmed table with a timestamp column is pruned; a numeric «time» never', async () => {
    const res = run('apply=1', 'include_unconfirmed=1')
    expect(res.status, res.out).toBe(0)
    expect(await count('history')).toBe(1)
    expect(await count('traces')).toBe(2)
    expect(res.out).toMatch(/traces: колонка timestamp \(тип bigint\) — не время, пропущено/)
  })

  it('a schema unlike the confirmed one is skipped, not guessed at', async () => {
    await db.query(`ALTER TABLE function_runs RENAME COLUMN run_started_at TO started`)
    const res = run('apply=1')
    expect(res.status, res.out).toBe(0)
    expect(res.out).toMatch(/пропущено: function_runs/)
    expect(await count('function_runs')).toBe(3)
  })

  it('refuses another database without allow_db, and a period under 7 days', async () => {
    const other = spawnSync(psql!, [dbUrl.toString(), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'apply=1', '-f', script], { encoding: 'utf8' })
    expect(other.status).not.toBe(0)
    expect(other.stderr).toMatch(/ожидалась inngest/)
    const short = run('apply=1', 'days=3')
    expect(short.status).not.toBe(0)
    expect(short.out).toMatch(/меньше 7 дней/)
    expect(await count('function_runs')).toBe(3)
  })
})
