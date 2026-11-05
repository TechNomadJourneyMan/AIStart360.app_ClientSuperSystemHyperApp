/**
 * Gate for integration tests that write to a Supabase project.
 *
 * .env.local's Supabase is PRODUCTION — suites that create users, companies
 * and answers must never reach it (2026-11-02: a run left test accounts in
 * prod). They run only against a disposable project given explicitly:
 *
 *   TEST_SUPABASE_URL=https://<test-ref>.supabase.co \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=... npm test
 *
 * and refuse a URL that is the app's own (env or .env.local).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface SupabaseTestEnv {
  url: string
  serviceRoleKey: string
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

/** The disposable test project, or null (the suites skip). Never the app's project. */
export function resolveSupabaseTestEnv(
  env: Record<string, string | undefined>,
  appUrls: ReadonlyArray<string | undefined>,
): SupabaseTestEnv | null {
  const url = env.TEST_SUPABASE_URL?.trim()
  const serviceRoleKey = env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) return null
  const own = appUrls.filter((u): u is string => Boolean(u)).map(normalizeUrl)
  if (own.includes(normalizeUrl(url))) {
    throw new Error("TEST_SUPABASE_URL is the app's own Supabase project — integration tests never write to it")
  }
  return { url, serviceRoleKey }
}

/** NEXT_PUBLIC_SUPABASE_URL of .env.local, read only to compare against. */
function envLocalSupabaseUrl(): string | undefined {
  const file = resolve(__dirname, '../../.env.local')
  if (!existsSync(file)) return undefined
  const m = readFileSync(file, 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^"'\r\n]+)/m)
  return m?.[1]
}

export const supabaseTestEnv: SupabaseTestEnv | null = resolveSupabaseTestEnv(process.env, [
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_URL,
  envLocalSupabaseUrl(),
])
