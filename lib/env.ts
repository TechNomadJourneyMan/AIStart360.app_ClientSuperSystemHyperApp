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
