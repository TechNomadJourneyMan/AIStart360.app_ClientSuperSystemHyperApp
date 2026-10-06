#!/usr/bin/env node
// Build a disposable local Postgres that mirrors the production schema.
//
//   TEST_DB_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
//   node scripts/test-db/setup.mjs [--db aistart360_test]
//
// Production schema = Prisma tables first (prod `companies` is the Prisma table
// with TEXT ids; migration 013 bolted the onboarding columns onto it) + every
// supabase/migrations/*.sql in filename order. This script recreates that on a
// throwaway database so integration / tenant-isolation tests run against real
// SQL and real RLS policies, never against production.
//
// pgvector may be missing locally: `vector(N)` columns become real[] and
// vector indexes are skipped. Embedding search is not exercised by this DB.
//
// Refuses to touch anything that is not localhost.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')

const adminUrl = process.env.TEST_DB_ADMIN_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const dbArg = process.argv.indexOf('--db')
const dbName = dbArg > 0 ? process.argv[dbArg + 1] : 'aistart360_test'
const quiet = process.argv.includes('--quiet')

const admin = new URL(adminUrl)
if (!['127.0.0.1', 'localhost', '::1'].includes(admin.hostname)) {
  console.error(`Refusing to run against non-local host ${admin.hostname}`)
  process.exit(1)
}
if (!/^[a-z0-9_]+$/.test(dbName)) {
  console.error(`Bad database name ${dbName}`)
  process.exit(1)
}

const log = (...a) => { if (!quiet) console.log(...a) }

async function hasPgvector(client) {
  const { rows } = await client.query(`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`)
  return rows.length > 0
}

function shimVector(sql, vectorAvailable) {
  if (vectorAvailable) return sql
  return sql
    .replace(/CREATE EXTENSION IF NOT EXISTS "?vector"?[^;]*;/gi, '')
    // drop whole index statements that use vector operator classes
    .replace(/create\s+index[^;]*?(hnsw|ivfflat)[^;]*;/gis, '')
    .replace(/\bvector\(\d+\)/gi, 'real[]')
    .replace(/\(text,\s*vector,/gi, '(text, real[],')
}

// Known drift between migration files and production. Each rule rewrites a
// migration the way prod actually ended up, and is documented in
// docs/platform/03-database.md (section "Schema drift").
const DRIFT_RULES = {
  // 001 declared company_id UUID → companies(id), but prod `companies.id` is
  // the Prisma TEXT column; later migrations (021/024/032) use TEXT too.
  //
  // Prod `companies` already existed (Prisma) when 001 ran, so its CREATE TABLE
  // was a no-op; the onboarding columns arrived later (013 + manual fixes).
  // Model that end state: add the 001 columns to the Prisma table up front.
  '001_onboarding_system.sql': (sql) =>
    sql
      .replace(/company_id(\s+)UUID(\s+(?:NOT NULL\s+)?REFERENCES public\.companies)/g, 'company_id$1TEXT$2')
      .replace(
        /CREATE TABLE IF NOT EXISTS public\.companies \([\s\S]*?\n\);/,
        `ALTER TABLE public.companies
           ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
           ADD COLUMN IF NOT EXISTS industry TEXT,
           ADD COLUMN IF NOT EXISTS stage TEXT,
           ADD COLUMN IF NOT EXISTS employee_count INTEGER,
           ADD COLUMN IF NOT EXISTS founded_at DATE,
           ADD COLUMN IF NOT EXISTS business_model TEXT,
           ADD COLUMN IF NOT EXISTS regions TEXT[] DEFAULT '{}',
           ADD COLUMN IF NOT EXISTS contact_name TEXT,
           ADD COLUMN IF NOT EXISTS contact_position TEXT,
           ADD COLUMN IF NOT EXISTS contact_phone TEXT,
           ADD COLUMN IF NOT EXISTS contact_email TEXT,
           ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
      ),
  // 013 sets a TEXT default on the id column; locally the column is already
  // TEXT (Prisma), matching prod, so the rule only documents the dependency.
}

// Data migrations that assert on production rows; nothing to migrate in an
// empty database.
const SKIP = {
  '072_omnichannel_direct_catalog.sql': 'asserts on production Honor channel rows',
}

function applyDrift(file, sql) {
  return DRIFT_RULES[file] ? DRIFT_RULES[file](sql) : sql
}

function prismaDdl() {
  const out = execFileSync(
    path.join(root, 'node_modules', '.bin', 'prisma'),
    ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
    { cwd: root, env: { ...process.env, DATABASE_URL: 'postgres://x', DIRECT_URL: 'postgres://x' }, encoding: 'utf8' },
  )
  // Statements are separated by blank-line comment headers; none contain bodies.
  return out
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}

async function main() {
  const adminClient = new pg.Client({ connectionString: adminUrl })
  await adminClient.connect()
  await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
  await adminClient.query(`CREATE DATABASE ${dbName}`)
  await adminClient.end()

  const dbUrl = new URL(adminUrl)
  dbUrl.pathname = `/${dbName}`
  const client = new pg.Client({ connectionString: dbUrl.toString() })
  await client.connect()
  const vectorAvailable = await hasPgvector(client)
  log(`→ ${dbName} (pgvector ${vectorAvailable ? 'available' : 'missing — shimmed as real[]'})`)

  // Function bodies may reference operators from pgvector; don't validate them.
  await client.query('SET check_function_bodies = off')

  await client.query(fs.readFileSync(path.join(here, 'supabase-stubs.sql'), 'utf8'))
  log('✓ supabase stubs')

  const failures = []
  for (const stmt of prismaDdl()) {
    try {
      await client.query(shimVector(stmt + ';', vectorAvailable))
    } catch (err) {
      failures.push({ file: 'prisma', error: err.message, stmt: stmt.slice(0, 120) })
    }
  }
  log('✓ prisma tables')

  const migDir = path.join(root, 'supabase', 'migrations')
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (SKIP[file]) {
      log(`  - ${file} skipped: ${SKIP[file]}`)
      continue
    }
    const sql = shimVector(applyDrift(file, fs.readFileSync(path.join(migDir, file), 'utf8')), vectorAvailable)
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('COMMIT')
      log(`  ✓ ${file}`)
    } catch (err) {
      await client.query('ROLLBACK')
      failures.push({ file, error: err.message })
      log(`  ✗ ${file}: ${err.message}`)
    }
  }

  // Grants come from the stubs' ALTER DEFAULT PRIVILEGES, exactly like
  // Supabase; a blanket GRANT here would undo the migrations' REVOKEs.
  await client.end()

  if (failures.length) {
    console.error(`\n${failures.length} step(s) failed:`)
    for (const f of failures) console.error(`  ${f.file}: ${f.error}${f.stmt ? `\n    ${f.stmt}` : ''}`)
    process.exit(2)
  }
  console.log(`✓ ${dbName} ready: ${dbUrl.toString().replace(/:[^:@/]+@/, ':***@')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
