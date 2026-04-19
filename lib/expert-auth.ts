// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for all /api/expert/* routes:
// - service-role REST fetch (bypasses profiles RLS infinite-recursion)
// - expert role gate (reads viewer's role via service role, no session DB hit)
// ─────────────────────────────────────────────────────────────────────────────

import { createServerClient } from '@/lib/supabase-server'

export const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

export async function srGet<T = unknown>(path: string): Promise<T | null> {
  const { url, key } = srBase()
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[expert-auth] srGet', res.status, path)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error('[expert-auth] srGet error:', err)
    return null
  }
}

export interface ExpertViewer {
  id: string
  role: string | null
  email: string | null
}

/**
 * Authorise the request as coming from an expert/admin/super_admin.
 * Returns the viewer's profile or null if not authorised.
 */
export async function requireExpert(): Promise<ExpertViewer | null> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return null

  const rows = await srGet<Array<{ id: string; role: string | null }>>(
    `profiles?id=eq.${user.id}&select=id,role&limit=1`,
  )
  const viewer = rows?.[0] ?? null
  if (!viewer || !EXPERT_ROLES.has(viewer.role ?? '')) return null
  return { id: viewer.id, role: viewer.role, email: user.email ?? null }
}

/**
 * Privileged-viewer gate for read-only endpoints shared between Giga Panel
 * (super_admin cookie) and Expert portal (Supabase session with expert role).
 * Returns true if the caller has EITHER credential.
 */
export async function isPrivilegedViewer(cookieValue: string | null): Promise<boolean> {
  if (cookieValue === 'super_admin') return true
  const viewer = await requireExpert()
  return viewer !== null
}
