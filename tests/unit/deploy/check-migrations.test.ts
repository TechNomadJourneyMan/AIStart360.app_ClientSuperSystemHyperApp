/**
 * scripts/deploy/check-migrations.mjs — the CI check of migration files (R4-A4, R-019): no new number
 * twice (the 15 old repeats by full file name), every migration from 140 has its rollback, no stray
 * files. Pure function on a listing, plus one pass over the real folder and the CLI on a temp folder.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_DUPLICATES,
  checkMigrations,
  listMigrationsDir,
  main,
} from '../../../scripts/deploy/check-migrations.mjs'

const REAL = listMigrationsDir(path.resolve(__dirname, '../../../supabase/migrations'))

function listing(migrations: string[], rollbacks: string[] = [], others: string[] = []) {
  return { migrations, rollbacks, others }
}

describe('the real supabase/migrations', () => {
  it('passes: numbers unique except the listed old repeats, rollbacks from 140 on (141 and 142 included)', () => {
    const result = checkMigrations(REAL)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
    expect(REAL.rollbacks).toContain('141_ai_messages_client_insert_user_only.down.sql')
    expect(REAL.rollbacks).toContain('142_ops_backup_runs.down.sql')
  })

  it('the list of old repeats is exactly the 15 numbers of the audit, each with files that exist', () => {
    expect(Object.keys(LEGACY_DUPLICATES)).toEqual(['035', '036', '069', '070', '071', '072', '073', '083', '084', '086', '087', '088', '089', '090', '091'])
    for (const files of Object.values(LEGACY_DUPLICATES)) {
      expect(files.length).toBeGreaterThanOrEqual(2)
      for (const f of files) expect(REAL.migrations).toContain(f)
    }
  })

  it('CI runs it, before anything else needs dependencies', () => {
    const ci = readFileSync(path.resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8')
    // The static job: the check, then the install (.github/actions/install — cached node_modules or npm ci).
    const job = ci.slice(ci.indexOf('\n  static:'), ci.indexOf('\n  tests:'))
    const step = job.indexOf('run: node scripts/deploy/check-migrations.mjs')
    expect(step).toBeGreaterThan(0)
    expect(job.indexOf('uses: ./.github/actions/install')).toBeGreaterThan(step)
    const install = readFileSync(path.resolve(__dirname, '../../../.github/actions/install/action.yml'), 'utf8')
    expect(install).toContain('run: npm ci')
  })

  it('the check preflight requires is the job that needs every other CI job and fails unless all succeeded', () => {
    const ci = readFileSync(path.resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8')
    const jobs = [...ci.slice(ci.indexOf('\njobs:')).matchAll(/^ {2}([a-z][a-z0-9_-]*):\n/gm)].map((m) => m[1])
    expect(jobs).toEqual(['static', 'tests', 'build', 'checks'])
    const checks = ci.slice(ci.indexOf('\n  checks:'))
    expect(checks).toContain('name: typecheck · lint · tests (with prod-mirror DB)')
    expect(checks).toContain('if: always()')
    expect(checks).toContain('needs: [static, tests, build]')
    expect(checks).toContain(`all(.[]; .result == "success")`)
    // No other job may carry the required prefix: preflight would accept it instead.
    const names = [...ci.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1])
    expect(names.filter((n) => n.startsWith('typecheck · lint · tests'))).toEqual(['typecheck · lint · tests (with prod-mirror DB)'])
  })

  it('without the two new rollbacks the real folder would fail (what the check is for)', () => {
    const without = { ...REAL, rollbacks: REAL.rollbacks.filter((f) => !f.startsWith('141_') && !f.startsWith('142_')) }
    const result = checkMigrations(without)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(2)
    expect(result.problems[0]).toContain('141_ai_messages_client_insert_user_only.sql: нет файла отката')
  })
})

describe('checkMigrations', () => {
  it('a new migration reusing a number is refused, naming both files', () => {
    const r = checkMigrations(listing(['154_ops_job_runs.sql', '154_something_else.sql'], ['154_ops_job_runs.down.sql', '154_something_else.down.sql']))
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual([expect.stringContaining('номер 154 повторяется: 154_ops_job_runs.sql, 154_something_else.sql')])
  })

  it('a new file with an OLD repeated number is refused too (the exception is by file name, not by number)', () => {
    const r = checkMigrations(listing([...LEGACY_DUPLICATES['069'], '069_late_addition.sql']))
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toContain('(069_late_addition.sql)')
  })

  it('the old repeats themselves pass', () => {
    expect(checkMigrations(listing(Object.values(LEGACY_DUPLICATES).flat())).ok).toBe(true)
  })

  it('from 140 a migration needs rollback/<same name>.down.sql; before 140 it does not', () => {
    expect(checkMigrations(listing(['139_old.sql'])).ok).toBe(true)
    const r = checkMigrations(listing(['155_new_table.sql']))
    expect(r.problems).toEqual(['155_new_table.sql: нет файла отката rollback/155_new_table.down.sql (обязателен с 140)'])
    expect(checkMigrations(listing(['155_new_table.sql'], ['155_new_table.down.sql'])).ok).toBe(true)
    // a rollback under another name is not found
    const typo = checkMigrations(listing(['155_new_table.sql'], ['155_new_tables.down.sql']))
    expect(typo.problems).toHaveLength(2)
  })

  it('names not in the NNN_name.sql form are refused', () => {
    const r = checkMigrations(listing(['155-new.sql', '155_New.sql', '1550_x.sql', 'README.md', '155_x.SQL']))
    expect(r.problems).toHaveLength(5)
    for (const p of r.problems) expect(p).toContain('имя не по образцу')
  })

  it('a rollback without its migration, or not *.down.sql, is refused', () => {
    const r = checkMigrations(listing(['140_a.sql'], ['140_a.down.sql', '150_gone.down.sql', 'notes.txt']))
    expect(r.problems).toEqual([
      expect.stringContaining('rollback/150_gone.down.sql: нет миграции 150_gone.sql'),
      expect.stringContaining('rollback/notes.txt'),
    ])
  })

  it('a sub-folder other than rollback/ is refused', () => {
    expect(checkMigrations(listing(['001_a.sql'], [], ['drafts'])).problems).toEqual([expect.stringContaining('drafts/')])
  })
})

describe('CLI', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function folder(files: string[], rollbacks: string[] = []) {
    dir = mkdtempSync(path.join(tmpdir(), 'a360-mig-check-'))
    for (const f of files) writeFileSync(path.join(dir, f), '-- x\n')
    mkdirSync(path.join(dir, 'rollback'))
    for (const f of rollbacks) writeFileSync(path.join(dir, 'rollback', f), '-- x\n')
    return dir
  }

  it('exit 0 and one summary line when all is well', () => {
    const out: string[] = []
    expect(main([folder(['140_a.sql'], ['140_a.down.sql'])], { log: (l: string) => out.push(l), error: (l: string) => out.push(l) })).toBe(0)
    expect(out.join('\n')).toContain('1 файлов')
  })

  it('exit 1 and one line per problem otherwise; dot-files are ignored', () => {
    const err: string[] = []
    const code = main([folder(['140_a.sql', '140_b.sql', '.DS_Store'], ['140_a.down.sql', '140_b.down.sql'])], { log: () => {}, error: (l: string) => err.push(l) })
    expect(code).toBe(1)
    expect(err).toHaveLength(2)
    expect(err[1]).toContain('номер 140 повторяется')
  })
})
