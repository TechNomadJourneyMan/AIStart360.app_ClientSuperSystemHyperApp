import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'scripts/apply-store-control-release.js'),
  'utf8',
)

describe('Store schema release runner', () => {
  it('binds both committed migrations to one transaction and immutable hashes', () => {
    expect(source).toContain("'supabase/migrations/084_store_control_center.sql'")
    expect(source).toContain("'supabase/migrations/085_store_import_publication.sql'")
    expect(source).toContain("gitRaw(['show', `${commitSha}:${relativePath}`], root)")
    expect(source).toContain("await client.query('BEGIN')")
    expect(source).toMatch(
      /await client\.query\(release\.sources\[0\]\.sql\)[\s\S]*?await client\.query\(release\.sources\[1\]\.sql\)[\s\S]*?await client\.query\('COMMIT'\)/,
    )
    expect(source).toContain("await client.query('ROLLBACK')")
    expect(source).toContain('migration_084_sha256')
    expect(source).toContain('migration_085_sha256')
    expect(source).toContain('aistart360_schema_releases')
  })

  it('never reapplies phase 1 over a tracked or partial phase 2 schema', () => {
    expect(source).toContain("outcome: 'already_applied'")
    expect(source).toContain(
      'Untracked or partial Store schema exists; refusing automatic repair',
    )
    expect(source.indexOf('if (ledger)')).toBeLessThan(
      source.indexOf('await client.query(release.sources[0].sql)'),
    )
  })

  it('checks RLS, direct DML revocation, RPC ownership and schema hardening before commit', () => {
    expect(source).toContain('table.rls_enabled !== true')
    expect(source).toContain("has_table_privilege('service_role', $1, 'INSERT')")
    expect(source).toContain("has_table_privilege('service_role', $1, 'UPDATE')")
    expect(source).toContain("has_table_privilege('service_role', $1, 'DELETE')")
    expect(source).toContain("has_function_privilege('service_role', $1, 'EXECUTE')")
    expect(source).toContain("has_function_privilege('authenticated', $1, 'EXECUTE')")
    expect(source).toContain("has_schema_privilege('authenticated', 'public', 'CREATE')")
    expect(source).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
