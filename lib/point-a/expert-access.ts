/**
 * lib/point-a/expert-access.ts — who may act as the expert on a company's
 * Point A (weights and template, comments, «проверено экспертом», AI
 * hypotheses; spec 2026-10-12 §7).
 *
 * Platform staff is broad (is_platform_staff: analysts, support, content
 * managers …); only experts and admins do expert work. A company's partner
 * expert / partner admin does it for the companies of their partner.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const PROFILE_EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])
const STAFF_EXPERT_ROLES = new Set(['super_expert', 'admin', 'super_admin'])

/** Profile role expert / admin, or a staff role super_expert / admin. */
export async function isPlatformExpert(service: SupabaseClient, userId: string): Promise<boolean> {
  const [profile, staff] = await Promise.all([
    service.from('profiles').select('role').eq('id', userId).maybeSingle(),
    service.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
  ])
  const pr = (profile.data as { role?: string | null } | null)?.role ?? ''
  const sr = (staff.data as { role?: string | null } | null)?.role ?? ''
  return PROFILE_EXPERT_ROLES.has(pr) || STAFF_EXPERT_ROLES.has(sr)
}

/** The tenant role of the caller for this company (lib/tenancy) → expert? */
export async function isPointAExpert(service: SupabaseClient, userId: string, tenantRole: string): Promise<boolean> {
  if (tenantRole === 'partner_expert' || tenantRole === 'partner_admin') return true
  if (tenantRole === 'staff') return isPlatformExpert(service, userId)
  return false
}
