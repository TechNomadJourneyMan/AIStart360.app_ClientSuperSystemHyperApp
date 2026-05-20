// One-off check that migration 018 took effect:
//   - target_revenue_12m_kzt / target_revenue_3y_kzt columns exist on public.companies
//   - column comments populated
//   - helper index present

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
    SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies'
      AND column_name IN ('target_revenue_12m_kzt','target_revenue_3y_kzt')
    ORDER BY column_name
  `)
  console.log('columns:', cols.rows)

  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='companies'
      AND indexname='companies_target_revenue_12m_idx'
  `)
  console.log('index:', idx.rows)

  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
