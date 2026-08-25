// Publishes the audited HONOR management workbook into the owner-scoped
// financial fact layer. Dry-run is the default; raw workbook bytes never enter
// Git, browser storage or a database table.
//
// Dry run:
//   npm run publish:honor-financial -- --file /private/tmp/honor-dynamics-2025-2026.xlsx
// Apply:
//   MYHONOR_ANALYTICS_USER_ID=<immutable-user-uuid> \
//   MYHONOR_ANALYTICS_COMPANY_ID=<immutable-company-id> \
//   HONOR_MANAGEMENT_CONFIRM=PUBLISH_HONOR_FINANCIAL:5bd0ebc23f04:<target-hash-12> \
//     npm run publish:honor-financial -- --apply --file /private/tmp/honor-dynamics-2025-2026.xlsx

import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { Client } from 'pg'
import { parseStoreImport } from '@/lib/store/import/parser'
import {
  buildStorePublishManifestSha256,
  buildStorePublishPayload,
  STORE_IMPORT_SCHEMA_VERSION,
} from '@/lib/store/import/publication'

const EXPECTED_SHA256 = '5bd0ebc23f04eca040663fa907adf2cea78c45039544366eefe0759de4ea0e16'
const EXPECTED_MANIFEST_SHA256 = '9c46f740df0334e0b4f8e0296f8335dc9f782588bc476e17791c84ddee03be13'
const EXPECTED_SOURCE_SIZE_BYTES = 22_717
const EXPECTED_SUPABASE_PROJECT_REF = 'tpxwrwxpdcwmiynjjquy'
const EXPECTED_SUPABASE_URL = `https://${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co`
const SUPABASE_CA_FILE = 'config/certs/supabase-root-2021-ca.pem'
const EXPECTED_SUPABASE_CA_FINGERPRINT = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA'
const STORE_DISPLAY_NAME = 'Интернет-магазин HONOR / MyHonor'
const MAX_FILE_BYTES = 4 * 1024 * 1024
const FINANCIAL_RELEASE_ID = 'store-financial-analytics-v1'
const FINANCIAL_MIGRATION = 'supabase/migrations/090_store_financial_analytics.sql'
const PUBLICATION_SOURCES = [
  'scripts/publish-honor-management-period.ts',
  'lib/store/import/parser.ts',
  'lib/store/import/publication.ts',
  'lib/store/import/types.ts',
  FINANCIAL_MIGRATION,
  SUPABASE_CA_FILE,
]

function loadEnv(file: string): void {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]
      value = value.slice(1)
      if (value.endsWith(quote)) value = value.slice(0, -1)
    }
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value.replace(/\\n$/g, '')
    }
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : null
  return value && !value.startsWith('--') ? value : null
}

function sum(rows: Array<Record<string, unknown>>, field: string): number {
  return Math.round(rows.reduce((total, row) => total + Number(row[field] ?? 0), 0) * 100) / 100
}

function exact(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`Control total mismatch: ${label}`)
  }
}

function requiredTargetBinding(): { userId: string; companyId: string; bindingHash: string } {
  const userId = process.env.MYHONOR_ANALYTICS_USER_ID?.trim() ?? ''
  const companyId = process.env.MYHONOR_ANALYTICS_COMPANY_ID?.trim() ?? ''
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  if (!uuid.test(userId)) {
    throw new Error('MYHONOR_ANALYTICS_USER_ID must be the immutable HONOR account UUID')
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,199}$/iu.test(companyId)) {
    throw new Error('MYHONOR_ANALYTICS_COMPANY_ID must be the immutable HONOR company id')
  }
  return {
    userId: userId.toLowerCase(),
    companyId,
    bindingHash: createHash('sha256').update(`${userId.toLowerCase()}:${companyId}`, 'utf8').digest('hex'),
  }
}

function assertExpectedDatabaseConnection(connectionString: string, publicSupabaseUrl: string | undefined): URL {
  let databaseUrl: URL
  try {
    databaseUrl = new URL(connectionString)
  } catch {
    throw new Error('Database connection URL is invalid')
  }
  const username = decodeURIComponent(databaseUrl.username).toLowerCase()
  const hostname = databaseUrl.hostname.toLowerCase()
  const directHost = hostname === `db.${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co`
    && username === 'postgres'
  const approvedPooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(hostname)
    && username === `postgres.${EXPECTED_SUPABASE_PROJECT_REF}`
  const port = databaseUrl.port ? Number(databaseUrl.port) : 5432
  const allowedPort = directHost ? port === 5432 : [5432, 6543].includes(port)
  const unsafeParameter = [...databaseUrl.searchParams.entries()].find(([key, value]) => (
    key !== 'pgbouncer' || value !== 'true'
  ))
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
    || (!directHost && !approvedPooler)
    || !allowedPort
    || databaseUrl.pathname !== '/postgres'
    || unsafeParameter
    || databaseUrl.hash
    || !databaseUrl.password
  ) {
    throw new Error('Database URL is not bound to the expected AIStart360 Supabase production project')
  }
  if ((publicSupabaseUrl ?? '').replace(/\/$/, '') !== EXPECTED_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL does not match the expected AIStart360 production project')
  }
  return databaseUrl
}

function verifiedSupabaseSsl(root: string): { rejectUnauthorized: true; ca: string } {
  const ca = readFileSync(join(root, SUPABASE_CA_FILE), 'utf8')
  const certificate = new X509Certificate(ca)
  if (certificate.fingerprint256 !== EXPECTED_SUPABASE_CA_FINGERPRINT) {
    throw new Error('Pinned Supabase CA fingerprint does not match the audited certificate')
  }
  return { rejectUnauthorized: true, ca }
}

function expectedDatabaseClientConfig(
  connectionString: string,
  publicSupabaseUrl: string | undefined,
  root: string,
) {
  const databaseUrl = assertExpectedDatabaseConnection(connectionString, publicSupabaseUrl)
  return {
    host: databaseUrl.hostname,
    port: databaseUrl.port ? Number(databaseUrl.port) : 5432,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: 'postgres',
    ssl: verifiedSupabaseSsl(root),
  }
}

function assertCommittedPublicationSource(root: string): {
  sourceCommit: string
  migrationSha256: string
} {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Unable to resolve publication commit')
  for (const file of PUBLICATION_SOURCES) {
    execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd: root, stdio: 'pipe' })
    const working = readFileSync(join(root, file), 'utf8')
    const committed = execFileSync('git', ['show', `${sourceCommit}:${file}`], {
      cwd: root,
      encoding: 'utf8',
    })
    if (working !== committed) {
      throw new Error(`${file} is not identical to committed publication source`)
    }
  }
  return {
    sourceCommit,
    migrationSha256: createHash('sha256')
      .update(readFileSync(join(root, FINANCIAL_MIGRATION), 'utf8'))
      .digest('hex'),
  }
}

function verifyControls(rows: Array<Record<string, unknown>>): void {
  if (rows.length !== 19) throw new Error('Expected exactly 19 normalized management months')
  const expectedMonths = [
    ...Array.from({ length: 12 }, (_, index) => `2025-${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 7 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`),
  ]
  const actualMonths = rows.map((row) => String(row.periodStart).slice(0, 7)).sort()
  if (JSON.stringify(actualMonths) !== JSON.stringify(expectedMonths)) {
    throw new Error('Expected the exact contiguous January 2025 through July 2026 scope')
  }
  const rows2025 = rows.filter((row) => String(row.periodStart).startsWith('2025-'))
  const rows2026 = rows.filter((row) => String(row.periodStart).startsWith('2026-'))
  const pnl = rows.filter((row) => row.reportedGrossProfit !== null)
  const partialMonths = rows
    .filter((row) => row.completeness === 'partial')
    .map((row) => String(row.periodStart).slice(0, 7))
    .sort()
  const pnlMonths = pnl.map((row) => String(row.periodStart).slice(0, 7)).sort()
  if (JSON.stringify(partialMonths) !== JSON.stringify(['2025-09', '2025-10'])) {
    throw new Error('Expected only September and October 2025 to be partial')
  }
  if (JSON.stringify(pnlMonths) !== JSON.stringify(['2026-05', '2026-06', '2026-07'])) {
    throw new Error('Expected the exact May through July 2026 P&L scope')
  }
  exact(sum(rows2025, 'revenue'), 230_670_168, '2025 revenue')
  exact(sum(rows2025, 'costOfGoods'), 121_403_812, '2025 cost')
  exact(sum(rows2025, 'grossProfit'), 109_266_356, '2025 gross profit')
  exact(sum(rows2026, 'revenue'), 202_125_074, '2026 YTD revenue')
  exact(sum(rows2026, 'costOfGoods'), 119_502_757, '2026 YTD cost')
  exact(sum(rows2026, 'grossProfit'), 82_622_317, '2026 YTD gross profit')
  exact(sum(pnl, 'reportedGrossProfit'), 22_395_620.25, 'May-July reported gross profit')
  exact(sum(pnl, 'revenue'), 47_666_895, 'May-July P&L revenue')
  exact(sum(pnl, 'periodExpenses'), 33_455_973.34, 'May-July expenses')
  exact(sum(pnl, 'bonusExpense'), 4_177_705.89, 'May-July bonuses')
  exact(sum(pnl, 'writeOffExpense'), 3_342_183.83, 'May-July write-offs')
  exact(sum(pnl, 'ebitda'), -11_060_353.09, 'May-July EBITDA')
  exact(sum(pnl, 'grossProfitReconciliationDelta'), -0.75, 'gross-profit reconciliation')
}

async function main(): Promise<void> {
  const root = resolve(__dirname, '..')
  if (process.env.AISTART360_ENV_FILE) {
    loadEnv(resolve(process.env.AISTART360_ENV_FILE))
  }
  loadEnv(join(root, '.env.local'))
  loadEnv(join(root, '.env'))
  const targetBinding = requiredTargetBinding()
  const expectedConfirmation = `PUBLISH_HONOR_FINANCIAL:${EXPECTED_SHA256.slice(0, 12)}:${targetBinding.bindingHash.slice(0, 12)}`

  const fileArgument = argument('--file') ?? process.env.HONOR_MANAGEMENT_FILE?.trim() ?? ''
  if (!fileArgument) throw new Error('Pass the audited workbook with --file')
  const filePath = resolve(fileArgument)
  const file = await readFile(filePath)
  if (file.length !== EXPECTED_SOURCE_SIZE_BYTES || file.length > MAX_FILE_BYTES) {
    throw new Error('Workbook size does not match the audited HONOR source')
  }
  const extension = extname(filePath).slice(1).toLowerCase()
  if (extension !== 'xlsx') throw new Error('The audited HONOR source must be an XLSX workbook')
  const sourceSha256 = createHash('sha256').update(file).digest('hex')
  if (sourceSha256 !== EXPECTED_SHA256) throw new Error('Workbook SHA-256 does not match the audited HONOR source')

  const preview = parseStoreImport(file, basename(filePath))
  if (
    preview.detectedKinds.length !== 1
    || preview.detectedKinds[0] !== 'management_period'
    || preview.summary.quarantinedRows !== 0
  ) throw new Error('Workbook did not normalize to one clean management-period import')
  const normalized = preview.data.management_period as unknown as Array<Record<string, unknown>>
  verifyControls(normalized)
  const payload = buildStorePublishPayload(preview)
  if (
    payload.scopeKey !== 'management_period:2025-01:2026-07'
    || payload.periodStart !== '2025-01-01'
    || payload.periodEnd !== '2026-07-31'
    || payload.warningCount !== 3
    || payload.quarantinedCount !== 0
  ) throw new Error('Publication envelope does not match the audited HONOR scope')
  const manifestSha256 = buildStorePublishManifestSha256({
    sourceSha256,
    sourceSizeBytes: file.length,
    payload,
  })
  if (manifestSha256 !== EXPECTED_MANIFEST_SHA256) {
    throw new Error('Semantic manifest does not match the audited HONOR normalization')
  }
  const releaseBinding = assertCommittedPublicationSource(root)

  const apply = process.argv.includes('--apply')
  const connectionString = (
    process.env.DIRECT_URL
    || process.env.DATABASE_URL
    || ''
  ).replace(/\\n$/g, '').trim()
  if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL is required')
  const databaseConfig = expectedDatabaseClientConfig(
    connectionString,
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n$/g, '').trim(),
    root,
  )
  const client = new Client(databaseConfig)
  await client.connect()

  const ownerResult = await client.query<{
    company_id: string
    user_id: string
    role: string
    status: string
    full_name: string
    organization: string
    company_name: string
  }>(`
    SELECT company.id::TEXT AS company_id,
           company.user_id::TEXT AS user_id,
           profile.role,
           profile.status,
           profile.full_name,
           profile.organization,
           company.name AS company_name
      FROM public.companies AS company
      JOIN public.profiles AS profile ON profile.id = company.user_id
     WHERE company.id::TEXT = $1
       AND company.user_id = $2::UUID
     LIMIT 2
  `, [targetBinding.companyId, targetBinding.userId])
  if (ownerResult.rows.length !== 1) {
    await client.end()
    throw new Error('Expected one exact HONOR Store company')
  }
  const owner = ownerResult.rows[0]
  if (
    owner.user_id.toLowerCase() !== targetBinding.userId
    || owner.company_id !== targetBinding.companyId
    || owner.role !== 'client'
    || owner.status !== 'approved'
    || owner.full_name !== STORE_DISPLAY_NAME
    || owner.organization !== STORE_DISPLAY_NAME
    || owner.company_name !== STORE_DISPLAY_NAME
  ) {
    await client.end()
    throw new Error('HONOR Store profile does not match the isolated approved client account')
  }
  const companyId = owner.company_id
  const userId = owner.user_id

  const safeSummary = {
    target: STORE_DISPLAY_NAME,
    targetBindingSha256: targetBinding.bindingHash,
    sourceCommit: releaseBinding.sourceCommit,
    sourceSha256,
    manifestSha256,
    normalizedMonths: normalized.length,
    firstMonth: payload.periodStart,
    lastMonth: payload.periodEnd,
    quarantinedRows: preview.summary.quarantinedRows,
    warningCount: payload.warningCount,
    controls: {
      revenue2025: sum(normalized.filter((row) => String(row.periodStart).startsWith('2025-')), 'revenue'),
      revenue2026Ytd: sum(normalized.filter((row) => String(row.periodStart).startsWith('2026-')), 'revenue'),
      ebitdaMayJuly2026: sum(normalized.filter((row) => row.ebitda !== null), 'ebitda'),
    },
  }
  if (!apply) {
    console.log(JSON.stringify({ outcome: 'dry_run', ...safeSummary }, null, 2))
    console.log(`Apply requires HONOR_MANAGEMENT_CONFIRM=${expectedConfirmation}`)
    await client.end()
    return
  }
  if (process.env.HONOR_MANAGEMENT_CONFIRM !== expectedConfirmation) {
    await client.end()
    throw new Error('HONOR_MANAGEMENT_CONFIRM does not match the audited source')
  }

  const idempotencyKey = randomUUID()
  await client.query('BEGIN')
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('aistart360:store-financial-release', 0))",
    )
    const ledgerResult = await client.query<{
      source_commit: string
      migration_090_sha256: string
    }>(`
      SELECT source_commit, migration_090_sha256
        FROM public.aistart360_store_financial_releases
       WHERE release_id = $1
       FOR SHARE
    `, [FINANCIAL_RELEASE_ID])
    const ledger = ledgerResult.rows[0]
    if (
      ledgerResult.rows.length !== 1
      || ledger?.source_commit !== releaseBinding.sourceCommit
      || ledger?.migration_090_sha256 !== releaseBinding.migrationSha256
    ) throw new Error('Installed Store financial schema does not match the committed publisher release')

    const lockedOwnerResult = await client.query<{
      company_id: string
      user_id: string
      role: string
      status: string
      full_name: string
      organization: string
      company_name: string
    }>(`
      SELECT company.id::TEXT AS company_id,
             company.user_id::TEXT AS user_id,
             profile.role,
             profile.status,
             profile.full_name,
             profile.organization,
             company.name AS company_name
        FROM public.companies AS company
        JOIN public.profiles AS profile ON profile.id = company.user_id
       WHERE company.id::TEXT = $1
         AND company.user_id = $2::UUID
       FOR SHARE OF company, profile
    `, [targetBinding.companyId, targetBinding.userId])
    const lockedOwner = lockedOwnerResult.rows[0]
    if (
      lockedOwnerResult.rows.length !== 1
      || lockedOwner?.user_id.toLowerCase() !== targetBinding.userId
      || lockedOwner?.company_id !== targetBinding.companyId
      || lockedOwner?.role !== 'client'
      || lockedOwner?.status !== 'approved'
      || lockedOwner?.full_name !== STORE_DISPLAY_NAME
      || lockedOwner?.organization !== STORE_DISPLAY_NAME
      || lockedOwner?.company_name !== STORE_DISPLAY_NAME
    ) throw new Error('HONOR Store account changed before publication lock')

    await client.query('SET LOCAL ROLE service_role')
    const publication = await client.query<{
      outcome: string
      row_count: number
      published_at: string
    }>(`
      SELECT * FROM public.publish_store_financial_import(
        $1::UUID, $2::TEXT, $3::TEXT, $4::TEXT, $5::INTEGER, $6::INTEGER,
        $7::UUID, $8::TEXT, $9::TEXT, $10::DATE, $11::DATE,
        $12::INTEGER, $13::INTEGER, $14::JSONB
      )
    `, [
      userId,
      companyId,
      sourceSha256,
      `store-import-${sourceSha256.slice(0, 12)}.xlsx`,
      file.length,
      STORE_IMPORT_SCHEMA_VERSION,
      idempotencyKey,
      manifestSha256,
      payload.scopeKey,
      payload.periodStart,
      payload.periodEnd,
      payload.warningCount,
      payload.quarantinedCount,
      JSON.stringify(payload.rows),
    ])
    const result = publication.rows[0]
    if (!result || !['published', 'duplicate'].includes(result.outcome)) {
      throw new Error('Financial publication RPC returned an invalid result')
    }
    const verifyResult = await client.query(`
      SELECT period.period_month, period.revenue, period.cost_amount,
             period.reported_gross_profit, period.period_expenses,
             period.bonuses, period.write_offs, period.ebitda,
             period.completeness, financial_import.manifest_sha256,
             financial_import.source_sha256, financial_import.scope_key AS import_scope_key
        FROM public.store_financial_periods AS period
        JOIN public.store_financial_imports AS financial_import
          ON financial_import.id = period.import_id
         AND financial_import.user_id = period.user_id
         AND financial_import.company_id = period.company_id
       WHERE period.user_id = $1::UUID
         AND period.company_id = $2::TEXT
         AND period.superseded_at IS NULL
       ORDER BY period.period_month ASC
    `, [userId, companyId])
    verifyControls(verifyResult.rows.map((row) => ({
      periodStart: row.period_month instanceof Date
        ? row.period_month.toISOString().slice(0, 10)
        : String(row.period_month),
      revenue: row.revenue,
      costOfGoods: row.cost_amount,
      grossProfit: Number(row.revenue) - Number(row.cost_amount),
      reportedGrossProfit: row.reported_gross_profit,
      periodExpenses: row.period_expenses,
      bonusExpense: row.bonuses,
      writeOffExpense: row.write_offs,
      ebitda: row.ebitda,
      completeness: row.completeness,
      grossProfitReconciliationDelta: row.reported_gross_profit === null
        ? null
        : Number(row.reported_gross_profit) - (Number(row.revenue) - Number(row.cost_amount)),
    })))
    if (verifyResult.rows.some((row) => (
      row.manifest_sha256 !== EXPECTED_MANIFEST_SHA256
      || row.source_sha256 !== EXPECTED_SHA256
      || row.import_scope_key !== 'management_period:2025-01:2026-07'
    ))) throw new Error('Published rows are not bound to the audited HONOR import')
    await client.query('COMMIT')
    console.log(JSON.stringify({
      outcome: result.outcome,
      publishedAt: result.published_at,
      rowCount: Number(result.row_count),
      ...safeSummary,
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'HONOR financial publication failed')
  process.exitCode = 1
})
