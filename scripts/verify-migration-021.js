// One-off check that migration 021 took effect:
//   - public.gri_assessments table exists with expected columns + types
//   - indexes present
//   - is_current trigger present
//   - RLS enabled with expected policy names
//
// Also doubles as a pre-flight: prints public.companies.id / user_id types so
// we know what foreign-key column types to use.

const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}

async function main() {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))

  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await client.connect()

  const companies = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies'
      AND column_name IN ('id','user_id')
    ORDER BY column_name
  `)
  console.log('public.companies key columns:', companies.rows)

  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gri_assessments'
    ORDER BY ordinal_position
  `)
  console.log('gri_assessments columns:', cols.rows)

  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='gri_assessments'
    ORDER BY indexname
  `)
  console.log('gri_assessments indexes:', idx.rows)

  const trg = await client.query(`
    SELECT tgname, pg_get_triggerdef(oid) AS def
    FROM pg_trigger
    WHERE tgrelid = 'public.gri_assessments'::regclass
      AND NOT tgisinternal
    ORDER BY tgname
  `)
  console.log('gri_assessments triggers:', trg.rows)

  const pol = await client.query(`
    SELECT polname, polcmd
    FROM pg_policy
    WHERE polrelid = 'public.gri_assessments'::regclass
    ORDER BY polname
  `)
  console.log('gri_assessments policies:', pol.rows)

  const rls = await client.query(`
    SELECT relname, relrowsecurity
    FROM pg_class
    WHERE oid = 'public.gri_assessments'::regclass
  `)
  console.log('gri_assessments RLS enabled:', rls.rows)

  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
