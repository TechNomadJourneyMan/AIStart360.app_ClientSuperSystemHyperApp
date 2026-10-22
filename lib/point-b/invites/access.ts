/**
 * lib/point-b/invites/access.ts — is Point B open to a client (for the invites and the pop-up layer): PRO, or the
 * access gates are off — the same rule as the page (lib/access/gate.ts). A failed read → closed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { can } from '@/lib/access/entitlements'
import { readEntitlements } from '@/lib/access/server'
import { getAccessGatesEnabled } from '@/lib/settings/system-settings'

export async function hasPointB(sb: SupabaseClient, userId: string): Promise<boolean> {
  try {
    if (!(await getAccessGatesEnabled())) return true
    return can(await readEntitlements(sb, userId), 'point_b')
  } catch {
    return false
  }
}
