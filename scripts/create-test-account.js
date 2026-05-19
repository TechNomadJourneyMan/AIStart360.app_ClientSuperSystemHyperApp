// Create a test account for local Point A development.
// - Creates an auth.users row via Supabase admin API (auto-confirmed).
// - The on_auth_user_created trigger auto-creates public.profiles.
// - Updates the profile to status='approved' + role='admin'.
// - Creates a public.companies row tied to the user so Point A aggregator works.
// - Idempotent: re-running with the same email updates the password / re-approves.

const { createClient } = require('@supabase/supabase-js')
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

  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPA_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  // Take overrides from CLI args, fall back to safe defaults.
  const email = process.argv[2] || 'test@aistart360.local'
  const password = process.argv[3] || 'TestPass2026!'
  const role = process.argv[4] || 'admin'
  const fullName = 'AIStart360 Test User'

  const sb = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`→ creating account email=${email} role=${role}`)

  // 1. Check if user already exists (by email).
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 200 })
  if (listErr) {
    console.error('listUsers failed:', listErr.message)
    process.exit(1)
  }
  let user = list.users.find((u) => u.email === email)

  if (user) {
    // Update existing user's password.
    const { data, error } = await sb.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    })
    if (error) {
      console.error('updateUser failed:', error.message)
      process.exit(1)
    }
    user = data.user
    console.log(`  ↻ existing user updated (${user.id})`)
  } else {
    // Create new user, auto-confirmed.
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    })
    if (error) {
      console.error('createUser failed:', error.message)
      process.exit(1)
    }
    user = data.user
    console.log(`  ✓ new user created (${user.id})`)
  }

  if (!user) {
    console.error('No user returned from auth admin API')
    process.exit(1)
  }

  // 2. Ensure profile is approved + has the desired role.
  //    The on_auth_user_created trigger should have created the row already,
  //    but we upsert defensively.
  const { error: profileErr } = await sb
    .from('profiles')
    .upsert(
      {
        id: user.id,
        email,
        full_name: fullName,
        role,
        status: 'approved',
        approved_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
  if (profileErr) {
    console.error('profile upsert failed:', profileErr.message)
    process.exit(1)
  }
  console.log(`  ✓ profile status=approved role=${role}`)

  // 3. Create or update a test company so Point A aggregator has data.
  //    Schema check: companies.id is text, user_id is uuid (from earlier inspection).
  const companyId = `test-co-${user.id.slice(0, 8)}`
  const { error: companyErr } = await sb
    .from('companies')
    .upsert(
      {
        id: companyId,
        user_id: user.id,
        name: 'AIStart360 Test Company',
        industry: 'b2b_saas',
        stage: 'Growth',
        business_model: 'B2B',
      },
      { onConflict: 'id' },
    )
  if (companyErr) {
    console.warn('  ⚠ company upsert warning (non-fatal):', companyErr.message)
  } else {
    console.log(`  ✓ company created/updated id=${companyId}`)
  }

  // 4. Seed a handful of survey answers so Point A engine has signal.
  const seed = [
    ['s1_company_name', 'AIStart360 Test Company'],
    ['s1_industry', 'b2b_saas'],
    ['s1_stage', 'Growth'],
    ['s2_revenue_2023', 60000000],
    ['s2_revenue_2024', 84200000],
    ['s2_revenue_2025', 95000000],
    ['s2_gross_margin', 34.2],
    ['s2_cac', 25000],
    ['s2_ltv', 80000],
    ['s2_knows_breakeven', true],
    ['s2_debt_load', 'moderate'],
    ['s3_has_crm', 'amocrm'],
    ['s3_deal_cycle_days', 28],
    ['s3_deals_2024', 142],
    ['s3_rejections_2024', 38],
    ['s3_has_loyalty', true],
    ['s4_has_org_chart', true],
    ['s4_has_dept_kpi', true],
    ['s4_has_regular_meetings', true],
    ['s4_reporting_tool', 'bi'],
    ['s4_task_manager', 'notion'],
    ['s4_management_method', 'okr'],
    ['s5_marketing_budget_pct', 7],
    ['s5_marketing_channels', ['seo', 'social', 'partners']],
    ['s5_target_audience', 'Малый и средний бизнес в СНГ, ищущий AI-инструменты для роста'],
    ['s5_has_competitor_analysis', true],
    ['s5_usp', 'Полная AI-диагностика бизнеса за 24 часа с привязкой к 122 метрикам'],
    ['s6_goal_3years', 'Стать топ-3 платформой бизнес-диагностики в СНГ с 5k активных клиентов'],
    ['s6_goal_12months', 'Достичь $2M ARR с 200 активными клиентами'],
    ['s6_main_pain', 'Не хватает structured данных от клиентов для точной диагностики'],
    ['s6_growth_blockers', ['data_quality', 'sales_capacity']],
  ]

  let survInserted = 0
  for (const [key, value] of seed) {
    const step = parseInt(key.match(/s(\d+)/)?.[1] ?? '0', 10)
    const { error } = await sb
      .from('survey_answers')
      .upsert(
        {
          user_id: user.id,
          company_id: companyId,
          step,
          question_key: key,
          answer: { value },
          answered_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,question_key' },
      )
    if (error) {
      console.warn(`  ⚠ survey ${key} skip:`, error.message)
    } else {
      survInserted++
    }
  }
  console.log(`  ✓ seeded ${survInserted}/${seed.length} survey answers`)

  console.log('')
  console.log('═══════════════════════════════════════════════════')
  console.log(' ✓ Test account ready')
  console.log('───────────────────────────────────────────────────')
  console.log(`   URL:       http://localhost:3000/login`)
  console.log(`   Email:     ${email}`)
  console.log(`   Password:  ${password}`)
  console.log(`   Role:      ${role}`)
  console.log(`   User ID:   ${user.id}`)
  console.log(`   Company:   ${companyId}`)
  console.log('═══════════════════════════════════════════════════')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
