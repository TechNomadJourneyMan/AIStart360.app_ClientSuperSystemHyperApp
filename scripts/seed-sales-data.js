// Seed realistic sales data into documents.parsed_data for a test account.
// Creates one sales_report document with raw_rows spanning 2023-2026,
// 6 products, 4 managers, ~600 transactions across 80 unique clients.
//
// Usage: node scripts/seed-sales-data.js <email>

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

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

const PRODUCTS = [
  { id: 'prod-saas-pro',     name: 'AIStart360 Pro',        unit: 240000 },
  { id: 'prod-saas-team',    name: 'AIStart360 Team',       unit: 480000 },
  { id: 'prod-saas-ent',     name: 'AIStart360 Enterprise', unit: 1200000 },
  { id: 'prod-onboarding',   name: 'Внедрение',             unit: 350000 },
  { id: 'prod-consult',      name: 'Консалтинг (час)',      unit: 25000 },
  { id: 'prod-data-package', name: 'Дата-пакет',            unit: 180000 },
]

const MANAGERS = [
  { id: 'mgr-aida',  name: 'Аида Сейтжанова' },
  { id: 'mgr-yerk',  name: 'Еркин Касенов' },
  { id: 'mgr-kam',   name: 'Камила Ахметова' },
  { id: 'mgr-rus',   name: 'Руслан Жумабаев' },
]

// Deterministic RNG for repeatable seeds.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function genClients(rng, count) {
  const clients = []
  for (let i = 0; i < count; i++) {
    clients.push({
      client_id: `cli-${String(i + 1).padStart(4, '0')}`,
      name: `Клиент-${i + 1}`,
      // Mix of repeat-prone and one-time buyers
      tendency: rng() < 0.6 ? 'repeat' : 'onetime',
    })
  }
  return clients
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)] }

function generateRows(rng, clients) {
  const rows = []
  // Start of 2023 → end of May 2026 (≈ 41 months).
  // Distribute ~600 transactions across this window with growth trend.
  const startMs = new Date('2023-01-15T10:00:00Z').getTime()
  const endMs = new Date('2026-05-15T10:00:00Z').getTime()
  const monthsTotal = 41
  const txPerMonthBase = 12 // grows to ~22 by 2026
  const seen = new Map() // client_id → first occurrence epoch ms

  for (let m = 0; m < monthsTotal; m++) {
    const growthMul = 1 + (m / monthsTotal) * 0.85 // 1.0 → 1.85
    const txThisMonth = Math.round(txPerMonthBase * growthMul + (rng() - 0.5) * 4)
    const monthStart = startMs + (m / monthsTotal) * (endMs - startMs)
    const monthSpan = (endMs - startMs) / monthsTotal

    for (let i = 0; i < txThisMonth; i++) {
      // Pick a client biased toward repeats once base has size
      let client
      if (seen.size > 20 && rng() < 0.45) {
        // Reuse a recent client
        const recentIds = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(x => x[0])
        client = clients.find(c => c.client_id === pick(rng, recentIds))
      }
      if (!client) client = pick(rng, clients)

      const product = pick(rng, PRODUCTS)
      const manager = pick(rng, MANAGERS)
      const qty = product.unit < 100000 ? 1 + Math.floor(rng() * 4) : 1
      const amount = Math.round(product.unit * qty * (0.85 + rng() * 0.3))
      const occurredAt = new Date(monthStart + rng() * monthSpan).toISOString()

      if (!seen.has(client.client_id)) seen.set(client.client_id, Date.parse(occurredAt))

      rows.push({
        client_id: client.client_id,
        client_name: client.name,
        manager_id: manager.id,
        manager_name: manager.name,
        product_id: product.id,
        product_name: product.name,
        amount,
        quantity: qty,
        occurred_at: occurredAt,
      })
    }
  }
  return rows.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
}

async function main() {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))

  const email = process.argv[2] || 'qa@aistart360.local'

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Find user by email
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 200 })
  if (listErr) { console.error(listErr.message); process.exit(1) }
  const user = list.users.find(u => u.email === email)
  if (!user) { console.error(`User ${email} not found`); process.exit(1) }

  // Find company
  const { data: cos, error: coErr } = await sb.from('companies').select('id').eq('user_id', user.id).limit(1)
  if (coErr) { console.error(coErr.message); process.exit(1) }
  const companyId = cos?.[0]?.id || `test-co-${user.id.slice(0, 8)}`

  console.log(`Seeding sales data for ${email} (user=${user.id}, company=${companyId})`)

  const rng = mulberry32(0xa15ec1)
  const clients = genClients(rng, 80)
  const rows = generateRows(rng, clients)

  console.log(`Generated ${rows.length} sales rows across ${clients.length} clients`)
  console.log(`Date span: ${rows[0].occurred_at} → ${rows[rows.length - 1].occurred_at}`)
  const totalKzt = rows.reduce((s, r) => s + r.amount, 0)
  console.log(`Total revenue: ${Math.round(totalKzt / 1e6)}M ₸`)

  // Optional: also build a small client base derived from sales rows
  // so RFM / retention curve / loss-map engines have data.
  const byClient = new Map()
  for (const r of rows) {
    const ts = Date.parse(r.occurred_at)
    const cur = byClient.get(r.client_id)
    if (!cur) {
      byClient.set(r.client_id, {
        client_id: r.client_id,
        name: r.client_name,
        first_purchase_date: r.occurred_at,
        last_purchase_date: r.occurred_at,
        total_spent_kzt: r.amount,
        purchase_count: 1,
      })
    } else {
      cur.purchase_count++
      cur.total_spent_kzt += r.amount
      if (ts < Date.parse(cur.first_purchase_date)) cur.first_purchase_date = r.occurred_at
      if (ts > Date.parse(cur.last_purchase_date)) cur.last_purchase_date = r.occurred_at
    }
  }
  const clientRows = [...byClient.values()]
  console.log(`Client base: ${clientRows.length} unique clients`)

  // Upsert sales-report document
  const salesDocId = crypto.createHash('md5').update(`${user.id}-sales-seed`).digest('hex')
  const fileName = 'sales_report_2023-2026.csv'
  const parsedDataSales = {
    classification: 'sales_report',
    raw_rows: rows,
    fields: {
      total_revenue_kzt: totalKzt,
      total_rows: rows.length,
      date_from: rows[0].occurred_at,
      date_to: rows[rows.length - 1].occurred_at,
    },
    summary: {
      total_revenue: totalKzt,
      total_transactions: rows.length,
      unique_clients: clientRows.length,
    },
  }

  const { error: e1 } = await sb.from('documents').upsert({
    id: salesDocId,
    user_id: user.id,
    file_name: fileName,
    file_url: `seed://${fileName}`,
    file_size: 256000,
    mime_type: 'text/csv',
    doc_type: 'sales_report',
    classified_type: 'sales_report',
    classification_conf: 1.0,
    parse_status: 'parsed',
    parsed_data: parsedDataSales,
    extractor_version: 'seed-v1',
    last_extracted_at: new Date().toISOString(),
    uploaded_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (e1) { console.error('sales doc upsert failed:', e1.message); process.exit(1) }
  console.log(`✓ sales_report document upserted (${rows.length} rows)`)

  // Upsert client base document (for RFM / retention)
  const clientDocId = crypto.createHash('md5').update(`${user.id}-clients-seed`).digest('hex')
  const parsedDataClients = {
    classification: 'client_base',
    client_rows: clientRows,
    fields: { total_clients: clientRows.length },
  }
  const { error: e2 } = await sb.from('documents').upsert({
    id: clientDocId,
    user_id: user.id,
    file_name: 'client_base.csv',
    file_url: 'seed://client_base.csv',
    file_size: 128000,
    mime_type: 'text/csv',
    doc_type: 'crm_export',
    classified_type: 'client_base',
    classification_conf: 1.0,
    parse_status: 'parsed',
    parsed_data: parsedDataClients,
    extractor_version: 'seed-v1',
    last_extracted_at: new Date().toISOString(),
    uploaded_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (e2) { console.error('client doc upsert failed:', e2.message); process.exit(1) }
  console.log(`✓ client_base document upserted (${clientRows.length} clients)`)

  // 3a. Seed funnel + AI-comms signals so loss-map shows real numbers.
  const funnelAnswers = [
    ['s7_leads_per_month',       200],
    ['s7_no_show_rate',          0.15],
    ['s7_missed_calls_rate',     0.08],
    ['s7_avg_check_target_kzt',  100000],
    ['s7_repeat_freq_days',      90],
    ['s7_nps_score',             35],
    ['s2_avg_check',             75000],
    ['s2_ltv',                   350000],
  ]
  for (const [key, value] of funnelAnswers) {
    const step = parseInt(key.match(/s(\d+)/)?.[1] ?? '0', 10)
    const { error } = await sb.from('survey_answers').upsert({
      user_id: user.id,
      company_id: companyId,
      step,
      question_key: key,
      answer: { value },
      answered_at: new Date().toISOString(),
    }, { onConflict: 'user_id,question_key' })
    if (error) console.warn(`  ⚠ survey ${key}: ${error.message}`)
  }
  console.log(`✓ seeded ${funnelAnswers.length} funnel signals for loss-map`)

  // Set explicit revenue targets on companies row for plan-vs-fact math
  const target12m = 360_000_000 // 360M ₸ in 2026
  const target3y  = 1_500_000_000 // 1.5B ₸ cumulative
  const { error: e3 } = await sb.from('companies').update({
    target_revenue_12m_kzt: target12m,
    target_revenue_3y_kzt: target3y,
  }).eq('id', companyId)
  if (e3) {
    console.warn(`  ⚠ company targets update warning: ${e3.message}`)
  } else {
    console.log(`✓ company targets set: 12m=${target12m / 1e6}M ₸, 3y=${target3y / 1e6}M ₸`)
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════')
  console.log(' ✓ Seed complete — reload /dashboard to see live data')
  console.log('═══════════════════════════════════════════════════')
}

main().catch(e => { console.error(e); process.exit(1) })
