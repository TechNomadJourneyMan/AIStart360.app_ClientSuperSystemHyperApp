// Verify migration 088: public.metrics is read-only for API roles.
//   - anon / authenticated: no INSERT / UPDATE / DELETE / TRUNCATE on metrics
//   - write policies dropped; SELECT policies still present
//   - service_role keeps INSERT / UPDATE
//   - metric_value_history trigger still attached; metrics still in Realtime
// Run: node scripts/verify-migration-088.js            (DIRECT_URL from .env)
//      VERIFY_URL=postgres://… node scripts/verify-migration-088.js

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
  const c = new Client({ connectionString: process.env.VERIFY_URL || process.env.DIRECT_URL })
  await c.connect()
  const problems = []

  const grants = await c.query(`
    SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'metrics'
      AND grantee IN ('anon', 'authenticated', 'service_role')`)
  const has = (role, priv) => grants.rows.some((r) => r.grantee === role && r.privilege_type === priv)
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      if (has(role, priv)) problems.push(`${role} still has ${priv} on metrics`)
    }
    if (!has(role, 'SELECT')) problems.push(`${role} lost SELECT on metrics`)
  }
  for (const priv of ['SELECT', 'INSERT', 'UPDATE']) {
    if (!has('service_role', priv)) problems.push(`service_role lacks ${priv} on metrics`)
  }

  const policies = await c.query(`
    SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.metrics'::regclass ORDER BY polname`)
  for (const p of policies.rows) {
    if (p.polcmd !== 'r') problems.push(`write policy still present: ${p.polname} (${p.polcmd})`)
  }
  for (const name of ['metrics_select_own', 'metrics_admin_select', 'metrics_tenant_select']) {
    if (!policies.rows.some((p) => p.polname === name)) problems.push(`missing SELECT policy ${name}`)
  }

  const trig = await c.query(`
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.metrics'::regclass AND tgname = 'metrics_record_history' AND NOT tgisinternal`)
  if (trig.rowCount === 0) problems.push('metrics_record_history trigger missing')

  const pub = await c.query(`
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'metrics'`)
  if (pub.rowCount === 0) console.warn('! metrics is not in the supabase_realtime publication (expected on Supabase, absent on a bare test DB)')

  const histGrants = await c.query(`
    SELECT grantee FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'metric_value_history'
      AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`)
  if (histGrants.rowCount > 0) problems.push('API roles can still modify metric_value_history')

  await c.end()
  if (problems.length) {
    console.error('✗ migration 088 NOT verified:')
    for (const p of problems) console.error('  -', p)
    process.exit(1)
  }
  console.table(policies.rows)
  console.log('✓ migration 088 verified — metrics is read-only for anon/authenticated; service role writes, history trigger intact')
})().catch((e) => { console.error(e); process.exit(1) })
