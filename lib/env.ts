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
 * Literal that `vercel env pull` writes for variables marked "Sensitive" in the
 * Vercel dashboard — the real value is never downloaded. It is non-empty, so a
 * plain emptiness check accepts it as a valid key and the app boots, then fails
 * much later at request time with an opaque error from Supabase/Prisma. Treat
 * it as "not configured" so `getMissingServerEnv()` reports it honestly.
 */
export const SENSITIVE_ENV_PLACEHOLDER = '[SENSITIVE]'

/**
 * True when a raw env value carries no usable secret: absent, blank, or the
 * `[SENSITIVE]` placeholder. Surrounding quotes are stripped first because not
 * every env loader unquotes values (the placeholder is commonly written as
 * `KEY="[SENSITIVE]"`).
 */
function isUnusableEnvValue(value: string | undefined): boolean {
  if (value === undefined) return true
  const trimmed = value.trim()
  if (trimmed === '') return true

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed

  return unquoted === '' || unquoted.toUpperCase() === SENSITIVE_ENV_PLACEHOLDER
}

/**
 * Named error thrown when one or more critical env vars are missing.
 * The `missing` field lists exactly which vars were absent, empty, or still set
 * to the `[SENSITIVE]` placeholder.
 */
export class MissingServerEnvError extends Error {
  readonly name = 'MissingServerEnvError'
  readonly missing: CriticalServerEnvVar[]

  constructor(missing: CriticalServerEnvVar[]) {
    super(
      `Missing required server environment variable(s): ${missing.join(', ')}. ` +
        'See .env.example for the full list and set these in your environment. ' +
        `A variable literally set to "${SENSITIVE_ENV_PLACEHOLDER}" counts as missing: ` +
        '`vercel env pull` writes that placeholder for Sensitive variables instead of ' +
        'the real value — copy the value from the Vercel dashboard manually.',
    )
    this.missing = missing
  }
}

/**
 * Return the list of critical env vars that are missing, empty, or still set to
 * the `[SENSITIVE]` placeholder written by `vercel env pull`.
 * Pure — never throws — useful for health checks and diagnostics.
 */
export function getMissingServerEnv(): CriticalServerEnvVar[] {
  return CRITICAL_SERVER_ENV_VARS.filter((key) => isUnusableEnvValue(process.env[key]))
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
