/**
 * Read-only walkthrough of the client user path against a running dev server.
 *
 * Signs in as the demo client using credentials read straight from .env (they
 * never leave this process), builds the @supabase/ssr auth cookie, then follows
 * the path a real client takes and reports what each step actually returns.
 *
 * READ-ONLY: performs no POST/PATCH/DELETE. Nothing is written to the database.
 *
 *   node scripts/check-user-path.mjs [baseUrl]
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.argv[2] ?? 'http://localhost:3101').replace(/\/$/, '')

function readEnv() {
  const out = {}
  for (const file of ['.env', '.env.local']) {
    let raw
    try {
      raw = readFileSync(resolve(ROOT, file), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (out[m[1]] === undefined) out[m[1]] = v
    }
  }
  return out
}

const env = readEnv()
const SUPA_URL = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const EMAIL = env.MYHONOR_DEMO_EMAIL ?? ''
const PASSWORD = env.MYHONOR_DEMO_PASSWORD ?? ''

if (!SUPA_URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / MYHONOR_DEMO_EMAIL / MYHONOR_DEMO_PASSWORD')
  process.exit(1)
}

const projectRef = new URL(SUPA_URL).hostname.split('.')[0]
const COOKIE_NAME = `sb-${projectRef}-auth-token`

async function signIn() {
  const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`sign-in failed: ${JSON.stringify(json).slice(0, 200)}`)
  return json
}

/** @supabase/ssr stores the whole session as a base64url-prefixed JSON cookie. */
function buildCookie(session) {
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  }
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${COOKIE_NAME}=base64-${b64}`
}

async function probe(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  })
  const location = res.headers.get('location')
  let note = ''
  const ctype = res.headers.get('content-type') ?? ''
  if (ctype.includes('application/json')) {
    const text = await res.text()
    note = text.slice(0, 220).replace(/\s+/g, ' ')
  }
  return { path, status: res.status, location, note }
}

function row({ path, status, location, note }) {
  const dest = location ? ` → ${location.replace(BASE, '')}` : ''
  const extra = note ? `\n      ${note}` : ''
  return `  ${String(status).padEnd(4)} ${path}${dest}${extra}`
}

const PAGES = [
  '/client/point-a',
  '/client/onboarding',
  '/client/waiting-room',
  '/client/welcome',
  '/dashboard',
  '/owner/dashboard',
  '/owner/gri/assess',
  '/journey',
]

const APIS = [
  '/api/client/status',
  '/api/v1/diagnostics/current',
  '/api/v1/gri/assessment',
  '/api/v1/onboarding/status',
  '/api/v1/onboarding/survey',
]

const session = await signIn()
const cookie = buildCookie(session)

console.log('=== кто вошёл ===')
console.log(`  email : ${session.user.email}`)
console.log(`  id    : ${session.user.id}`)
console.log(`  role  : ${session.user.user_metadata?.role ?? '—'} (metadata)`)
console.log(`  base  : ${BASE}`)

console.log('\n=== БЕЗ сессии (аноним) ===')
for (const p of PAGES) console.log(row(await probe(p, null)))

console.log('\n=== С сессией демо-клиента ===')
for (const p of PAGES) console.log(row(await probe(p, cookie)))

console.log('\n=== API с сессией ===')
for (const p of APIS) console.log(row(await probe(p, cookie)))
