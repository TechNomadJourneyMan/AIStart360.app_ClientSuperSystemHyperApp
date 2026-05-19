// Inspect actual columns of public.documents to verify migration drift.
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/); if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
async function main() {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  const cols = await c.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='documents'
    ORDER BY ordinal_position
  `)
  console.log('public.documents columns:')
  for (const r of cols.rows) console.log(`  - ${r.column_name} :: ${r.data_type} ${r.is_nullable==='NO'?'NOT NULL':''} ${r.column_default?'DEFAULT '+r.column_default:''}`)
  const cons = await c.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid='public.documents'::regclass AND contype='c'
  `)
  console.log('\npublic.documents CHECK constraints:')
  for (const r of cons.rows) console.log(`  - ${r.conname}: ${r.def}`)
  await c.end()
}
main().catch(e => { console.error(e); process.exit(1) })
