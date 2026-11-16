/**
 * Server-side environment validation.
 *
 * This module is SAFE TO IMPORT anywhere — importing it does not read or assert
 * anything. Validation only runs when you explicitly call `assertServerEnv()`.
 *
 * Call it from a non-prerendered server location (e.g. the top of a Route
 * Handler / Server Action that already runs at request time) when you want to
 * fail fast on misconfiguration. Do NOT call it at module top-level in code that
 * participates in static prerendering — that would crash `next build`.
 */
import { isPersistentServer } from '@/lib/runtime/platform'
import { agentsServiceUrl, portalRole } from '@/lib/runtime/role'

/** Environment variables that MUST be present for the server to function. */
export const CRITICAL_SERVER_ENV_VARS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

export type CriticalServerEnvVar = (typeof CRITICAL_SERVER_ENV_VARS)[number]

/**
 * Named error thrown when one or more critical env vars are missing.
 * The `missing` field lists exactly which vars were absent or empty.
 */
export class MissingServerEnvError extends Error {
  readonly name = 'MissingServerEnvError'
  readonly missing: CriticalServerEnvVar[]

  constructor(missing: CriticalServerEnvVar[]) {
    super(
      `Missing required server environment variable(s): ${missing.join(', ')}. ` +
        'See .env.example for the full list and set these in your environment.',
    )
    this.missing = missing
  }
}

/**
 * Return the list of critical env vars that are missing or empty.
 * Pure — never throws — useful for health checks and diagnostics.
 */
export function getMissingServerEnv(): CriticalServerEnvVar[] {
  return CRITICAL_SERVER_ENV_VARS.filter((key) => {
    const value = process.env[key]
    return value === undefined || value.trim() === ''
  })
}

/**
 * Throw a {@link MissingServerEnvError} if any critical env var is missing.
 * Idempotent and side-effect free aside from throwing.
 */
export function assertServerEnv(): void {
  const missing = getMissingServerEnv()
  if (missing.length > 0) {
    throw new MissingServerEnvError(missing)
  }
}

// ─── R-061: the variables that tie the persistent services together ─────────

type Env = Partial<NodeJS.ProcessEnv>

/** Any of these signs the internal tokens (lib/internal-auth.ts, the same order). */
const INTERNAL_TOKEN_SECRETS = ['INTERNAL_TOKEN_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET', 'GIGA_COOKIE_SECRET'] as const

/**
 * Names (never values) of the variables this persistent process needs to talk to the other
 * services, by its role (PORTAL_ROLE). Without them the failure shows only at the first call: a kick
 * of the agents service refused, an internal fan-out that never verifies, an event our Inngest
 * rejects. Checked once at boot (lib/runtime/server-start.ts, an error line) and by the readiness
 * check (lib/health/platform.ts, counted with the critical variables).
 *   every role          CRON_SECRET when the in-process cron runs or the role is split (the kick
 *                       is signed with it); a secret for internal tokens;
 *   web                 AGENTS_SERVICE_URL (where queued agent tasks are handed over);
 *   web / all           INNGEST_SELF_EVENT_KEY and INNGEST_SELF_SIGNING_KEY once INNGEST_SELF_HOSTED_URL is set.
 * Off a persistent server (Vercel, tests, local dev) nothing is required here.
 */
export function missingServiceLinkEnv(env: Env = process.env): string[] {
  if (!isPersistentServer(env)) return []
  const set = (name: string) => Boolean(env[name]?.trim())
  const role = portalRole(env)
  const missing: string[] = []
  if ((env.CRON_RUNNER_ENABLED === '1' || role !== 'all') && !set('CRON_SECRET')) missing.push('CRON_SECRET')
  if (!INTERNAL_TOKEN_SECRETS.some(set)) missing.push('INTERNAL_TOKEN_SECRET')
  if (role === 'web' && !agentsServiceUrl(env)) missing.push('AGENTS_SERVICE_URL')
  if (role !== 'agents' && set('INNGEST_SELF_HOSTED_URL')) {
    if (!set('INNGEST_SELF_EVENT_KEY')) missing.push('INNGEST_SELF_EVENT_KEY')
    if (!set('INNGEST_SELF_SIGNING_KEY')) missing.push('INNGEST_SELF_SIGNING_KEY')
  }
  return missing
}
