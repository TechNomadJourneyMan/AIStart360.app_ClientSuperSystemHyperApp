// Seed a diagnostic for the test client account so /client/point-a renders.
// Uses the existing recalculate logic inline (no Next.js route needed).

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

  const email = process.argv[2] || 'client@aistart360.local'

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // 1. Find user
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 })
  const user = list.users.find((u) => u.email === email)
  if (!user) {
    console.error(`User ${email} not found. Run create-test-account.js first.`)
    process.exit(1)
  }
  console.log(`→ seeding diagnostic for ${email} (${user.id})`)

  // 2. Load survey answers
  const { data: rows } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', user.id)

  const answers = {}
  for (const row of rows ?? []) {
    answers[row.question_key] = row.answer?.value ?? row.answer
  }
  console.log(`  loaded ${Object.keys(answers).length} survey answers`)

  // 3. Load company
  const { data: company } = await sb
    .from('companies')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  // 4. Compile + run the existing Point A engine via tsx
  //    Simpler: replicate the math inline. The engine is pure rule-based,
  //    so we hard-code the weights and let upserts handle the rest.
  //    But the cleanest path is to require() the compiled engine. Since
  //    lib/point-a-engine.ts is TS, we use a child process to evaluate it.
  const { spawnSync } = require('child_process')
  const evalCode = `
    process.env.NEXT_PUBLIC_SUPABASE_URL = ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL)};
    process.env.SUPABASE_SERVICE_ROLE_KEY = ${JSON.stringify(process.env.SUPABASE_SERVICE_ROLE_KEY)};
    const { calculatePointA } = require(${JSON.stringify(path.resolve(__dirname, '..', 'lib/point-a-engine.ts'))});
    const answers = ${JSON.stringify(answers)};
    const result = calculatePointA(answers);
    console.log(JSON.stringify(result));
  `
  const proc = spawnSync('npx', ['-y', 'tsx', '-e', evalCode], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  })
  if (proc.status !== 0) {
    console.error('tsx eval failed')
    process.exit(1)
  }
  const stdout = proc.stdout.trim().split('\n').pop()
  const pa = JSON.parse(stdout)
  console.log(`  Point A computed: overall=${pa.overall_score} stage=${pa.stage}`)

  // 5. Mark any existing current=true diagnostics as not current
  await sb
    .from('diagnostics')
    .update({ is_current: false })
    .eq('user_id', user.id)
    .eq('is_current', true)

  // 6. Determine next version
  const { data: prev } = await sb
    .from('diagnostics')
    .select('version')
    .eq('user_id', user.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = ((prev?.version ?? 0) + 1)

  // 7. Insert fresh diagnostic
  const { data: diag, error: diagErr } = await sb
    .from('diagnostics')
    .insert({
      user_id: user.id,
      company_id: company?.id ?? null,
      version: nextVersion,
      overall_score: pa.overall_score,
      health_index: pa.health_index,
      stage: pa.stage,
      finance_score: pa.blocks.finance,
      sales_score: pa.blocks.sales,
      operations_score: pa.blocks.operations,
      marketing_score: pa.blocks.marketing,
      strategy_score: pa.blocks.strategy,
      risks: pa.risks,
      insights: pa.insights,
      quick_wins: pa.quick_wins,
      data_gaps: pa.data_gaps,
      is_current: true,
      calculated_at: new Date().toISOString(),
      ai_status: 'none',
    })
    .select('id')
    .single()

  if (diagErr) {
    console.error('diagnostic insert failed:', diagErr.message)
    process.exit(1)
  }
  console.log(`  ✓ diagnostic created id=${diag.id} version=${nextVersion}`)
  console.log('')
  console.log('Now reload /client/point-a — the empty state should be gone.')
}

main().catch((e) => { console.error(e); process.exit(1) })
