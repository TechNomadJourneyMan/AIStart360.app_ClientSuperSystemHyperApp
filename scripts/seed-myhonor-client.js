// Creates or refreshes an approved HONOR GROUP demo client from public facts.
// Private KPIs are intentionally absent. The resulting /dashboard therefore
// shows honest missing-data states until an authorized operator adds them.
//
// Required:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   MYHONOR_DEMO_EMAIL
//   MYHONOR_DEMO_PASSWORD

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')
const profile = require('../lib/demo/myhonor-public-profile.json')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

function required(name) {
  const value = process.env[name]?.replace(/\\n$/g, '').trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function findUserByEmail(client, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const user = data.users.find((candidate) => candidate.email === email)
    if (user) return user
    if (data.users.length < 100) return null
  }
  throw new Error('User lookup exceeded 1000 accounts; use a dedicated demo project')
}

async function ensureUser(client, email, password) {
  const existing = await findUserByEmail(client, email)
  const metadata = {
    full_name: `${profile.companyName} · demo client`,
    organization: profile.companyName,
    role: 'client',
    status: 'approved',
    vertical: 'ecommerce',
    demo_source: profile.website,
  }

  if (existing) {
    const { data, error } = await client.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: metadata,
    })
    if (error) throw error
    return data.user
  }

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (error) throw error
  return data.user
}

async function ensureCompany(client, userId) {
  const { data: existing, error: lookupError } = await client
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (lookupError) throw lookupError

  const values = {
    user_id: userId,
    name: profile.companyName,
    industry: 'Ритейл / E-commerce',
    business_model: 'Собственное производство + D2C + офлайн-розница + B2B',
  }

  if (existing?.id) {
    const { error } = await client.from('companies').update(values).eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const id = `myhonor-${userId.slice(0, 8)}`
  const { error } = await client.from('companies').insert({ id, ...values })
  if (error) throw error
  return id
}

async function main() {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))

  const url = required('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
  const email = required('MYHONOR_DEMO_EMAIL')
  const password = required('MYHONOR_DEMO_PASSWORD')

  if (password.length < 12) {
    throw new Error('MYHONOR_DEMO_PASSWORD must contain at least 12 characters')
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const user = await ensureUser(client, email, password)
  if (!user) throw new Error('Supabase did not return a user')

  const { error: profileError } = await client.from('profiles').upsert({
    id: user.id,
    email,
    full_name: `${profile.companyName} · demo client`,
    organization: profile.companyName,
    role: 'client',
    status: 'approved',
    vertical: 'ecommerce',
    approved_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (profileError) throw profileError

  const companyId = await ensureCompany(client, user.id)
  for (const item of profile.surveyAnswers) {
    const { error } = await client.from('survey_answers').upsert({
      user_id: user.id,
      company_id: companyId,
      step: item.step,
      question_key: item.key,
      answer: {
        value: item.value,
        provenance: 'public_web',
        source: profile.website,
        verified_at: profile.verifiedAt,
      },
      answered_at: new Date().toISOString(),
    }, { onConflict: 'user_id,question_key' })
    if (error) throw new Error(`survey ${item.key}: ${error.message}`)
  }

  console.log('HONOR GROUP demo client is ready')
  console.log(`Login: ${email}`)
  console.log('Dashboard: /dashboard')
  console.log('Journey: /journey?demo=myhonor')
  console.log(`Public facts: ${profile.surveyAnswers.length}; private KPIs: 0`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
