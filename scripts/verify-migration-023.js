// Verify migration 023: SELECT/INSERT/UPDATE policies on public.metrics.
// Run: node scripts/verify-migration-023.js

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

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

;(async () => {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))
  const c = new Client({ connectionString: process.env.DIRECT_URL })
  await c.connect()
  const r = await c.query(`
    select policyname, cmd
    from pg_policies
    where tablename = 'metrics'
      and schemaname = 'public'
    order by cmd, policyname
  `)
  const expected = new Set([
    'metrics_select_own:SELECT',
    'metrics_admin_select:SELECT',
    'metrics_insert_own:INSERT',
    'metrics_update_own:UPDATE',
    'metrics_admin_update:UPDATE',
  ])
  const have = new Set(r.rows.map((x) => `${x.policyname}:${x.cmd}`))
  const missing = [...expected].filter((p) => !have.has(p))
  if (missing.length) {
    console.error('Missing policies:', missing)
    process.exit(1)
  }
  console.table(r.rows)
  console.log('✓ migration 023 verified — metrics has SELECT/INSERT/UPDATE policies')
  await c.end()
})().catch((e) => { console.error(e); process.exit(1) })
