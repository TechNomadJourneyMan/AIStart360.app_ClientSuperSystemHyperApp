import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'scripts/publish-honor-management-period.ts'),
  'utf8',
)

describe('HONOR management publication command', () => {
  it('is bound to the audited source and exact control totals', () => {
    expect(source).toContain('5bd0ebc23f04eca040663fa907adf2cea78c45039544366eefe0759de4ea0e16')
    expect(source).toContain("rows.length !== 19")
    expect(source).toContain("230_670_168, '2025 revenue'")
    expect(source).toContain("202_125_074, '2026 YTD revenue'")
    expect(source).toContain("-11_060_353.09, 'May-July EBITDA'")
    expect(source).toContain("-0.75, 'gross-profit reconciliation'")
    expect(source).toContain("47_666_895, 'May-July P&L revenue'")
    expect(source).toContain("['2025-09', '2025-10']")
    expect(source).toContain("['2026-05', '2026-06', '2026-07']")
    expect(source).toContain('9c46f740df0334e0b4f8e0296f8335dc9f782588bc476e17791c84ddee03be13')
    expect(source).toContain('EXPECTED_SOURCE_SIZE_BYTES = 22_717')
  })

  it('defaults to dry-run and requires an exact apply confirmation', () => {
    expect(source).toContain("const apply = process.argv.includes('--apply')")
    expect(source).toContain("outcome: 'dry_run'")
    expect(source).toContain('HONOR_MANAGEMENT_CONFIRM !== expectedConfirmation')
    expect(source).toContain('targetBinding.bindingHash.slice(0, 12)')
    expect(source.indexOf("if (!apply)")).toBeLessThan(
      source.indexOf("await client.query('BEGIN')"),
    )
  })

  it('publishes through the service-only RPC and verifies before commit', () => {
    expect(source).toContain("await client.query('SET LOCAL ROLE service_role')")
    expect(source).toContain('public.publish_store_financial_import(')
    expect(source).toMatch(
      /verifyControls\(verifyResult\.rows[\s\S]*?await client\.query\('COMMIT'\)/,
    )
    expect(source).toContain("await client.query('ROLLBACK')")
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('requires committed parser/publisher source and the expected production database', () => {
    for (const file of [
      'scripts/publish-honor-management-period.ts',
      'lib/store/import/parser.ts',
      'lib/store/import/publication.ts',
      'lib/store/import/types.ts',
      'supabase/migrations/090_store_financial_analytics.sql',
    ]) expect(source).toContain(`'${file}'`)
    expect(source).toContain("execFileSync('git', ['show', `${sourceCommit}:${file}`]")
    expect(source).toContain("EXPECTED_SUPABASE_PROJECT_REF = 'tpxwrwxpdcwmiynjjquy'")
    expect(source).toContain('MYHONOR_ANALYTICS_USER_ID')
    expect(source).toContain('MYHONOR_ANALYTICS_COMPANY_ID')
    expect(source).toContain('company.id::TEXT = $1')
    expect(source).toContain('company.user_id = $2::UUID')
    expect(source).toContain('owner.company_name !== STORE_DISPLAY_NAME')
    expect(source).toContain('ssl: verifiedSupabaseSsl(root)')
    expect(source).toContain('const client = new Client(databaseConfig)')
    expect(source).not.toContain('new Client({ connectionString')
    expect(source).toContain("key !== 'pgbouncer' || value !== 'true'")
    expect(source).toContain('EXPECTED_SUPABASE_CA_FINGERPRINT')
    expect(source).toContain('db.${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co')
    expect(source).not.toContain('rejectUnauthorized: false')
    expect(source).toContain('Published rows are not bound to the audited HONOR import')
    expect(source).toContain('completeness: row.completeness')
  })

  it('locks the exact release ledger and approved profile inside the apply transaction', () => {
    expect(source).toContain("FINANCIAL_RELEASE_ID = 'store-financial-analytics-v1'")
    expect(source).toContain('public.aistart360_store_financial_releases')
    expect(source).toContain('migration_090_sha256 !== releaseBinding.migrationSha256')
    expect(source).toContain("pg_advisory_xact_lock(hashtextextended('aistart360:store-financial-release', 0))")
    expect(source).toContain('FOR SHARE OF company, profile')
    expect(source).toContain("lockedOwner?.status !== 'approved'")
    expect(source.indexOf('FOR SHARE OF company, profile')).toBeLessThan(
      source.indexOf("await client.query('SET LOCAL ROLE service_role')"),
    )
  })
})
