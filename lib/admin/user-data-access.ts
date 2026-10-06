import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireGiga, isSameOriginMutation } from '@/lib/admin/giga-actor'
import { expertBlockResponse, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import type { Permission } from '@/lib/admin/rbac'

/**
 * Read access to one user's data, shared by GIGA-CRM and the expert portal.
 *
 *  - GIGA staff need `permission` (the actor is returned for auditing);
 *  - GIGA staff are governed ONLY by RBAC: a staff member without the
 *    permission is refused even if their profile role is expert/admin (the
 *    legacy expert path let an analyst read client documents);
 *  - staff refused by requireGiga (missing permission, second factor not
 *    passed, role unreadable) never fall back to the expert path;
 *  - a non-staff expert-portal session (approved, second factor passed — see
 *    resolveExpert) may read CLIENT accounts only — never staff, owners or
 *    other experts.
 *
 * Reads then go through the service client: break-glass admins have no
 * Supabase session, so an RLS-scoped client silently returned nothing.
 */
export async function authorizeUserDataRead(
  req: NextRequest,
  permission: Permission | Permission[],
  resolveUserId: (sb: SupabaseClient) => Promise<string | null>,
): Promise<{ sb: SupabaseClient; userId: string | null; viewer: string } | { response: NextResponse }> {
  if (!isSameOriginMutation(req)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const guard = await requireGiga(req, permission)
  const sb = createServiceClient()
  if (guard.actor) return { sb, userId: await resolveUserId(sb), viewer: guard.actor.id }
  // Staff are governed only by RBAC and the second-factor gate: an MFA-blocked
  // or under-privileged staff member (or one whose role could not be read)
  // must NOT fall through to the expert path.
  if (guard.staff) return { response: guard.response }

  const expert = await resolveExpert()
  if (!expert.ok) {
    // An expert who has to pass / enrol the second factor gets that answer.
    const explain = expert.block === 'step_up' || expert.block === 'enroll' || expert.block === 'unavailable'
    return { response: explain ? expertBlockResponse(expert.block) : guard.response }
  }
  const viewer = expert.viewer
  const userId = await resolveUserId(sb)
  if (!userId) return { sb, userId: null, viewer: viewer.id }
  const { data } = await sb.from('profiles').select('role').eq('id', userId).maybeSingle()
  if ((data as { role?: string } | null)?.role !== 'client') {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { sb, userId, viewer: viewer.id }
}

/** `id` is an admin_requests id (payload.userId) or already a profile id. */
export async function resolveRequestUserId(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await sb.from('admin_requests').select('payload').eq('id', id).maybeSingle()
  if (data) return ((data as { payload?: Record<string, string> }).payload?.userId) ?? null
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}
