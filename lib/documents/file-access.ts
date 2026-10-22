/**
 * lib/documents/file-access.ts — who may open a stored file through
 * GET /api/v1/files/documents (the only way to read the private `documents`
 * bucket and questionnaire files of `client-documents` from the browser).
 *
 * Objects live under `<owner uid>/…`. Access, in order:
 *   1. the owner (session user = first folder of the path);
 *   2. GIGA staff with `users.view` + `users.sensitive`, inside their client
 *      scope (staff_roles.client_scope = 'assigned' → only assigned clients),
 *      or an approved expert-portal user for CLIENT accounts — the same rules
 *      as every other «client documents» read (lib/admin/user-data-access.ts).
 *      A staff member refused by RBAC / the second factor is refused here too
 *      and never falls through to step 3;
 *   3. a reader of the owner's company (can_read_company through the caller's
 *      own session: company members, partner experts) — the same rule as the
 *      RLS of documents / survey_answers (documents_tenant_select).
 * Root-level objects (no user folder) are not served at all: only the service
 * role reads them (migration 133).
 *
 * The decision is a pure function over injected lookups (tests run without
 * network or database); `liveFileAccessDeps(req)` wires the production ones.
 */
import type { NextRequest } from 'next/server'
import { isSafeObjectPath, ownerFolderOf, type FileRef } from './survey-files'

/** Signed URLs handed out by the route live 10 minutes. */
export const FILE_SIGNED_URL_TTL_SECONDS = 600

export type StaffDecision = 'allow' | 'deny' | 'none'

export interface FileAccessDeps {
  /** The session user, or null. */
  viewerId(): Promise<string | null>
  /** Staff / expert verdict for this owner: 'none' when the caller is neither. */
  staffDecision(ownerId: string): Promise<StaffDecision>
  /** Whether the viewer may read a company of the owner (can_read_company). */
  canReadOwnerCompany(viewerId: string, ownerId: string): Promise<boolean>
}

export type FileAccessDecision =
  | { ok: true; ownerId: string; via: 'owner' | 'staff' | 'company' }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string }

const NOT_FOUND = 'Файл не найден'

export async function decideFileAccess(ref: FileRef, deps: FileAccessDeps): Promise<FileAccessDecision> {
  if (!isSafeObjectPath(ref.path)) return { ok: false, status: 400, error: 'Некорректный путь к файлу' }

  const viewerId = (await deps.viewerId())?.toLowerCase() ?? null
  const ownerId = ownerFolderOf(ref.path)

  if (!ownerId) {
    // Legacy root-level objects: service role only.
    return viewerId ? { ok: false, status: 404, error: NOT_FOUND } : { ok: false, status: 401, error: 'Требуется вход в систему' }
  }
  if (viewerId && viewerId === ownerId) return { ok: true, ownerId, via: 'owner' }

  const staff = await deps.staffDecision(ownerId)
  if (staff === 'allow') return { ok: true, ownerId, via: 'staff' }
  if (staff === 'deny') return { ok: false, status: 403, error: 'Нет доступа к файлам этого клиента' }

  if (!viewerId) return { ok: false, status: 401, error: 'Требуется вход в систему' }
  if (await deps.canReadOwnerCompany(viewerId, ownerId)) return { ok: true, ownerId, via: 'company' }

  // 404, not 403: do not confirm that someone else's file exists.
  return { ok: false, status: 404, error: NOT_FOUND }
}

// ─── Production lookups ─────────────────────────────────────────────────────

export function liveFileAccessDeps(req: NextRequest): FileAccessDeps {
  let sessionClient: Promise<import('@supabase/supabase-js').SupabaseClient> | null = null
  const session = () => {
    sessionClient ??= import('@/lib/supabase/server').then((m) => m.createClient())
    return sessionClient
  }

  return {
    async viewerId() {
      const client = await session()
      const { data } = await client.auth.getUser()
      return data.user?.id ?? null
    },

    async staffDecision(ownerId) {
      const { requireGiga } = await import('@/lib/admin/giga-actor')
      const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
      if (guard.actor) {
        const { canAccessClient } = await import('@/lib/admin/client-scope')
        return (await canAccessClient(guard.actor, ownerId)) ? 'allow' : 'deny'
      }
      // Staff refused by RBAC / the second factor never fall through to other paths.
      if (guard.staff) return 'deny'

      const { resolveExpert } = await import('@/lib/expert-auth')
      const expert = await resolveExpert()
      if (!expert.ok) {
        return expert.block === 'step_up' || expert.block === 'enroll' || expert.block === 'unavailable' ? 'deny' : 'none'
      }
      const { createServiceClient } = await import('@/lib/supabase-service')
      const { isClientProfileRole } = await import('@/lib/profiles/client-roles')
      const { data } = await createServiceClient().from('profiles').select('role').eq('id', ownerId).maybeSingle()
      // Experts read CLIENT accounts only — never staff, owners or other experts.
      return isClientProfileRole((data as { role?: string } | null)?.role) ? 'allow' : 'deny'
    },

    async canReadOwnerCompany(viewerId, ownerId) {
      const { createServiceClient } = await import('@/lib/supabase-service')
      const sb = createServiceClient()
      const [owned, member] = await Promise.all([
        sb.from('companies').select('id').eq('user_id', ownerId).limit(20),
        sb.from('company_members').select('company_id').eq('user_id', ownerId).eq('role', 'owner').eq('status', 'active').limit(20),
      ])
      const ids = new Set<string>()
      for (const r of (owned.data ?? []) as Array<{ id: string }>) ids.add(r.id)
      for (const r of (member.data ?? []) as Array<{ company_id: string }>) ids.add(r.company_id)
      if (ids.size === 0) return false
      const { resolveTenantWith } = await import('@/lib/tenancy')
      const client = await session()
      for (const companyId of Array.from(ids)) {
        try {
          const res = await resolveTenantWith(client, viewerId, { companyId, access: 'read' })
          if (res.ok) return true
        } catch {
          // A failed check is a refusal, never access.
        }
      }
      return false
    },
  }
}
