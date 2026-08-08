/**
 * Fills a demo client's onboarding questionnaire from a file of verified
 * answers, exactly the way the person would from the browser: signs in as the
 * demo client and POSTs to the app's own onboarding endpoint under that
 * session. No service-role key, no RLS bypass.
 *
 * Credentials are read straight from .env and never leave this process.
 *
 *   node scripts/fill-myhonor-survey.mjs [baseUrl] [--file=<path>] [--apply] [--recalc]
 *
 * Without --apply it only prints what it WOULD write (dry run).
 * With --recalc it also fires POST /api/v1/diagnostics/recalculate afterwards
 * and prints the resulting Point A + onboarding status.
 *
 * Accepted shapes for --file (default: lib/demo/myhonor-public-profile.json):
 *   a) { surveyAnswers: [ { step, key, value, source?, confidence? }, ... ] }
 *   b) [ { step, key, value, source?, confidence? }, ... ]
 *   c) { "1": { question_key: value | { value, ... } }, ... }   (step -> answers)
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const RECALC = args.includes('--recalc')
const BASE = (args.find((a) => a.startsWith('http')) ?? 'http://localhost:3101').replace(/\/$/, '')
const fileArg = args.find((a) => a.startsWith('--file='))?.slice('--file='.length)
const PROFILE = fileArg
  ? resolve(process.cwd(), fileArg)
  : process.env.MYHONOR_PROFILE_PATH ?? resolve(ROOT, 'lib/demo/myhonor-public-profile.json')

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

const raw = JSON.parse(readFileSync(PROFILE, 'utf8'))

/** Normalise any accepted shape into a flat [{ step, key, answer }] list. */
function normalise(input) {
  const flat = []
  const list = Array.isArray(input) ? input : Array.isArray(input?.surveyAnswers) ? input.surveyAnswers : null
  if (list) {
    for (const a of list) {
      const key = a.key ?? a.question_key
      if (!key || a.step == null) continue
      const answer = { value: a.value }
      if (a.source != null) answer.source = a.source
      if (a.confidence != null) answer.confidence = a.confidence
      flat.push({ step: Number(a.step), key, answer })
    }
    return flat
  }
  // step -> { key: value | { value } }
  for (const [step, obj] of Object.entries(input ?? {})) {
    if (!/^\d+$/.test(step) || typeof obj !== 'object' || obj === null) continue
    for (const [key, v] of Object.entries(obj)) {
      const answer = v && typeof v === 'object' && 'value' in v ? { ...v } : { value: v }
      flat.push({ step: Number(step), key, answer })
    }
  }
  return flat
}

const flat = normalise(raw)
if (flat.length === 0) {
  console.error(`не нашёл ни одного ответа в ${PROFILE}`)
  process.exit(1)
}

// Group into one request per questionnaire step, shaping each value as
// { value, … } — the same envelope the GET handler unwraps.
const byStep = new Map()
const dupes = []
for (const a of flat) {
  if (!byStep.has(a.step)) byStep.set(a.step, {})
  const bucket = byStep.get(a.step)
  if (bucket[a.key] !== undefined) dupes.push(`${a.step}/${a.key}`)
  bucket[a.key] = a.answer
}
const steps = [...byStep.entries()].sort((a, b) => a[0] - b[0])

console.log(`файл      : ${PROFILE}`)
if (raw?.companyName) console.log(`бренд     : ${raw.companyName}${raw.website ? ` (${raw.website})` : ''}`)
if (raw?.verifiedAt) console.log(`проверено : ${raw.verifiedAt}`)
console.log(`ответов   : ${flat.length} по шагам ${steps.map(([s]) => s).join(', ')}`)
if (dupes.length) console.log(`дубли     : ${dupes.join(', ')}`)
console.log(`сервер    : ${BASE}`)
console.log(`режим     : ${APPLY ? 'ЗАПИСЬ' : 'сухой прогон (добавьте --apply чтобы записать)'}\n`)

for (const [step, obj] of steps) {
  console.log(`  шаг ${step} (${Object.keys(obj).length}): ${Object.keys(obj).join(', ')}`)
}

if (!APPLY) process.exit(0)

const signIn = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json())
if (!signIn.access_token) throw new Error(`sign-in failed: ${JSON.stringify(signIn).slice(0, 200)}`)

const ref = new URL(SUPA_URL).hostname.split('.')[0]
const payload = {
  access_token: signIn.access_token,
  token_type: signIn.token_type,
  expires_in: signIn.expires_in,
  expires_at: signIn.expires_at,
  refresh_token: signIn.refresh_token,
  user: signIn.user,
}
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`
const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { cookie, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

console.log(`\nвошёл как ${signIn.user.email} (${signIn.user.id})`)

const before = await api('/api/v1/onboarding/status').then((r) => r.json()).catch(() => null)
console.log(`анкета ДО : ${JSON.stringify(before?.data?.survey ?? before)}\n`)

let saved = 0
const failures = []
for (const [step, obj] of steps) {
  const res = await api('/api/v1/onboarding/survey', {
    method: 'POST',
    body: JSON.stringify({ step, answers: obj }),
  })
  const json = await res.json().catch(() => ({}))
  const n = Object.keys(obj).length
  if (res.ok && json.ok) saved += json.data?.saved ?? n
  else failures.push({ step, status: res.status, body: json })
  console.log(`  шаг ${step}: отправлено ${n} → HTTP ${res.status} ${JSON.stringify(json)}`)
}
console.log(`\nзаписано ответов: ${saved}, ошибок: ${failures.length}`)

if (RECALC) {
  const res = await api('/api/v1/diagnostics/recalculate', { method: 'POST', body: '{}' })
  const json = await res.json().catch(() => ({}))
  console.log(`\nrecalculate: HTTP ${res.status}`)
  if (json.ok) {
    const d = json.data.diagnostic
    const p = json.data.point_a
    console.log(
      `  diagnostic_id=${d?.id} overall=${d?.overall_score} health=${d?.health_index} stage=${d?.stage} ai=${d?.ai_status}`,
    )
    console.log(`  блоки: ${JSON.stringify(p?.blocks)}`)
    console.log(`  рисков: ${p?.risks?.length ?? 0}, инсайтов: ${p?.insights?.length ?? 0}, quick_wins: ${p?.quick_wins?.length ?? 0}, пробелов: ${p?.data_gaps?.length ?? 0}`)
  } else {
    console.log(`  ${JSON.stringify(json)}`)
  }
}

const after = await api('/api/v1/onboarding/status').then((r) => r.json()).catch(() => null)
console.log(`\nанкета ПОСЛЕ: ${JSON.stringify(after?.data?.survey ?? after)}`)

const survey = await api('/api/v1/onboarding/survey').then((r) => r.json()).catch(() => null)
const stored = Object.keys(survey?.data?.answers ?? {})
console.log(`в базе ключей: ${stored.length}; шаги: ${JSON.stringify(survey?.data?.completed_steps)}`)
const missing = flat.map((a) => a.key).filter((k) => !stored.includes(k))
if (missing.length) console.log(`НЕ сохранилось: ${missing.join(', ')}`)

const current = await api('/api/v1/diagnostics/current').then((r) => r.json()).catch(() => null)
console.log(`\ndiagnostics/current: ${JSON.stringify(current).slice(0, 4000)}`)

if (failures.length) {
  console.log(`\nОШИБКИ:\n${JSON.stringify(failures, null, 2)}`)
  process.exitCode = 1
}
