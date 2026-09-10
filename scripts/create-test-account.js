// Create (or refresh) a QA test account for local testing of the survey / Point A.
//
//   node scripts/create-test-account.js                       # qa-survey@aistart360.local, role=client, empty survey
//   node scripts/create-test-account.js --reset               # same account, wipe its survey answers → test the анкета from zero
//   node scripts/create-test-account.js me@x.kz --role expert # other email / role
//   node scripts/create-test-account.js --seed                # also seed demo answers + company (Point A dev)
//
// SECURITY: the password is ALWAYS randomly generated unless you pass
// --password explicitly, and it is printed only to your terminal. Never commit
// a default password: this repo is public and the script targets the database
// configured in .env.local (currently the production Supabase project).
// An earlier version defaulted to role=admin + a hard-coded password.
//
// - Creates auth.users via the Supabase admin API (auto-confirmed).
// - Marks user_metadata.qa_test = true (lets cleanup tooling find QA users).
// - Upserts public.profiles with status='approved' and the requested role.
// - Idempotent: re-running for the same email rotates the password.

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')
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

function parseArgs(argv) {
  const out = { positional: [], role: null, password: null, reset: false, seed: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--role') out.role = argv[++i]
    else if (a === '--password') out.password = argv[++i]
    else if (a === '--reset') out.reset = true
    else if (a === '--seed') out.seed = true
    else if (a === '--force') out.force = true
    else if (a === '-h' || a === '--help') out.help = true
    else out.positional.push(a)
  }
  return out
}

function randomPassword(len = 18) {
  const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
  const nums = '23456789'
  const sym = '!@#%*-_'
  const all = alpha + nums + sym
  const bytes = crypto.randomBytes(len)
  let out = alpha[bytes[0] % alpha.length] + nums[bytes[1] % nums.length] + sym[bytes[2] % sym.length]
  for (let i = 3; i < len; i++) out += all[bytes[i] % all.length]
  return out
}

async function findUserByEmail(sb, email) {
  // listUsers is paginated; the old version only looked at the first 200 users.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

const ROLES = ['client', 'expert', 'owner', 'admin', 'super_admin']

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('usage: node scripts/create-test-account.js [email] [--role client|expert|owner|admin] [--password P] [--reset] [--seed]')
    return
  }

  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))
  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPA_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  // Backwards-compatible positionals: email [password] [role]
  const email = (args.positional[0] || 'qa-survey@aistart360.local').trim()
  const role = args.role || args.positional[2] || 'client'
  const password = args.password || args.positional[1] || randomPassword()
  if (!ROLES.includes(role)) {
    console.error(`Unknown role "${role}". Allowed: ${ROLES.join(', ')}`)
    process.exit(1)
  }
  if (role !== 'client') {
    console.warn(`⚠ creating a STAFF account (role=${role}) in ${new URL(SUPA_URL).host}. Delete it when you are done.`)
  }
  const fullName = 'QA · тест анкеты'

  const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  console.log(`→ ${email} (role=${role}) on ${new URL(SUPA_URL).host}`)

  let user = await findUserByEmail(sb, email)
  const metadata = { full_name: fullName, role, qa_test: true }
  if (user && user.user_metadata?.qa_test !== true && !args.force) {
    // Never rotate the password of (or wipe answers for) a real person's account.
    console.error(`✗ ${email} already exists and is NOT a QA account. Refusing to touch it (pass --force only if you are sure).`)
    process.exit(1)
  }
  if (user) {
    const { data, error } = await sb.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: metadata })
    if (error) throw new Error(`updateUser failed: ${error.message}`)
    user = data.user
    console.log(`  ↻ existing user, password rotated (${user.id})`)
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata })
    if (error) throw new Error(`createUser failed: ${error.message}`)
    user = data.user
    console.log(`  ✓ new user created (${user.id})`)
  }

  const { error: profileErr } = await sb.from('profiles').upsert(
    { id: user.id, email, full_name: fullName, role, status: 'approved', approved_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (profileErr) throw new Error(`profile upsert failed: ${profileErr.message}`)
  console.log(`  ✓ profile status=approved role=${role}`)

  if (args.reset) {
    const { error: delErr, count } = await sb
      .from('survey_answers')
      .delete({ count: 'exact' })
      .eq('user_id', user.id)
    if (delErr) throw new Error(`survey reset failed: ${delErr.message}`)
    console.log(`  ✓ survey reset: ${count ?? 0} answers removed (the анкета starts from step 1)`)
    console.log('    Tip: also clear localStorage in the browser (key aistart360_onboarding*) or use a private window.')
  }

  let companyId = null
  if (args.seed) {
    companyId = `test-co-${user.id.slice(0, 8)}`
    const { error: companyErr } = await sb.from('companies').upsert(
      { id: companyId, user_id: user.id, name: 'AIStart360 Test Company', industry: 'b2b_saas', stage: 'Growth', business_model: 'B2B' },
      { onConflict: 'id' },
    )
    if (companyErr) console.warn('  ⚠ company upsert warning (non-fatal):', companyErr.message)
    const seed = [
      ['s1_company_name', 'AIStart360 Test Company', 1],
      ['s1_industry', 'b2b_saas', 1],
      ['s1_current_revenue_year', 84200000, 1],
      ['s1_goal_12m_revenue_year', 120000000, 1],
      ['s2n_goal_12m_what', 'Достичь 120 млн ₸ выручки и 200 активных клиентов', 2],
      ['s6_main_pain', 'Не хватает структурированных данных от клиентов', 2],
    ]
    let n = 0
    for (const [key, value, step] of seed) {
      const { error } = await sb.from('survey_answers').upsert(
        { user_id: user.id, company_id: companyId, step, question_key: key, answer: { value }, answered_at: new Date().toISOString() },
        { onConflict: 'user_id,question_key' },
      )
      if (error) console.warn(`  ⚠ survey ${key} skip:`, error.message)
      else n++
    }
    console.log(`  ✓ seeded ${n}/${seed.length} survey answers`)
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════')
  console.log(' ✓ QA account ready')
  console.log('───────────────────────────────────────────────────')
  console.log('   URL:       http://localhost:3000/login')
  console.log(`   Email:     ${email}`)
  console.log(`   Password:  ${password}`)
  console.log(`   Role:      ${role}`)
  console.log(`   User ID:   ${user.id}`)
  if (companyId) console.log(`   Company:   ${companyId}`)
  console.log('═══════════════════════════════════════════════════')
}

main().catch((e) => {
  console.error('✗', e.message || e)
  process.exit(1)
})
