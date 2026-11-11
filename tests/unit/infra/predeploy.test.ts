/**
 * scripts/railway/predeploy.mjs — Railway runs it before each deploy. With the Postgres Workflow
 * world it creates the queue tables (idempotent); otherwise it must step aside. The script is run
 * as a child process with a bare environment: nothing here can reach a database.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(__dirname, '../../../scripts/railway/predeploy.mjs')

function run(env: Record<string, string>) {
  // a bare environment on purpose: a developer's DATABASE_URL must not leak into the child
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

describe('predeploy.mjs', () => {
  it('skips, with exit 0, when no Workflow world is configured', () => {
    const { status, out } = run({})
    expect(status).toBe(0)
    expect(out).toMatch(/пропуск/i)
  })

  it('skips, with exit 0, for a world that needs no tables of ours', () => {
    const { status, out } = run({ WORKFLOW_TARGET_WORLD: '@workflow/world-vercel' })
    expect(status).toBe(0)
    expect(out).toMatch(/пропуск/i)
  })

  it('fails, without running anything, when the Postgres world has no WORKFLOW_POSTGRES_URL', () => {
    // bootstrap would otherwise fall back to DATABASE_URL or to a localhost default
    const { status, out } = run({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres', DATABASE_URL: 'postgres://prod.invalid/db' })
    expect(status).not.toBe(0)
    expect(out).toContain('WORKFLOW_POSTGRES_URL')
    expect(out).not.toContain('prod.invalid')
  })

  // The agents service is built from the same repository with the same railway.json, so Railway runs
  // this step for it too, usually at the same moment as for the portal (one push deploys both). The
  // queue tables are the portal's: the agents service must not bootstrap them a second time.
  it('skips, with exit 0, on the agents service (PORTAL_ROLE=agents), even with the Postgres world configured', () => {
    const { status, out } = run({
      PORTAL_ROLE: 'agents',
      WORKFLOW_TARGET_WORLD: '@workflow/world-postgres',
      // unreachable on purpose: a bootstrap that did start would fail, not skip
      WORKFLOW_POSTGRES_URL: 'postgres://user:pw@unreachable.invalid:5432/db',
    })
    expect(status).toBe(0)
    expect(out).toMatch(/пропуск/i)
    expect(out).toContain('PORTAL_ROLE=agents')
    expect(out).not.toContain('unreachable.invalid')
    expect(out).not.toContain('bootstrap')
  })

  it('reads PORTAL_ROLE like the server does: any case, surrounding spaces', () => {
    const { status, out } = run({ PORTAL_ROLE: ' Agents ', WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' })
    expect(status).toBe(0)
    expect(out).toMatch(/пропуск/i)
  })

  it('the agents role skips before the missing-URL check: its deploy does not need WORKFLOW_POSTGRES_URL here', () => {
    const { status } = run({ PORTAL_ROLE: 'agents', WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' })
    expect(status).toBe(0)
  })

  it('the web role and an unknown role prepare the queue as before', () => {
    for (const role of ['web', 'all', 'worker', '']) {
      // without the URL the step must still stop the deploy: that is the portal's own guard
      const { status, out } = run({ PORTAL_ROLE: role, WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' })
      expect(status, `role=${role}`).not.toBe(0)
      expect(out).toContain('WORKFLOW_POSTGRES_URL')
    }
  })
})

/**
 * After the queue bootstrap the pre-deploy step also creates `cron_runs` (the scheduler's claim
 * table) in the same database, with the statement lib/cron/claim.ts uses. A fake Pool stands in
 * for Postgres.
 */
describe('ensureCronRunsTable (predeploy step after the bootstrap)', () => {
  const URL = 'postgres://wfuser:hunter2-secret@workflow-db.invalid:5432/railway'

  function fakePoolClass(query: (text: string) => Promise<unknown>) {
    const made: { options: Record<string, unknown>; queries: string[]; ended: boolean; listeners: string[] }[] = []
    class FakePool {
      state: (typeof made)[number]
      constructor(options: Record<string, unknown>) {
        this.state = { options, queries: [], ended: false, listeners: [] }
        made.push(this.state)
      }
      on(event: string) { this.state.listeners.push(event); return this }
      async query(text: string) { this.state.queries.push(text); return query(text) }
      async end() { this.state.ended = true }
    }
    return { FakePool, made }
  }

  it('runs the shared CREATE TABLE once, closes the pool and answers true', async () => {
    const { ensureCronRunsTable } = await import('@/scripts/railway/ensure-cron-runs.mjs')
    const { CREATE_CRON_RUNS_TABLE } = await import('@/lib/cron/cron-runs-table.mjs')
    const { FakePool, made } = fakePoolClass(async () => ({ rows: [] }))
    const lines: string[] = []

    const ok = await ensureCronRunsTable(URL, { Pool: FakePool, log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) })

    expect(ok).toBe(true)
    expect(made).toHaveLength(1)
    expect(made[0].options).toMatchObject({ connectionString: URL, connectionTimeoutMillis: 10_000 })
    expect(made[0].queries).toEqual([CREATE_CRON_RUNS_TABLE])
    expect(made[0].ended).toBe(true)
    expect(made[0].listeners).toContain('error')
    expect(lines.join('\n')).toContain('cron_runs')
    expect(lines.join('\n')).not.toContain('hunter2-secret')
  })

  it('a failure answers false, closes the pool and prints the error code, never the URL or the password', async () => {
    const { ensureCronRunsTable } = await import('@/scripts/railway/ensure-cron-runs.mjs')
    const { FakePool, made } = fakePoolClass(async () => {
      throw Object.assign(new Error(`password authentication failed for wfuser at ${URL} (hunter2-secret)`), { code: '28P01' })
    })
    const lines: string[] = []

    const ok = await ensureCronRunsTable(URL, { Pool: FakePool, log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) })

    expect(ok).toBe(false)
    expect(made[0].ended).toBe(true)
    const text = lines.join('\n')
    expect(text).toContain('28P01')
    expect(text).not.toContain('hunter2-secret')
    expect(text).not.toContain('wfuser')
    expect(text).not.toContain('workflow-db.invalid')
  })

  it('an error without a code is reported by its name', async () => {
    const { ensureCronRunsTable } = await import('@/scripts/railway/ensure-cron-runs.mjs')
    const { FakePool } = fakePoolClass(async () => { throw new TypeError(`Invalid URL ${URL}`) })
    const lines: string[] = []

    expect(await ensureCronRunsTable(URL, { Pool: FakePool, log: () => {}, error: (l: string) => lines.push(l) })).toBe(false)
    expect(lines.join('\n')).toContain('TypeError')
    expect(lines.join('\n')).not.toContain('hunter2-secret')
  })

  it('predeploy.mjs runs it only after a successful bootstrap', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(SCRIPT, 'utf8')
    expect(source).toMatch(/import \{ ensureCronRunsTable \} from '\.\/ensure-cron-runs\.mjs'/)
    const bootstrapAt = source.indexOf('spawnSync(process.execPath, [bootstrap]')
    const ensureAt = source.indexOf('await ensureCronRunsTable(')
    expect(bootstrapAt).toBeGreaterThan(-1)
    expect(ensureAt).toBeGreaterThan(bootstrapAt)
  })
})
