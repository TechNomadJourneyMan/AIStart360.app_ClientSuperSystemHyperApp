// Server-side helpers for resolving the current user's vertical.
// Reads profiles.vertical via service-role fetch (bypasses RLS recursion —
// same pattern as lib/expert-auth.ts).

import { createServerClient } from '@/lib/supabase-server'
import { srGet } from '@/lib/expert-auth'
import { getVertical, type Branding, type VerticalId } from '@/lib/verticals'

interface ProfileVertical {
  id: string
  vertical: string | null
  branding: Branding | null
}

/**
 * Resolve the current authenticated user's vertical + branding.
 * Returns null when unauthenticated. Falls back to 'generic' when the stored
 * value is unexpected.
 */
export async function getCurrentOrgVertical(): Promise<{
  userId: string
  vertical: VerticalId
  branding: Branding | null
} | null> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return null

  const rows = await srGet<ProfileVertical[]>(
    `profiles?id=eq.${user.id}&select=id,vertical,branding&limit=1`,
  )
  const row = rows?.[0]
  const v = getVertical(row?.vertical).id
  return { userId: user.id, vertical: v, branding: row?.branding ?? null }
}

/** Cheap boolean check when you only care about medical vs everything else */
export async function isMedicalVertical(): Promise<boolean> {
  const ctx = await getCurrentOrgVertical()
  return ctx?.vertical === 'medical'
}
