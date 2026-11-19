/**
 * scripts/apply-migration.js (R-058): the one-shot applier says WHERE it applies (host/db, never the
 * password), applies nothing without --yes, and never rewrites a journal checksum silently — a file
 * already in public.schema_migrations is refused unless --force-checksum. The database is a fake
 * client that records every query.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const am = require('../../../scripts/apply-migration.js') as {
  parseArgs: (argv: string[]) => { file: string; yes: boolean; forceChecksum: boolean }
  describeTarget: (cs: string) => string
  run: (o: Record<string, unknown>) => Promise<number>
}

const SQL = 'CREATE TABLE IF NOT EXISTS public.t (id int);\n'
const SUM = createHash('sha256').update(SQL).digest('hex')
const CS = 'postgres://admin:s3cr3t-Pa55@db.example.test:6543/portal'

interface Db { journal?: boolean; recorded?: string | null; failSql?: boolean }

function fakeDb(db: Db = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = []
  const client = {
    connect: async () => {},
    end: async () => {},
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values })
      if (text.includes('to_regclass')) return { rows: [{ t: db.journal === false ? null : 'schema_migrations' }] }
      if (text.startsWith('SELECT checksum')) return { rows: db.recorded ? [{ checksum: db.recorded }] : [] }
      if (text.includes('INSERT INTO public.schema_migrations')) return { rows: [], rowCount: 1 }
      if (db.failSql) throw Object.assign(new Error('syntax error at or near "CREAT"'), { position: '1' })
      return { rows: [] }
    },
  }
  return { client, queries }
}

async function apply(argv: string[], db: Db = {}, env: Record<string, string> = { DIRECT_URL: CS }) {
  const { client, queries } = fakeDb(db)
  const out: string[] = []
  const code = await am.run({
    argv,
    env,
    makeClient: () => client,
    readFile: () => SQL,
    exists: () => true,
    log: (l: string) => out.push(l),
    error: (l: string) => out.push(l),
  })
  const migrationRan = queries.some((q) => q.text === SQL)
  const ledgerWrites = queries.filter((q) => q.text.includes('INSERT INTO public.schema_migrations'))
  return { code, out: out.join('\n'), queries, migrationRan, ledgerWrites }
}

describe('apply-migration.js — the target', () => {
  it('host:port/db and the user, never the password', () => {
    const t = am.describeTarget(CS)
    expect(t).toContain('db.example.test:6543/portal')
    expect(t).toContain('admin')
    expect(t).not.toContain('s3cr3t')
    expect(am.describeTarget('postgres://u@h.example.test/d')).toContain('h.example.test:5432/d')
    expect(am.describeTarget('not a url :pw@')).not.toContain('pw')
  })

  it('the printed output never carries the password', async () => {
    const r = await apply(['supabase/migrations/155_a.sql', '--yes'])
    expect(r.out).toContain('db.example.test:6543/portal')
    expect(r.out).not.toContain('s3cr3t')
  })
})

describe('apply-migration.js — --yes', () => {
  it('without --yes: says what it would do, applies nothing, writes nothing, exit 1', async () => {
    const r = await apply(['supabase/migrations/155_a.sql'])
    expect(r.code).toBe(1)
    expect(r.migrationRan).toBe(false)
    expect(r.ledgerWrites).toHaveLength(0)
    expect(r.out).toContain('--yes')
  })

  it('with --yes: applies, then records file and checksum without overwriting anything', async () => {
    const r = await apply(['supabase/migrations/155_a.sql', '--yes'])
    expect(r.code).toBe(0)
    expect(r.migrationRan).toBe(true)
    expect(r.ledgerWrites).toHaveLength(1)
    expect(r.ledgerWrites[0].values?.slice(0, 2)).toEqual(['155_a.sql', SUM])
    expect(r.ledgerWrites[0].text).toContain('ON CONFLICT (file) DO NOTHING')
    expect(r.ledgerWrites[0].text).not.toContain('DO UPDATE')
  })

  it('unknown flags and no file are usage errors (exit 2), nothing is connected', async () => {
    expect((await apply([])).code).toBe(2)
    expect((await apply(['x.sql', '--force'])).code).toBe(2)
    expect((await apply(['x.sql', '--force'])).queries).toHaveLength(0)
  })
})

describe('apply-migration.js — the journal checksum is never overwritten silently', () => {
  it('already recorded with ANOTHER checksum: refused before applying, with both sums; --yes is not enough', async () => {
    const r = await apply(['supabase/migrations/155_a.sql', '--yes'], { recorded: 'f'.repeat(64) })
    expect(r.code).toBe(1)
    expect(r.migrationRan).toBe(false)
    expect(r.ledgerWrites).toHaveLength(0)
    expect(r.out).toContain('ffffffffffff')
    expect(r.out).toContain(SUM.slice(0, 12))
    expect(r.out).toContain('--force-checksum')
  })

  it('already recorded with the same checksum: refused too (it is applied), nothing re-run', async () => {
    const r = await apply(['supabase/migrations/155_a.sql', '--yes'], { recorded: SUM })
    expect(r.code).toBe(1)
    expect(r.migrationRan).toBe(false)
    expect(r.out).toContain('уже применена')
  })

  it('--force-checksum --yes: applies and rewrites the row, saying old → new', async () => {
    const r = await apply(['supabase/migrations/155_a.sql', '--yes', '--force-checksum'], { recorded: 'f'.repeat(64) })
    expect(r.code).toBe(0)
    expect(r.migrationRan).toBe(true)
    expect(r.ledgerWrites[0].text).toContain('DO UPDATE')
    expect(r.out).toMatch(/ffffffffffff.*→.*/)
  })

  it('a database without the journal (before 083): applied, nothing recorded, said so', async () => {
    const r = await apply(['supabase/migrations/155_a.sql', '--yes'], { journal: false })
    expect(r.code).toBe(0)
    expect(r.migrationRan).toBe(true)
    expect(r.ledgerWrites).toHaveLength(0)
    expect(r.out).toContain('schema_migrations')
  })

  it('a failing migration is not recorded, exit 1', async () => {
    const r = await apply(['supabase/migrations/155_a.sql', '--yes'], { failSql: true })
    expect(r.code).toBe(1)
    expect(r.ledgerWrites).toHaveLength(0)
  })
})
