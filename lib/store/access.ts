import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyStepUp } from '@/lib/mfa/step-up'

export type StoreAccessDecision = 'allowed' | 'forbidden' | 'unavailable'

interface StoreSessionUser {
  id: string
  user_metadata?: Record<string, unknown>
}

/** API routes bypass middleware, so enrolled users must prove MFA here too. */
export function hasStoreMfaStepUp(
  user: StoreSessionUser,
  stepUpToken: string | null | undefined,
): boolean {
  const metadata = user.user_metadata
  const enrolled = metadata?.mfa_totp === true || metadata?.mfa_webauthn === true
  return !enrolled || verifyStepUp(stepUpToken, user.id)
}

/**
 * API routes are excluded from the dashboard middleware, so every Store API
 * must reproduce the route's role/status boundary from trusted profile data.
 * Missing or malformed profiles fail closed.
 */
export async function resolveStoreAccess(
  client: SupabaseClient,
  userId: string,
): Promise<StoreAccessDecision> {
  const { data, error } = await client
    .from('profiles')
    .select('role, status')
    .eq('id', userId)
    .maybeSingle()

  if (error) return 'unavailable'

  const profile = data as { role?: unknown; status?: unknown } | null
  const role = typeof profile?.role === 'string' ? profile.role : null
  const status = typeof profile?.status === 'string' ? profile.status : null

  if (status === 'blocked' || status === 'archived') return 'forbidden'
  if (role === 'client') return status === 'approved' ? 'allowed' : 'forbidden'
  if (role === 'admin' || role === 'super_admin') return 'allowed'
  return 'forbidden'
}
