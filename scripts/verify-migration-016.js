// One-off check that migration 016 took effect:
//   - confidence / provenance / computed_at columns exist on public.metrics
//   - metrics_source_check accepts 'resolver'
//   - supabase_realtime publication contains metrics + diagnostics + documents

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

  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='metrics'
      AND column_name IN ('confidence','provenance','computed_at')
    ORDER BY column_name
  `)
  console.log('columns:', cols.rows)

  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid='public.metrics'::regclass AND contype='c'
  `)
  console.log('checks:', cons.rows)

  const pub = await client.query(`
    SELECT schemaname, tablename
    FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
      AND tablename IN ('metrics','diagnostics','documents')
    ORDER BY tablename
  `)
  console.log('realtime publication:', pub.rows)

  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
