/**
 * Edge-safe: does the account have a second factor ON RECORD?
 *
 * The JWT flags (lib/mfa/flags.ts) lag behind: a factor added after the access
 * token was issued is not in them until the token is refreshed (≤ 1 h). The
 * server (staffMfaGate, staffApiSecondFactor) and the database
 * (staff_session_ok(), migration 143) already count it — so the pages must
 * too, or a staff member gets empty RLS screens instead of /2fa.
 *
 * Same rule as the server: `user_security.totp_enabled` OR any passkey
 * (`webauthn_credentials`). Plain PostgREST fetch with the service key — no
 * supabase-js, no node:crypto (middleware runs in the Edge runtime).
 *
 * Returns null when it cannot be read (callers fail closed). Successful
 * answers are cached per server instance for a short time: middleware asks on
 * every page of a staff member who has no step-up proof.
 */
import { edgeSupabaseFetch } from '@/lib/supabase/transport-edge'

const CACHE_MS = 15_000
const CACHE_MAX = 500
const cache = new Map<string, { on: boolean; at: number }>()
const UUID = /^[0-9a-f-]{36}$/i

async function rows(path: string): Promise<unknown[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const res = await edgeSupabaseFetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

export async function secondFactorOnRecordEdge(userId: string): Promise<boolean | null> {
  if (!UUID.test(userId)) return null
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.on
  const id = encodeURIComponent(userId)
  const [sec, keys] = await Promise.all([
    rows(`user_security?user_id=eq.${id}&select=totp_enabled`),
    rows(`webauthn_credentials?user_id=eq.${id}&select=user_id&limit=1`),
  ])
  if (!sec || !keys) return null
  const on = (sec[0] as { totp_enabled?: boolean } | undefined)?.totp_enabled === true || keys.length > 0
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(userId, { on, at: Date.now() })
  return on
}

/** Tests only. */
export function __resetSecondFactorCacheForTests(): void {
  cache.clear()
}
