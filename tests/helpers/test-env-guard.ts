/**
 * Hermetic environment for the vitest process (R-010).
 *
 * The test process must never be able to reach a real service: no real AI
 * keys (OpenRouter/Alem burn budget), no Resend key (real e-mails), no
 * Telegram/Google tokens, no cloud database or Supabase URL (the reserve DB
 * holds a full copy of production data).
 *
 *  - `.env*` files are NOT loaded into the test process any more.
 *  - Whatever arrives from the shell / CI is scrubbed here: secret-looking
 *    variables and external-service prefixes are removed, URLs that point to
 *    a non-local host are removed, and the few variables the code needs to be
 *    *present* get fixed dummy values (the same ones scratchpad vt.sh used).
 *  - DATABASE_URL / DIRECT_URL always point at the local disposable test DB
 *    (TEST_DATABASE_URL) or at a dead local stub — never at .env's database.
 *  - TEST_DATABASE_URL / TEST_DB_ADMIN_URL on a non-local host is a hard error.
 *
 * Variables that start with TEST_ are the explicit opt-ins of the test
 * harness and are left alone (they are validated instead).
 */

/** Hosts a test may talk to. `''` = unix socket (libpq default). */
export function isLocalHost(host: string | null | undefined): boolean {
  if (host == null) return false
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
  if (h === '') return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::ffff:127.0.0.1') return true
  if (/^127(\.\d{1,3}){3}$/.test(h)) return true
  return false
}

/** Host of a URL-ish string (`postgres://`, `http://`, …), or null when it is not a URL. */
export function urlHost(value: string): string | null {
  const v = value.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return null
  try {
    return new URL(v).hostname
  } catch {
    // libpq-style URLs with odd characters: take what is between '@' / '//' and ':' / '/'.
    const m = v.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^:/?#]*)/i)
    return m ? m[1] : null
  }
}

export function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false
  const host = urlHost(value)
  return host !== null && isLocalHost(host)
}

/** Dead local Postgres: Prisma can be constructed, any query fails fast. */
export const TEST_DB_STUB_URL = 'postgresql://test-db-not-configured@127.0.0.1:1/test_db_not_configured'

/** Present-but-fake values the app code needs to boot (same as scratchpad vt.sh). */
export const TEST_ENV_DUMMIES: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x',
  SUPABASE_SERVICE_ROLE_KEY: 'x',
  GIGA_ADMIN_PASSWORD: 'x',
  NEXT_TELEMETRY_DISABLED: '1',
}

/** Name suffixes that mean "credential". */
const SECRET_NAME = /(_KEY|_SECRET|_TOKEN|_PASSWORD|_PASSWORD_HASH|_API_HASH|_SESSION|_CREDENTIALS?|_DSN|_PAT)$/

/** External services whose every variable is dropped (ids, chat ids, usernames, webhooks…). */
const SERVICE_PREFIX =
  /^(OPENROUTER|RESEND|ALEM|TELEGRAM|GOOGLE|AUTH_GOOGLE|ANTHROPIC|OPENAI|EXA|FIRECRAWL|LANGFUSE|UPSTASH|VERCEL|RAILWAY|INNGEST|SENTRY|KASPI|META|INSTAGRAM|WHATSAPP|STRIPE|TWILIO)_/

/** Explicit extras (opt-ins that would make a test really send something). */
const ALWAYS_DROP = new Set(['EMAIL_ALLOW_SEND_IN_TESTS', 'SUPABASE_URL', 'SUPABASE_INTERNAL_URL'])

export class TestEnvRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TestEnvRefusal'
  }
}

/** Throws unless `name` is unset or a local URL. */
export function assertLocalTestDbUrl(name: string, value: string | undefined): void {
  if (!value) return
  if (!isLocalUrl(value)) {
    const host = urlHost(value) ?? '<not a URL>'
    throw new TestEnvRefusal(
      `${name} указывает на нелокальный хост «${host}». Тесты работают только с одноразовой ` +
        `локальной БД (127.0.0.1 / localhost / ::1) — облачные базы содержат данные прода.`,
    )
  }
}

export interface SanitizeResult {
  /** Names of removed variables (values are never reported). */
  removed: string[]
  /** Names that were forced to a dummy value. */
  dummied: string[]
  /** Non-secret app URLs that were in the env before scrubbing (for "is this the app project?" checks). */
  appSupabaseUrls: string[]
}

function shouldDrop(name: string, value: string): boolean {
  if (name.startsWith('TEST_')) return false
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return false // npm_config_*, lower-case system vars
  if (name in TEST_ENV_DUMMIES) return false
  if (name === 'DATABASE_URL' || name === 'DIRECT_URL') return false // re-pointed explicitly
  if (ALWAYS_DROP.has(name)) return true
  if (SERVICE_PREFIX.test(name)) return true
  if (SECRET_NAME.test(name)) return true
  const host = urlHost(value)
  if (host !== null && !isLocalHost(host)) return true
  return false
}

/** Mutates `env` into the hermetic test environment. */
export function sanitizeTestEnv(env: Record<string, string | undefined>): SanitizeResult {
  assertLocalTestDbUrl('TEST_DATABASE_URL', env.TEST_DATABASE_URL)
  assertLocalTestDbUrl('TEST_DB_ADMIN_URL', env.TEST_DB_ADMIN_URL)

  const appSupabaseUrls = [env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_URL].filter(
    (u): u is string => Boolean(u) && u !== TEST_ENV_DUMMIES.NEXT_PUBLIC_SUPABASE_URL,
  )

  const removed: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (shouldDrop(name, value)) {
      delete env[name]
      removed.push(name)
    }
  }

  const dummied: string[] = []
  for (const [name, value] of Object.entries(TEST_ENV_DUMMIES)) {
    if (env[name] !== value) dummied.push(name)
    env[name] = value
  }

  const dbUrl = env.TEST_DATABASE_URL || TEST_DB_STUB_URL
  env.DATABASE_URL = dbUrl
  env.DIRECT_URL = dbUrl

  return { removed: removed.sort(), dummied, appSupabaseUrls }
}

const APP_URLS = Symbol.for('aistart360.test.appSupabaseUrls')

/** Remembers the app's (pre-scrub) Supabase URLs across setup runs in one process. */
export function rememberAppSupabaseUrls(urls: string[]): void {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>
  const set = (g[APP_URLS] ??= new Set<string>())
  for (const u of urls) set.add(u)
}

export function rememberedAppSupabaseUrls(): string[] {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>
  return [...(g[APP_URLS] ?? [])]
}
