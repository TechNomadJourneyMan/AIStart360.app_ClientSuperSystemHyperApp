// Idempotently provisions the isolated HONOR / MyHonor Store tenant.
//
// Dry-run is the default. Production mutation additionally requires:
//   --apply
//   STORE_ACCOUNT_CONFIRM="PROVISION_STORE_ACCOUNT:<exact login email>"
//
// Required runtime credentials:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   STORE_ACCOUNT_EMAIL (legacy fallback: MYHONOR_DEMO_EMAIL)
//   STORE_ACCOUNT_PASSWORD only when creating a user or using --rotate-password
//
// The password is never printed or included in the returned result.

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const STORE_DISPLAY_NAME = 'Интернет-магазин HONOR / MyHonor'
const STORE_ROLE = 'client'
const STORE_STATUS = 'approved'
const STORE_VERTICAL = 'ecommerce'
const APPLY_CONFIRM_PREFIX = 'PROVISION_STORE_ACCOUNT:'

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value.replace(/\\n$/g, '')
    }
  }
}

function normalizedEnv(name) {
  return process.env[name]?.replace(/\\n$/g, '').trim() || ''
}

function required(name) {
  const value = normalizedEnv(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function parseArgs(argv) {
  const known = new Set(['--apply', '--rotate-password'])
  const unknown = argv.filter((arg) => !known.has(arg))
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`)
  return {
    apply: argv.includes('--apply'),
    rotatePassword: argv.includes('--rotate-password'),
  }
}

function accountMetadata(existing = {}) {
  return {
    ...existing,
    full_name: STORE_DISPLAY_NAME,
    organization: STORE_DISPLAY_NAME,
    vertical: STORE_VERTICAL,
    store_account: true,
  }
}

function accountAppMetadata(existing = {}) {
  return {
    ...existing,
    role: STORE_ROLE,
    status: STORE_STATUS,
  }
}

async function findUserByEmail(client, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error('Unable to inspect Auth users')
    const users = data?.users ?? []
    const user = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase())
    if (user) return user
    if (users.length < 100) return null
  }
  throw new Error('Auth user lookup exceeded the supported account limit')
}

async function readOwnedCompanies(client, userId) {
  const { data, error } = await client
    .from('companies')
    .select('id, user_id, name')
    .eq('user_id', userId)
    .limit(2)
  if (error) throw new Error('Unable to inspect Store company ownership')
  return data ?? []
}

async function readProfile(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('id, role, status, vertical, full_name, organization')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error('Unable to inspect Store profile')
  return data
}

function assertSingleCompany(companies) {
  if (companies.length > 1) {
    throw new Error('Refusing Store provisioning: the account owns more than one company')
  }
}

function accountPlan({ existingUser, existingProfile, companies }) {
  return {
    outcome: existingUser ? 'update_existing' : 'create_new',
    displayName: STORE_DISPLAY_NAME,
    role: STORE_ROLE,
    status: STORE_STATUS,
    vertical: STORE_VERTICAL,
    existingCompanyCount: companies.length,
    profileNeedsUpdate: !existingProfile
      || existingProfile.full_name !== STORE_DISPLAY_NAME
      || existingProfile.organization !== STORE_DISPLAY_NAME
      || existingProfile.role !== STORE_ROLE
      || existingProfile.status !== STORE_STATUS
      || existingProfile.vertical !== STORE_VERTICAL,
    companyNeedsUpdate: companies.length !== 1 || companies[0]?.name !== STORE_DISPLAY_NAME,
  }
}

async function writeProfile(client, userId, email, now) {
  const { error } = await client.from('profiles').upsert({
    id: userId,
    email,
    full_name: STORE_DISPLAY_NAME,
    organization: STORE_DISPLAY_NAME,
    role: STORE_ROLE,
    status: STORE_STATUS,
    vertical: STORE_VERTICAL,
    approved_at: now,
  }, { onConflict: 'id' })
  if (error) throw new Error('Unable to write Store profile')
}

async function writeCompany(client, userId, companies) {
  const values = {
    user_id: userId,
    name: STORE_DISPLAY_NAME,
    industry: 'Ритейл / E-commerce',
    business_model: 'Собственное производство + D2C + офлайн-розница + B2B',
  }

  if (companies[0]?.id) {
    const { data, error } = await client
      .from('companies')
      .update(values)
      .eq('id', companies[0].id)
      .eq('user_id', userId)
      .select('id')
      .single()
    if (error || !data?.id) throw new Error('Unable to update Store company')
    return data.id
  }

  const { data, error } = await client
    .from('companies')
    // Let the reconciled production schema generate TEXT UUIDs and clean
    // installs generate native UUIDs. Provisioning must not guess the id type.
    .insert(values)
    .select('id')
    .single()
  if (error || !data?.id) throw new Error('Unable to create Store company')
  return data.id
}

async function verifyAccount(client, userId, companyId) {
  const [profile, companies] = await Promise.all([
    readProfile(client, userId),
    readOwnedCompanies(client, userId),
  ])
  if (
    !profile
    || profile.role !== STORE_ROLE
    || profile.status !== STORE_STATUS
    || profile.vertical !== STORE_VERTICAL
    || profile.full_name !== STORE_DISPLAY_NAME
    || profile.organization !== STORE_DISPLAY_NAME
  ) {
    throw new Error('Store profile verification failed')
  }
  if (companies.length !== 1 || companies[0].id !== companyId || companies[0].user_id !== userId) {
    throw new Error('Store company ownership verification failed')
  }
}

async function provisionStoreAccount(client, input) {
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes('@')) throw new Error('A valid Store login email is required')

  let user = await findUserByEmail(client, email)
  const companies = user ? await readOwnedCompanies(client, user.id) : []
  const existingProfile = user ? await readProfile(client, user.id) : null
  assertSingleCompany(companies)

  const plan = accountPlan({ existingUser: user, existingProfile, companies })
  if (!input.apply) return { ...plan, applied: false }

  if (input.confirmation !== `${APPLY_CONFIRM_PREFIX}${email}`) {
    throw new Error('STORE_ACCOUNT_CONFIRM does not match the target Store login')
  }

  const needsPassword = !user || input.rotatePassword
  if (needsPassword && (!input.password || input.password.length < 12)) {
    throw new Error('STORE_ACCOUNT_PASSWORD must contain at least 12 characters')
  }

  let createdUser = false
  if (!user) {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      app_metadata: accountAppMetadata(),
      user_metadata: accountMetadata(),
    })
    if (error || !data?.user) throw new Error('Unable to create Store Auth user')
    user = data.user
    createdUser = true
  } else {
    const changes = {
      email_confirm: true,
      app_metadata: accountAppMetadata(user.app_metadata),
      user_metadata: accountMetadata(user.user_metadata),
    }
    if (input.rotatePassword) changes.password = input.password
    const { data, error } = await client.auth.admin.updateUserById(user.id, changes)
    if (error || !data?.user) throw new Error('Unable to update Store Auth user')
    user = data.user
  }

  try {
    const now = input.now ?? new Date().toISOString()
    await writeProfile(client, user.id, email, now)
    const companyId = await writeCompany(client, user.id, companies)
    await verifyAccount(client, user.id, companyId)
    return {
      outcome: createdUser ? 'created' : 'updated',
      applied: true,
      userId: user.id,
      companyId,
      displayName: STORE_DISPLAY_NAME,
      role: STORE_ROLE,
      status: STORE_STATUS,
      loginPath: '/login?from=/store',
    }
  } catch (error) {
    if (createdUser) {
      const cleanup = await client.auth.admin.deleteUser(user.id)
      if (cleanup.error) {
        throw new Error('Store provisioning failed and Auth compensation also failed')
      }
    }
    throw error
  }
}

function resolveRuntimeInput(args) {
  const email = normalizedEnv('STORE_ACCOUNT_EMAIL') || normalizedEnv('MYHONOR_DEMO_EMAIL')
  const password = normalizedEnv('STORE_ACCOUNT_PASSWORD') || normalizedEnv('MYHONOR_DEMO_PASSWORD')
  return {
    email,
    password: password || undefined,
    confirmation: normalizedEnv('STORE_ACCOUNT_CONFIRM'),
    apply: args.apply,
    rotatePassword: args.rotatePassword,
  }
}

async function main(argv = process.argv.slice(2)) {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))
  const args = parseArgs(argv)
  const input = resolveRuntimeInput(args)
  if (!input.email) throw new Error('Missing STORE_ACCOUNT_EMAIL (or MYHONOR_DEMO_EMAIL)')

  const client = createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const result = await provisionStoreAccount(client, input)
  console.log(JSON.stringify(result, null, 2))
  if (!args.apply) {
    console.log('Dry-run only. Re-run with --apply and an exact STORE_ACCOUNT_CONFIRM value.')
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Store provisioning failed')
    process.exitCode = 1
  })
}

module.exports = {
  APPLY_CONFIRM_PREFIX,
  STORE_DISPLAY_NAME,
  accountAppMetadata,
  accountMetadata,
  accountPlan,
  findUserByEmail,
  parseArgs,
  provisionStoreAccount,
  resolveRuntimeInput,
  main,
}
