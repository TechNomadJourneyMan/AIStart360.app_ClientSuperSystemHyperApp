// Applies the owner-scoped Store financial analytics schema as one
// provenance-bound transaction.
//
// The command refuses dirty/uncommitted migration source, partial schemas and
// direct table DML grants. Re-running the exact committed release is safe.
//
// Usage: node scripts/apply-store-financial-release.js

const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')

const RELEASE_ID = 'store-financial-analytics-v1'
const MIGRATION = 'supabase/migrations/090_store_financial_analytics.sql'
const RELEASE_SOURCES = [
  MIGRATION,
  'scripts/apply-store-financial-release.js',
  'config/certs/supabase-root-2021-ca.pem',
]
const EXPECTED_SUPABASE_PROJECT_REF = 'tpxwrwxpdcwmiynjjquy'
const EXPECTED_SUPABASE_URL = `https://${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co`
const SUPABASE_CA_FILE = 'config/certs/supabase-root-2021-ca.pem'
const EXPECTED_SUPABASE_CA_FINGERPRINT = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA'
const FINANCIAL_TABLES = [
  'store_financial_imports',
  'store_financial_periods',
]
const PUBLISH_SIGNATURE = [
  'public.publish_store_financial_import(uuid,text,text,text,integer,integer,',
  'uuid,text,text,date,date,integer,integer,jsonb)',
].join('')
const REQUIRED_TRIGGERS = [
  ['store_financial_imports', 'store_financial_imports_company_owner'],
  ['store_financial_periods', 'store_financial_periods_company_owner'],
  ['companies', 'store_cleanup_financial_company_before_delete'],
  ['companies', 'store_guard_financial_company_identity_before_update'],
]

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
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

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function gitRaw(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function releaseSource(root) {
  const sourceCommit = git(['rev-parse', 'HEAD'], root)
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('Unable to resolve release commit')
  }
  for (const file of RELEASE_SOURCES) {
    git(['ls-files', '--error-unmatch', file], root)
    const working = fs.readFileSync(path.join(root, file), 'utf8')
    const committedFile = gitRaw(['show', `${sourceCommit}:${file}`], root)
    if (working !== committedFile) {
      throw new Error(`${file} is not identical to committed release source`)
    }
  }
  const sql = fs.readFileSync(path.join(root, MIGRATION), 'utf8')
  return { sourceCommit, migrationSha256: sha256(sql), sql }
}

function assertExpectedDatabaseConnection(connectionString, publicSupabaseUrl) {
  let databaseUrl
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
  if ((publicSupabaseUrl || '').replace(/\/$/, '') !== EXPECTED_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL does not match the expected AIStart360 production project')
  }
  return databaseUrl
}

function verifiedSupabaseSsl(root) {
  const ca = fs.readFileSync(path.join(root, SUPABASE_CA_FILE), 'utf8')
  const certificate = new crypto.X509Certificate(ca)
  if (certificate.fingerprint256 !== EXPECTED_SUPABASE_CA_FINGERPRINT) {
    throw new Error('Pinned Supabase CA fingerprint does not match the audited certificate')
  }
  return { rejectUnauthorized: true, ca }
}

function expectedDatabaseClientConfig(connectionString, publicSupabaseUrl, root) {
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

async function inspectSchema(client) {
  const { rows: tables } = await client.query(`
    SELECT table_name, relation.relrowsecurity AS rls_enabled
      FROM information_schema.tables AS table_info
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.nspname = table_info.table_schema
      JOIN pg_catalog.pg_class AS relation
        ON relation.relnamespace = namespace.oid
       AND relation.relname = table_info.table_name
     WHERE table_info.table_schema = 'public'
       AND table_info.table_name = ANY($1::TEXT[])
  `, [FINANCIAL_TABLES])
  const { rows: functions } = await client.query(
    'SELECT to_regprocedure($1)::TEXT AS signature',
    [PUBLISH_SIGNATURE],
  )
  const { rows: triggers } = await client.query(`
    SELECT relation.relname AS table_name, trigger.tgname AS trigger_name
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND NOT trigger.tgisinternal
       AND (relation.relname, trigger.tgname) IN (
         ('store_financial_imports', 'store_financial_imports_company_owner'),
         ('store_financial_periods', 'store_financial_periods_company_owner'),
         ('companies', 'store_cleanup_financial_company_before_delete'),
         ('companies', 'store_guard_financial_company_identity_before_update')
       )
  `)
  return {
    tables,
    publishRpc: functions[0]?.signature ?? null,
    triggers,
  }
}

async function readLedger(client) {
  const { rows: relation } = await client.query(
    "SELECT to_regclass('public.aistart360_store_financial_releases')::TEXT AS relation",
  )
  if (!relation[0]?.relation) return null
  const { rows } = await client.query(`
    SELECT release_id, source_commit, migration_090_sha256, applied_at
      FROM public.aistart360_store_financial_releases
     WHERE release_id = $1
  `, [RELEASE_ID])
  return rows[0] ?? null
}

function assertInstalled(schema) {
  if (schema.tables.length !== FINANCIAL_TABLES.length) {
    throw new Error(`Financial schema post-check found ${schema.tables.length}/${FINANCIAL_TABLES.length} tables`)
  }
  if (schema.tables.some((table) => table.rls_enabled !== true)) {
    throw new Error('Financial schema post-check found a table without RLS')
  }
  if (!schema.publishRpc) throw new Error('Financial publication RPC is missing')
  for (const [tableName, triggerName] of REQUIRED_TRIGGERS) {
    if (!schema.triggers.some((row) => (
      row.table_name === tableName && row.trigger_name === triggerName
    ))) throw new Error(`Financial trigger is missing: ${triggerName}`)
  }
}

async function assertPrivileges(client) {
  for (const table of FINANCIAL_TABLES) {
    const { rows } = await client.query(`
      SELECT has_table_privilege('anon', $1, 'SELECT') AS anon_select,
             has_table_privilege('authenticated', $1, 'SELECT') AS authenticated_select,
             has_table_privilege('service_role', $1, 'SELECT') AS service_select,
             (
               has_table_privilege('authenticated', $1, 'INSERT')
               OR has_table_privilege('authenticated', $1, 'UPDATE')
               OR has_table_privilege('authenticated', $1, 'DELETE')
               OR has_table_privilege('service_role', $1, 'INSERT')
               OR has_table_privilege('service_role', $1, 'UPDATE')
               OR has_table_privilege('service_role', $1, 'DELETE')
             ) AS application_write
    `, [`public.${table}`])
    const privileges = rows[0]
    if (
      privileges?.anon_select
      || !privileges?.authenticated_select
      || !privileges?.service_select
      || privileges?.application_write
    ) throw new Error(`Financial privilege post-check failed for ${table}`)
  }
  const { rows } = await client.query(`
    SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS service_execute,
           has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute,
           has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute,
           has_schema_privilege('anon', 'public', 'CREATE') AS anon_create,
           has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_create
  `, [PUBLISH_SIGNATURE])
  if (
    !rows[0]?.service_execute
    || rows[0].authenticated_execute
    || rows[0].anon_execute
    || rows[0].anon_create
    || rows[0].authenticated_create
  ) throw new Error('Financial function/schema privilege post-check failed')
}

async function applyFinancialRelease(client, release) {
  await client.query('BEGIN')
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('aistart360:store-financial-release', 0))",
    )
    const [before, ledger] = await Promise.all([
      inspectSchema(client),
      readLedger(client),
    ])

    if (ledger) {
      if (
        ledger.source_commit !== release.sourceCommit
        || ledger.migration_090_sha256 !== release.migrationSha256
      ) throw new Error('Financial release ledger conflicts with the requested source')
      assertInstalled(before)
      await assertPrivileges(client)
      await client.query('COMMIT')
      return { outcome: 'already_applied', releaseId: RELEASE_ID, ...ledger }
    }

    if (before.tables.length > 0 || before.publishRpc || before.triggers.length > 0) {
      throw new Error('Untracked or partial Store financial schema exists; refusing automatic repair')
    }

    await client.query(release.sql)
    await client.query(`
      CREATE TABLE public.aistart360_store_financial_releases (
        release_id TEXT PRIMARY KEY,
        source_commit TEXT NOT NULL CHECK (source_commit ~ '^[a-f0-9]{40}$'),
        migration_090_sha256 TEXT NOT NULL CHECK (migration_090_sha256 ~ '^[a-f0-9]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      REVOKE ALL ON TABLE public.aistart360_store_financial_releases
        FROM PUBLIC, anon, authenticated, service_role;
    `)
    await client.query(`
      INSERT INTO public.aistart360_store_financial_releases (
        release_id, source_commit, migration_090_sha256
      ) VALUES ($1, $2, $3)
    `, [RELEASE_ID, release.sourceCommit, release.migrationSha256])

    const after = await inspectSchema(client)
    assertInstalled(after)
    await assertPrivileges(client)
    await client.query("NOTIFY pgrst, 'reload schema'")
    await client.query('COMMIT')
    return {
      outcome: 'applied',
      releaseId: RELEASE_ID,
      sourceCommit: release.sourceCommit,
      migration090Sha256: release.migrationSha256,
      tableCount: after.tables.length,
      rlsEnabled: after.tables.every((table) => table.rls_enabled === true),
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function main() {
  const root = path.resolve(__dirname, '..')
  if (process.env.AISTART360_ENV_FILE) {
    loadEnv(path.resolve(process.env.AISTART360_ENV_FILE))
  }
  loadEnv(path.join(root, '.env.local'))
  loadEnv(path.join(root, '.env'))
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

  const release = releaseSource(root)
  const client = new Client(databaseConfig)
  await client.connect()
  try {
    console.log(JSON.stringify(await applyFinancialRelease(client, release), null, 2))
  } finally {
    await client.end()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Financial release failed')
    process.exitCode = 1
  })
}

module.exports = {
  FINANCIAL_TABLES,
  EXPECTED_SUPABASE_PROJECT_REF,
  MIGRATION,
  PUBLISH_SIGNATURE,
  RELEASE_ID,
  applyFinancialRelease,
  assertExpectedDatabaseConnection,
  expectedDatabaseClientConfig,
  verifiedSupabaseSsl,
  assertInstalled,
  releaseSource,
  sha256,
}
