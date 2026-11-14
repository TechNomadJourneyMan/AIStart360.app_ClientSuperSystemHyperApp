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
import { actorFromRows } from '@/lib/access/actor'

const STAFF_EXPERT_ROLES = new Set(['super_expert', 'admin', 'super_admin'])

/**
 * An active expert (profiles.role 'expert', approved) or an approved staff
 * super_expert / admin / super_admin (staff_roles) — the rule of migration 140
 * (lib/access/actor.ts). The legacy profile roles admin / super_admin without
 * a staff_roles row no longer count (SR-02). Fails closed on a read error.
 */
export async function isPlatformExpert(service: SupabaseClient, userId: string): Promise<boolean> {
  const [profile, staff] = await Promise.all([
    service.from('profiles').select('role, status').eq('id', userId).maybeSingle(),
    service.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
  ])
  if (profile.error || staff.error) return false
  const a = actorFromRows(userId, {
    profile: profile.data as { role?: string | null; status?: string | null } | null,
    staff: staff.data as { role?: string | null } | null,
  })
  return a.activeExpert || (!!a.staffRole && STAFF_EXPERT_ROLES.has(a.staffRole))
}

/** The tenant role of the caller for this company (lib/tenancy) → expert? */
export async function isPointAExpert(service: SupabaseClient, userId: string, tenantRole: string): Promise<boolean> {
  if (tenantRole === 'partner_expert' || tenantRole === 'partner_admin') return true
  if (tenantRole === 'staff') return isPlatformExpert(service, userId)
  return false
}
