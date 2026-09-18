import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGigaActor, requireGiga, isSameOriginMutation } from '@/lib/admin/giga-actor'
import { requireExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import type { Permission } from '@/lib/admin/rbac'

/**
 * Read access to one user's data, shared by GIGA-CRM and the expert portal.
 *
 *  - GIGA staff need `permission` (the actor is returned for auditing);
 *  - GIGA staff are governed ONLY by RBAC: a staff member without the
 *    permission is refused even if their profile role is expert/admin (the
 *    legacy expert path let an analyst read client documents);
 *  - a non-staff expert-portal session may read CLIENT accounts only — never
 *    staff, owners or other experts.
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
  if (await getGigaActor(req)) return { response: guard.response }

  const expert = await requireExpert()
  if (!expert) return { response: guard.response }
  const userId = await resolveUserId(sb)
  if (!userId) return { sb, userId: null, viewer: expert.id }
  const { data } = await sb.from('profiles').select('role').eq('id', userId).maybeSingle()
  if ((data as { role?: string } | null)?.role !== 'client') {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { sb, userId, viewer: expert.id }
}

/** `id` is an admin_requests id (payload.userId) or already a profile id. */
export async function resolveRequestUserId(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await sb.from('admin_requests').select('payload').eq('id', id).maybeSingle()
  if (data) return ((data as { payload?: Record<string, string> }).payload?.userId) ?? null
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}
