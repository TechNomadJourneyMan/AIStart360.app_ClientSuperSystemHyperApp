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
    })
  }
  return _client
}
