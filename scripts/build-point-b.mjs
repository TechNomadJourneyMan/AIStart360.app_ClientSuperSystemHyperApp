/**
 * Sets the company's revenue targets and builds Point B for the demo client.
 *
 * Point B does not read goals from the questionnaire — it reads
 * `companies.target_revenue_12m_kzt` / `target_revenue_3y_kzt`, needs a stored
 * diagnostic (Point A) and a current-revenue metric. This wires those together
 * the same way the UI would, under the client's own session.
 *
 *   node scripts/build-point-b.mjs [baseUrl] [--apply]
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const BASE = (args.find((a) => a.startsWith('http')) ?? 'http://localhost:3101').replace(/\/$/, '')

// Verified from HONOR GROUP's own strategy documents (Strategy/HONOR_Стратегия_2026-2036.docx).
const TARGET_12M_YEAR = 780_000_000
const TARGET_3Y_YEAR = 3_400_000_000

function envValue(key) {
  for (const file of ['.env', '.env.local']) {
    let raw
    try {
      raw = readFileSync(resolve(ROOT, file), 'utf8')
    } catch {
      continue
    }
    const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

const SUPA_URL = envValue('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')
const ANON = envValue('NEXT_PUBLIC_SUPABASE_ANON_KEY')

const signIn = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: envValue('MYHONOR_DEMO_EMAIL'), password: envValue('MYHONOR_DEMO_PASSWORD') }),
}).then((r) => r.json())
if (!signIn.access_token) throw new Error(`sign-in failed: ${JSON.stringify(signIn).slice(0, 200)}`)

const ref = new URL(SUPA_URL).hostname.split('.')[0]
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(
  JSON.stringify({
    access_token: signIn.access_token,
    token_type: signIn.token_type,
    expires_in: signIn.expires_in,
    expires_at: signIn.expires_at,
    refresh_token: signIn.refresh_token,
    user: signIn.user,
  }),
  'utf8',
).toString('base64url')}`

const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { cookie, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

const show = async (label, path, init) => {
  const res = await api(path, init)
  const text = await res.text()
  console.log(`${label}: HTTP ${res.status}`)
  console.log(`  ${text.slice(0, 700).replace(/\s+/g, ' ')}`)
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

console.log(`вошёл как ${signIn.user.email}\n`)

await show('цели ДО      ', '/api/v1/companies/targets')

if (!APPLY) {
  console.log('\nсухой прогон. --apply чтобы записать цели и построить Точку Б.')
  process.exit(0)
}

await show('запись целей ', '/api/v1/companies/targets', {
  method: 'PATCH',
  body: JSON.stringify({
    target_revenue_12m_kzt: TARGET_12M_YEAR,
    target_revenue_3y_kzt: TARGET_3Y_YEAR,
  }),
})

await show('Точка Б      ', '/api/v1/diagnostics/point-b')
await show('генерация ИИ ', '/api/v1/diagnostics/point-b/ai-generate', { method: 'POST', body: '{}' })
await show('Точка Б после', '/api/v1/diagnostics/point-b')
