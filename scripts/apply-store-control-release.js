// Applies the Store schema as one provenance-bound transaction.
//
// Unlike the generic single-file helper, this command never exposes the
// temporary Phase-1 DML grants from 084: 084 and 085 commit together or both
// roll back. It also refuses to re-run 084 after 085 and records immutable
// source commit + migration hashes.
//
// Usage: node scripts/apply-store-control-release.js

const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')

const RELEASE_ID = 'store-control-center-v1'
const MIGRATIONS = [
  'supabase/migrations/084_store_control_center.sql',
  'supabase/migrations/085_store_import_publication.sql',
]
const STORE_TABLES = [
  'store_import_runs',
  'store_warehouses',
  'store_product_variants',
  'store_price_snapshots',
  'store_inventory_snapshots',
  'store_sales_lines',
  'store_import_variant_mappings',
]
const PUBLISH_SIGNATURE = [
  'public.publish_store_import(uuid,text,text,text,integer,integer,uuid,text,text,text,',
  'date,date,date,integer,integer,jsonb)',
].join('')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
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

function releaseSources(root) {
  const commitSha = git(['rev-parse', 'HEAD'], root)
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error('Unable to resolve release commit')

  const sources = MIGRATIONS.map((relativePath) => {
    git(['ls-files', '--error-unmatch', relativePath], root)
    const disk = fs.readFileSync(path.join(root, relativePath), 'utf8')
    const committed = gitRaw(['show', `${commitSha}:${relativePath}`], root)
    if (disk !== committed) {
      throw new Error(`${relativePath} is not identical to committed release source`)
    }
    return { relativePath, sql: disk, sha256: sha256(disk) }
  })
  return { commitSha, sources }
}

async function inspectStoreSchema(client) {
  const { rows: tableRows } = await client.query(`
    SELECT table_name,
           c.relrowsecurity AS rls_enabled
      FROM information_schema.tables AS t
      JOIN pg_catalog.pg_namespace AS n
        ON n.nspname = t.table_schema
      JOIN pg_catalog.pg_class AS c
        ON c.relnamespace = n.oid
       AND c.relname = t.table_name
     WHERE t.table_schema = 'public'
       AND t.table_name = ANY($1::TEXT[])
  `, [STORE_TABLES])
  const { rows: functionRows } = await client.query(
    'SELECT to_regprocedure($1)::TEXT AS signature',
    [PUBLISH_SIGNATURE],
  )
  const { rows: triggerRows } = await client.query(`
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'companies'
       AND trigger.tgname = 'store_company_cleanup'
       AND NOT trigger.tgisinternal
  `)
  return {
    tables: tableRows,
    publishRpc: functionRows[0]?.signature ?? null,
    companyCleanupTrigger: triggerRows.length === 1,
  }
}

async function readLedger(client) {
  const { rows: ledgerRelation } = await client.query(
    "SELECT to_regclass('public.aistart360_schema_releases')::TEXT AS relation",
  )
  if (!ledgerRelation[0]?.relation) return null
  const { rows } = await client.query(`
    SELECT release_id, source_commit, migration_084_sha256, migration_085_sha256,
           applied_at
      FROM public.aistart360_schema_releases
     WHERE release_id = $1
  `, [RELEASE_ID])
  return rows[0] ?? null
}

function assertInstalled(schema) {
  if (schema.tables.length !== STORE_TABLES.length) {
    throw new Error(`Store schema post-check found ${schema.tables.length}/${STORE_TABLES.length} tables`)
  }
  if (schema.tables.some((table) => table.rls_enabled !== true)) {
    throw new Error('Store schema post-check found a table without RLS')
  }
  if (!schema.publishRpc) throw new Error('Store publication RPC is missing')
  if (!schema.companyCleanupTrigger) throw new Error('Store company cleanup trigger is missing')
}

async function assertPrivileges(client) {
  for (const table of STORE_TABLES) {
    const { rows } = await client.query(`
      SELECT has_table_privilege('authenticated', $1, 'SELECT') AS authenticated_select,
             (
               has_table_privilege('authenticated', $1, 'INSERT')
               OR has_table_privilege('authenticated', $1, 'UPDATE')
               OR has_table_privilege('authenticated', $1, 'DELETE')
             ) AS authenticated_write,
             (
               has_table_privilege('service_role', $1, 'INSERT')
               OR has_table_privilege('service_role', $1, 'UPDATE')
               OR has_table_privilege('service_role', $1, 'DELETE')
             ) AS service_write
    `, [`public.${table}`])
    if (!rows[0]?.authenticated_select || rows[0].authenticated_write || rows[0].service_write) {
      throw new Error(`Store privilege post-check failed for ${table}`)
    }
  }
  const { rows } = await client.query(`
    SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS service_execute,
           has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute,
           has_schema_privilege('anon', 'public', 'CREATE') AS anon_create,
           has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_create
  `, [PUBLISH_SIGNATURE])
  if (
    !rows[0]?.service_execute
    || rows[0].authenticated_execute
    || rows[0].anon_create
    || rows[0].authenticated_create
  ) {
    throw new Error('Store function/schema privilege post-check failed')
  }
}

async function applyStoreRelease(client, release) {
  await client.query('BEGIN')
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('aistart360:store-control-release', 0))",
    )
    const [before, ledger] = await Promise.all([
      inspectStoreSchema(client),
      readLedger(client),
    ])

    if (ledger) {
      const matches = ledger.source_commit === release.commitSha
        && ledger.migration_084_sha256 === release.sources[0].sha256
        && ledger.migration_085_sha256 === release.sources[1].sha256
      if (!matches) throw new Error('Store release ledger conflicts with the requested source')
      assertInstalled(before)
      await assertPrivileges(client)
      await client.query('COMMIT')
      return { outcome: 'already_applied', releaseId: RELEASE_ID, ...ledger }
    }

    if (before.tables.length > 0 || before.publishRpc || before.companyCleanupTrigger) {
      throw new Error('Untracked or partial Store schema exists; refusing automatic repair')
    }

    // Both migrations remain inside this transaction. Never split them.
    await client.query(release.sources[0].sql)
    await client.query(release.sources[1].sql)

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.aistart360_schema_releases (
        release_id TEXT PRIMARY KEY,
        source_commit TEXT NOT NULL CHECK (source_commit ~ '^[a-f0-9]{40}$'),
        migration_084_sha256 TEXT NOT NULL CHECK (migration_084_sha256 ~ '^[a-f0-9]{64}$'),
        migration_085_sha256 TEXT NOT NULL CHECK (migration_085_sha256 ~ '^[a-f0-9]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      REVOKE ALL ON TABLE public.aistart360_schema_releases
        FROM PUBLIC, anon, authenticated, service_role;
    `)
    await client.query(`
      INSERT INTO public.aistart360_schema_releases (
        release_id, source_commit, migration_084_sha256, migration_085_sha256
      ) VALUES ($1, $2, $3, $4)
    `, [
      RELEASE_ID,
      release.commitSha,
      release.sources[0].sha256,
      release.sources[1].sha256,
    ])

    const after = await inspectStoreSchema(client)
    assertInstalled(after)
    await assertPrivileges(client)
    await client.query("NOTIFY pgrst, 'reload schema'")
    await client.query('COMMIT')
    return {
      outcome: 'applied',
      releaseId: RELEASE_ID,
      sourceCommit: release.commitSha,
      migration084Sha256: release.sources[0].sha256,
      migration085Sha256: release.sources[1].sha256,
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
  loadEnv(path.join(root, '.env.local'))
  loadEnv(path.join(root, '.env'))
  const connectionString = (
    process.env.DIRECT_URL
    || process.env.DATABASE_URL
    || ''
  ).replace(/\\n$/g, '').trim()
  if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL is required')

  const release = releaseSources(root)
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const result = await applyStoreRelease(client, release)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await client.end()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Store release failed')
    process.exitCode = 1
  })
}

module.exports = {
  MIGRATIONS,
  PUBLISH_SIGNATURE,
  RELEASE_ID,
  STORE_TABLES,
  applyStoreRelease,
  assertInstalled,
  releaseSources,
  sha256,
}
