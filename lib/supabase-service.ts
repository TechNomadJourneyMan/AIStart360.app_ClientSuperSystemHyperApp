import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for privileged server-side writes that must
 * BYPASS RLS.
 *
 * Why this exists: the giga panel authenticates via a signed HMAC cookie and
 * therefore has NO Supabase auth session — `auth.uid()` is NULL, so any write
 * made with the anon/SSR client (`lib/supabase-server.ts`) is silently dropped
 * by RLS (0 rows affected, no error). Such routes must use this client for the
 * actual write, while still gating access with their own authorization check.
 *
 * SECURITY:
 *  - NEVER import this into a client component or expose the key to the browser.
 *  - Fails CLOSED: throws if the service-role key is missing, so a
 *    misconfiguration surfaces as a 500 instead of silently downgrading to the
 *    anon key and no-op'ing the write.
 */
let _client: SupabaseClient | null = null

/**
 * Privileged reads must never land in Next.js' shared Data Cache: a cached
 * service-role response is served to every later caller (stale settings,
 * or another user's rows in a server component).
 */
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' })

export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is not configured — refusing to perform a privileged write with the anon key',
    )
  }

  if (!_client) {
    _client = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: noStoreFetch },
    })
  }
  return _client
}

/**
 * Service-role client that stamps WHO acts on every PostgREST request.
 * The survey_answer_history trigger (migration 073) trusts these headers only
 * for service_role calls, so admin / impersonation edits are attributed in the
 * database itself. Not memoized: headers differ per actor.
 */
export function createActorServiceClient(actor: {
  id: string
  source: 'admin' | 'impersonation'
  impersonationSessionId?: string | null
}): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is not configured')
  }
  const headers: Record<string, string> = {
    'x-actor-id': actor.id.slice(0, 80),
    'x-actor-source': actor.source,
  }
  if (actor.impersonationSessionId) headers['x-impersonation-id'] = actor.impersonationSessionId
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers, fetch: noStoreFetch },
  })
}
