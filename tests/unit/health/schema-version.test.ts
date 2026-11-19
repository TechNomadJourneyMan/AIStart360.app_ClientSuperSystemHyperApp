/**
 * N5-1a: the build knows the newest migration it ships without reading the repository at runtime
 * (Railway runs `next start` from a build whose layout is not ours to rely on). The constant is
 * checked in; this test (and scripts/deploy/check-migrations.mjs in CI) pins it to the folder.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NEWEST_MIGRATION } from '@/lib/health/schema-version'
import { checkNewestConstant, newestMigration } from '../../../scripts/deploy/check-migrations.mjs'

const ROOT = path.resolve(__dirname, '../../..')
const DIR = path.join(ROOT, 'supabase/migrations')

describe('NEWEST_MIGRATION', () => {
  it('is the newest NNN_*.sql in supabase/migrations (add a migration → update lib/health/schema-version.ts)', () => {
    const files = readdirSync(DIR).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort()
    expect(NEWEST_MIGRATION).toBe(files[files.length - 1])
  })

  it('newestMigration picks the highest number, ignoring rollbacks and odd names', () => {
    expect(newestMigration(['001_a.sql', '157_b.sql', '099_c.sql', 'README.md', '158_x.down.sql'])).toBe('157_b.sql')
    expect(newestMigration([])).toBeNull()
  })

  it('check-migrations reads the constant from the source and refuses a stale one', () => {
    const src = readFileSync(path.join(ROOT, 'lib/health/schema-version.ts'), 'utf8')
    expect(checkNewestConstant(NEWEST_MIGRATION, src)).toEqual([])
    const stale = src.replace(NEWEST_MIGRATION, '154_ops_job_runs.sql')
    expect(checkNewestConstant(NEWEST_MIGRATION, stale)).toEqual([
      expect.stringContaining(`NEWEST_MIGRATION = '154_ops_job_runs.sql'`),
    ])
    expect(checkNewestConstant(NEWEST_MIGRATION, '// nothing here')).toEqual([expect.stringContaining('NEWEST_MIGRATION не найден')])
  })
})
