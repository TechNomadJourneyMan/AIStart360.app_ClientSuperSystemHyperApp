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
})
