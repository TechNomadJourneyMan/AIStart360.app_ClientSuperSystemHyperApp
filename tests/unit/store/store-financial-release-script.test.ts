import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const releaseRunner = require('../../../scripts/apply-store-financial-release.js') as {
  assertExpectedDatabaseConnection: (connectionString: string, publicUrl: string) => URL
  expectedDatabaseClientConfig: (connectionString: string, publicUrl: string, root: string) => {
    host: string
    port: number
    user: string
    password: string
    database: string
    ssl: { rejectUnauthorized: true; ca: string }
  }
  verifiedSupabaseSsl: (root: string) => { rejectUnauthorized: true; ca: string }
}

const source = readFileSync(
  join(process.cwd(), 'scripts/apply-store-financial-release.js'),
  'utf8',
)

describe('Store financial schema release runner', () => {
  it('binds committed migration 090 and its hash to one transaction', () => {
    expect(source).toContain("'supabase/migrations/090_store_financial_analytics.sql'")
    expect(source).toContain("'scripts/apply-store-financial-release.js'")
    expect(source).toContain("gitRaw(['show', `${sourceCommit}:${file}`], root)")
    expect(source).toContain("await client.query('BEGIN')")
    expect(source).toMatch(
      /await client\.query\(release\.sql\)[\s\S]*?migration_090_sha256[\s\S]*?await client\.query\('COMMIT'\)/,
    )
    expect(source).toContain("await client.query('ROLLBACK')")
    expect(source).toContain('aistart360_store_financial_releases')
  })

  it('refuses an untracked partial schema and accepts only the exact ledger', () => {
    expect(source).toContain("outcome: 'already_applied'")
    expect(source).toContain(
      'Untracked or partial Store financial schema exists; refusing automatic repair',
    )
    expect(source.indexOf('if (ledger)')).toBeLessThan(
      source.indexOf('await client.query(release.sql)'),
    )
  })

  it('checks RLS, triggers, direct DML revocation and service-only RPC before commit', () => {
    expect(source).toContain('table.rls_enabled !== true')
    expect(source).toContain("has_table_privilege('service_role', $1, 'INSERT')")
    expect(source).toContain("has_table_privilege('service_role', $1, 'UPDATE')")
    expect(source).toContain("has_table_privilege('service_role', $1, 'DELETE')")
    expect(source).toContain("has_function_privilege('service_role', $1, 'EXECUTE')")
    expect(source).toContain("has_function_privilege('authenticated', $1, 'EXECUTE')")
    expect(source).toContain("has_function_privilege('anon', $1, 'EXECUTE')")
    expect(source).toContain("has_schema_privilege('authenticated', 'public', 'CREATE')")
    expect(source).toContain('store_guard_financial_company_identity_before_update')
    expect(source).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('binds the mutation to the expected Supabase project with verified TLS', () => {
    expect(source).toContain("EXPECTED_SUPABASE_PROJECT_REF = 'tpxwrwxpdcwmiynjjquy'")
    expect(source).toContain('assertExpectedDatabaseConnection(')
    expect(source).toContain("databaseUrl.pathname !== '/postgres'")
    expect(source).toContain('ssl: verifiedSupabaseSsl(root)')
    expect(source).toContain('const client = new Client(databaseConfig)')
    expect(source).not.toContain('new Client({ connectionString')
    expect(source).toContain("'config/certs/supabase-root-2021-ca.pem'")
    expect(source).toContain('EXPECTED_SUPABASE_CA_FINGERPRINT')
    expect(source).not.toContain('rejectUnauthorized: false')

    expect(() => releaseRunner.assertExpectedDatabaseConnection(
      'postgresql://postgres.tpxwrwxpdcwmiynjjquy:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
      'https://tpxwrwxpdcwmiynjjquy.supabase.co',
    )).not.toThrow()
    expect(() => releaseRunner.assertExpectedDatabaseConnection(
      'postgresql://postgres:secret@db.tpxwrwxpdcwmiynjjquy.supabase.co:5432/postgres',
      'https://tpxwrwxpdcwmiynjjquy.supabase.co',
    )).not.toThrow()
    expect(() => releaseRunner.assertExpectedDatabaseConnection(
      'postgresql://postgres.other:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
      'https://tpxwrwxpdcwmiynjjquy.supabase.co',
    )).toThrow(/expected AIStart360 Supabase production project/)
    expect(() => releaseRunner.assertExpectedDatabaseConnection(
      'postgresql://evil.tpxwrwxpdcwmiynjjquy.extra:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
      'https://tpxwrwxpdcwmiynjjquy.supabase.co',
    )).toThrow(/expected AIStart360 Supabase production project/)
    expect(() => releaseRunner.assertExpectedDatabaseConnection(
      'postgresql://wrong:secret@db.tpxwrwxpdcwmiynjjquy.supabase.co:5432/postgres',
      'https://tpxwrwxpdcwmiynjjquy.supabase.co',
    )).toThrow(/expected AIStart360 Supabase production project/)
    expect(() => releaseRunner.assertExpectedDatabaseConnection(
      'postgresql://postgres.tpxwrwxpdcwmiynjjquy:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres#override',
      'https://tpxwrwxpdcwmiynjjquy.supabase.co',
    )).toThrow(/expected AIStart360 Supabase production project/)
    for (const unsafe of [
      '?host=attacker.example&user=wrong',
      '?sslmode=no-verify',
      '?sslmode=disable',
      '?sslrootcert=/tmp/attacker.pem',
    ]) {
      expect(() => releaseRunner.assertExpectedDatabaseConnection(
        `postgresql://postgres.tpxwrwxpdcwmiynjjquy:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres${unsafe}`,
        'https://tpxwrwxpdcwmiynjjquy.supabase.co',
      )).toThrow(/expected AIStart360 Supabase production project/)
    }
    expect(releaseRunner.expectedDatabaseClientConfig(
      'postgresql://postgres.tpxwrwxpdcwmiynjjquy:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
      'https://tpxwrwxpdcwmiynjjquy.supabase.co',
      process.cwd(),
    )).toMatchObject({
      host: 'aws-1-eu-west-1.pooler.supabase.com',
      port: 6543,
      user: 'postgres.tpxwrwxpdcwmiynjjquy',
      database: 'postgres',
      ssl: { rejectUnauthorized: true },
    })
    expect(releaseRunner.verifiedSupabaseSsl(process.cwd())).toMatchObject({
      rejectUnauthorized: true,
      ca: expect.stringContaining('BEGIN CERTIFICATE'),
    })
  })
})
