import { createClient } from '@/lib/supabase/server'

/**
 * Resolve the current user's id from the Supabase session ONLY.
 *
 * The legacy `aistart360_user_id` cookie is deliberately NOT consulted: it is
 * unsigned and forgeable, and its only setter (app/actions/auth.ts) is dead
 * code. Honouring it let any caller impersonate another user by sending a
 * crafted cookie (IDOR — read another user's diagnostics/metrics/profile).
 * See audit 2026-07-02. Supabase Auth is the single source of identity.
 */
export async function getSessionUserId(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}
