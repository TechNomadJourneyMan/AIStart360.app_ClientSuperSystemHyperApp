// scripts/seed-test-data.js
// Create test accounts (client/expert/admin) + full test data for ALL modules.
//  - auth.users via Supabase admin API (auto-confirmed), profiles approved.
//  - rich survey answers for the client (s1_current_revenue_* + s1_goal_*_revenue_year
//    so Point B computes a real plan; s2_* financials for Point A/metrics).
//  - a current diagnostic (Point A) via the real lib/point-a-engine.
//  - a current GRI assessment (gri_assessments) so GRI tab + admin distribution show data.
// Idempotent. All accounts use the @aistart360.test domain (easy to find/remove).
//
// Usage: node scripts/seed-test-data.js

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

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

const PASSWORD = 'Test1234!'
const ACCOUNTS = [
  { email: 'client@aistart360.test', role: 'client', name: 'Тест Клиент — Алтын Маркет' },
  { email: 'expert@aistart360.test', role: 'expert', name: 'Тест Эксперт' },
  { email: 'admin@aistart360.test',  role: 'admin',  name: 'Тест Админ' },
]

// Rich, realistic survey for the client. Current 120M ₸/yr → 12m goal 240M → 3y goal 600M.
const CLIENT_SURVEY = [
  ['s1_company_name', 'Алтын Маркет'],
  ['s1_industry', 'Ритейл / E-commerce'],
  ['s1_employee_count', 18],
  ['s1_business_model', 'Mixed'],
  ['s1_years_on_market', 4],
  ['s1_regions', ['Алматы', 'Астана']],
  // Current revenue (read by Point B engine, top priority)
  ['s1_current_revenue_month', 10000000],
  ['s1_current_revenue_year', 120000000],
  // Numeric goals (the core Point B inputs)
  ['s1_goal_12m_revenue_month', 20000000],
  ['s1_goal_12m_revenue_year', 240000000],
  ['s1_goal_3y_revenue_month', 50000000],
  ['s1_goal_3y_revenue_year', 600000000],
  ['s2n_goal_12m_what', 'Удвоить выручку и выйти в новый регион'],
  ['s2n_goal_3y_what', 'Стать лидером ниши в Казахстане'],
  // Financials for Point A / metrics
  ['s2_revenue_2023', 70000000],
  ['s2_revenue_2024', 95000000],
  ['s2_revenue_2025', 120000000],
  ['s2_gross_margin', 32],
  ['s2_cac', 18000],
  ['s2_ltv', 90000],
  ['s2_knows_breakeven', true],
  ['s7_avg_check', 45000],
  ['s7_avg_check_target_kzt', 60000],
  // Sales / ops / marketing signal for Point A blocks
  ['s3_has_crm', 'amocrm'],
  ['s3_deal_cycle_days', 21],
  ['s3_deals_2024', 180],
  ['s3_rejections_2024', 60],
  ['s3_has_loyalty', true],
  ['s4_has_org_chart', true],
  ['s4_has_dept_kpi', false],
  ['s4_has_regular_meetings', true],
  ['s4_task_manager', 'notion'],
  ['s4_management_method', 'okr'],
  ['s5_marketing_budget_pct', 9],
  ['s5_marketing_channels', ['social', 'partners', 'marketplace']],
  ['s5_target_audience', 'Розничные покупатели и малый бизнес в Казахстане'],
  ['s5_has_competitor_analysis', true],
  ['s5_usp', 'Быстрая доставка и широкий ассортимент локальных брендов'],
  ['s6_main_pain', 'Не хватает лидов и слабая конверсия в продажу'],
  ['s6_growth_blockers', ['Маркетинг', 'Команда']],
]

// GRI assessment: 7 sections (real section IDs from lib/gri-assessment/sections.ts),
// a few criteria each, scored 1..10. section_avgs + gri_index computed below.
const GRI_SCORES = {
  'product-demand':     { 'pd-1': 8, 'pd-2': 7, 'pd-3': 8, 'pd-4': 6 },
  'trust-positioning':  { 'tp-1': 6, 'tp-2': 7, 'tp-3': 5, 'tp-4': 6 },
  'business-model':     { 'bm-1': 7, 'bm-2': 7, 'bm-3': 6 },
  'cash-stability':     { 'cs-1': 5, 'cs-2': 6, 'cs-3': 5 },
  'operations':         { 'op-1': 6, 'op-2': 5, 'op-3': 6 },
  'team':               { 'tm-1': 5, 'tm-2': 6, 'tm-3': 4 },
  'founder-readiness':  { 'fr-1': 8, 'fr-2': 7, 'fr-3': 8 },
}

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function ensureAccount(client, { email, role, name }) {
  const { data: list } = await client.auth.admin.listUsers({ perPage: 500 })
  let user = list.users.find((u) => u.email === email)
  if (user) {
    const { data } = await client.auth.admin.updateUserById(user.id, {
      password: PASSWORD, email_confirm: true, user_metadata: { full_name: name, role },
    })
    user = data.user
    console.log(`  ↻ ${email} (${role}) updated`)
  } else {
    const { data, error } = await client.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name, role },
    })
    if (error) { console.error(`  ✗ createUser ${email}:`, error.message); return null }
    user = data.user
    console.log(`  ✓ ${email} (${role}) created`)
  }
  await client.from('profiles').upsert(
    { id: user.id, email, full_name: name, role, status: 'approved', approved_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  return user
}

async function seedClient(client, user) {
  const companyId = `test-co-${user.id.slice(0, 8)}`
  await client.from('companies').upsert(
    { id: companyId, user_id: user.id, name: 'Алтын Маркет', industry: 'Ритейл / E-commerce', stage: 'Growth', business_model: 'Mixed' },
    { onConflict: 'id' },
  )
  console.log(`  ✓ company ${companyId}`)

  let n = 0
  for (const [key, value] of CLIENT_SURVEY) {
    const step = parseInt(key.match(/s(\d+)/)?.[1] ?? '1', 10)
    const { error } = await client.from('survey_answers').upsert(
      { user_id: user.id, company_id: companyId, step: Math.min(step, 12), question_key: key, answer: { value }, answered_at: new Date().toISOString() },
      { onConflict: 'user_id,question_key' },
    )
    if (!error) n++
    else console.warn(`    ⚠ survey ${key}: ${error.message}`)
  }
  console.log(`  ✓ ${n}/${CLIENT_SURVEY.length} survey answers`)

  // Diagnostic via the real Point A engine (tsx eval).
  const answers = Object.fromEntries(CLIENT_SURVEY)
  const evalCode = `
    const { calculatePointA } = require(${JSON.stringify(path.resolve(__dirname, '..', 'lib/point-a-engine.ts'))});
    console.log(JSON.stringify(calculatePointA(${JSON.stringify(answers)})));
  `
  const proc = spawnSync('npx', ['-y', 'tsx', '-e', evalCode], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
  if (proc.status !== 0) { console.error('  ✗ Point A engine eval failed'); return { companyId } }
  const pa = JSON.parse(proc.stdout.trim().split('\n').pop())
  console.log(`  ✓ Point A: overall=${pa.overall_score} health=${pa.health_index} stage=${pa.stage}`)

  await client.from('diagnostics').update({ is_current: false }).eq('user_id', user.id).eq('is_current', true)
  const { data: prev } = await client.from('diagnostics').select('version').eq('user_id', user.id).order('version', { ascending: false }).limit(1).maybeSingle()
  const { error: dErr } = await client.from('diagnostics').insert({
    user_id: user.id, company_id: companyId, version: (prev?.version ?? 0) + 1,
    overall_score: pa.overall_score, health_index: pa.health_index, stage: pa.stage,
    finance_score: pa.blocks.finance, sales_score: pa.blocks.sales, operations_score: pa.blocks.operations,
    marketing_score: pa.blocks.marketing, strategy_score: pa.blocks.strategy,
    risks: pa.risks, insights: pa.insights, quick_wins: pa.quick_wins, data_gaps: pa.data_gaps,
    is_current: true, calculated_at: new Date().toISOString(), ai_status: 'none',
  })
  if (dErr) console.error('  ✗ diagnostic insert:', dErr.message)
  else console.log('  ✓ diagnostic (is_current)')

  // GRI assessment
  const sectionAvgs = {}
  for (const [sid, crit] of Object.entries(GRI_SCORES)) {
    const vals = Object.values(crit)
    sectionAvgs[sid] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
  }
  const griVals = Object.values(sectionAvgs)
  const griIndex = Math.round((griVals.reduce((a, b) => a + b, 0) / griVals.length) * 100) / 100
  await client.from('gri_assessments').update({ is_current: false }).eq('user_id', user.id).eq('is_current', true)
  const { error: gErr } = await client.from('gri_assessments').insert({
    user_id: user.id, company_id: companyId,
    onboarding: { company_name: 'Алтын Маркет', industry: 'Ритейл / E-commerce', stage: 'Growth' },
    scores: GRI_SCORES, section_avgs: sectionAvgs, gri_index: griIndex,
    completed_sections: Object.keys(GRI_SCORES),
    top_5_limits: [
      { rank: 1, title: 'Слабое удержание команды', block: 'team', severity: 'high' },
      { rank: 2, title: 'Низкая финансовая стабильность', block: 'cash-stability', severity: 'high' },
      { rank: 3, title: 'Несистемные операции', block: 'operations', severity: 'medium' },
      { rank: 4, title: 'Слабое позиционирование', block: 'trust-positioning', severity: 'medium' },
      { rank: 5, title: 'Нет KPI по отделам', block: 'operations', severity: 'medium' },
    ],
    action_plan_90d: { '1-30': ['Внедрить KPI по отделам'], '31-60': ['Укрепить команду продаж'], '61-90': ['Стабилизировать денежный поток'] },
    is_current: true,
  })
  if (gErr) console.warn('  ⚠ gri_assessments insert:', gErr.message)
  else console.log(`  ✓ GRI assessment (index=${griIndex}/10)`)

  return { companyId }
}

async function main() {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
  }
  const client = sb()

  console.log('→ Creating test accounts')
  const users = {}
  for (const acc of ACCOUNTS) {
    const u = await ensureAccount(client, acc)
    if (u) users[acc.role] = u
  }

  if (users.client) {
    console.log('\n→ Seeding client data (Алтын Маркет)')
    await seedClient(client, users.client)
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log(' ✓ Test accounts ready (password for all: ' + PASSWORD + ')')
  console.log('───────────────────────────────────────────────────')
  for (const acc of ACCOUNTS) console.log(`   ${acc.role.padEnd(7)} ${acc.email}`)
  console.log('───────────────────────────────────────────────────')
  console.log(' Client has: company, survey (current 120M ₸ → goal 240M/600M),')
  console.log(' a current diagnostic (Point A) and a GRI assessment.')
  console.log(' → /client/point-b shows a full goal-driven plan.')
  console.log(' → expert/admin can review the client across all tabs.')
}

main().catch((e) => { console.error(e); process.exit(1) })
