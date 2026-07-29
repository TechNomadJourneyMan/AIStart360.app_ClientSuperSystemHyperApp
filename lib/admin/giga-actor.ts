import type { NextRequest } from 'next/server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Unified actor resolution for /api/giga-admin/* routes (ТЗ §5.14 / Этап 0).
 *
 * Two ways into the panel, in priority order:
 *  1. PERSONAL IDENTITY — a real Supabase session whose profiles.role is
 *     'super_admin'. This is the preferred path: every action is attributable
 *     to a concrete person (actor.id is the profiles UUID) and the shared
 *     password never has to leave the vault. Middleware already admits these
 *     sessions to the panel pages; this helper extends that to the API.
 *  2. BREAK-GLASS — the legacy HMAC-signed shared-password cookie
 *     (aistart360_giga). Kept for recovery when no personal super_admin can
 *     log in. Actions performed this way are attributed to the literal
 *     'giga:super_admin' and flagged kind='break_glass' so the audit trail
 *     distinguishes them.
 *
 * Routes MUST perform their own authorization by checking the return value —
 * a null return means "not a giga admin" (respond 403).
 */

export interface GigaActor {
  /** profiles UUID for session actors; the literal 'giga:super_admin' for break-glass. */
  id: string
  kind: 'session' | 'break_glass'
  email?: string
}

export async function getGigaActor(req: NextRequest): Promise<GigaActor | null> {
  // 1) Personal Supabase session with the super_admin profile role.
  try {
    const sb = createServerClient()
    const {
      data: { user },
    } = await sb.auth.getUser()
    if (user) {
      // Self-read of one's own profile row is allowed by RLS.
      const { data } = await sb
        .from('profiles')
        .select('role, status')
        .eq('id', user.id)
        .maybeSingle()
      const profile = data as { role?: string; status?: string } | null
      if (profile?.role === 'super_admin' && profile.status === 'approved') {
        return { id: user.id, kind: 'session', email: user.email ?? undefined }
      }
    }
  } catch {
    // No session context (or Supabase unreachable) — fall through to the cookie.
  }

  // 2) Break-glass signed cookie.
  if (verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin') {
    return { id: 'giga:super_admin', kind: 'break_glass' }
  }

  return null
}

/** Boolean convenience for read-only routes that don't record an actor. */
export async function isGigaSuperAdmin(req: NextRequest): Promise<boolean> {
  return (await getGigaActor(req)) !== null
}
