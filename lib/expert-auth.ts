// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for all /api/expert/* routes:
// - service-role REST fetch (bypasses profiles RLS infinite-recursion)
// - expert gate: who the caller is per migration 140 (lib/access/actor.ts:
//   active expert or staff Admin / Super Admin from staff_roles, approved),
//   then the staff second-factor gate (staffMfaGate), like requireGiga
// - client scope: an expert reaches only the clients assigned to them
//   (user_assignments) — guardExpertClient / guardExpertCompany /
//   guardExpertReport on every route that touches one client (SR-03)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import { staffMfaGate } from '@/lib/admin/giga-actor'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { canAccessClient, guardCompanyAccess, isUuid, NOT_ASSIGNED_ERROR } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { expertPortalRole, isExpertPortalActor, resolveActor } from '@/lib/access/actor'

/**
 * Profile roles of the expert NOTIFICATION audiences (Telegram / WhatsApp
 * recipient lists). NOT the gate of the expert portal API any more: who may
 * use /api/expert/* is decided by resolveExpert through lib/access/actor.ts
 * (migration 140 — the legacy profile roles admin / super_admin without a
 * staff_roles row are not admitted).
 */
export const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])

/**
 * Who the expert Telegram bot admits: a profile role in EXPERT_ROLES (expert
 * portal) or the SuperExpert staff role (their profile role is usually
 * 'client'; the role lives in staff_roles).
 */
export function isExpertBotMember(profileRole: string | null | undefined, staffRole: string | null | undefined): boolean {
  return EXPERT_ROLES.has(profileRole ?? '') || staffRole === 'super_expert'
}

/** Role label for an expert-bot member: the profile role, or 'super_expert'. */
export function expertBotRole(profileRole: string | null | undefined, staffRole: string | null | undefined): string {
  return EXPERT_ROLES.has(profileRole ?? '') ? (profileRole as string) : staffRole === 'super_expert' ? 'super_expert' : (profileRole ?? '')
}

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
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
  /** 'expert', or the staff role 'admin' / 'super_admin' (staff_roles, never the legacy profile role). */
  role: string | null
  email: string | null
  /**
   * Which clients: 'all' (staff Admin / Super Admin) or 'assigned' (an expert:
   * user_assignments.assignee_id = viewer). Absent on older test doubles —
   * then derived from `role`.
   */
  clientScope?: 'all' | 'assigned'
}

/** The client scope of a viewer (lib/admin/client-scope.ts ScopedActor): 'all' or 'assigned'. */
function viewerScope(viewer: ExpertViewer): { id: string; clientScope: 'all' | 'assigned' } {
  const all = viewer.clientScope ? viewer.clientScope === 'all' : viewer.role === 'admin' || viewer.role === 'super_admin'
  return { id: viewer.id, clientScope: all ? 'all' : 'assigned' }
}

/** Does the viewer see every client (staff Admin / Super Admin)? */
export function expertSeesAllClients(viewer: ExpertViewer): boolean {
  return viewerScope(viewer).clientScope === 'all'
}

/** Why a session was not admitted to the expert portal API. */
export type ExpertBlock = 'unauthenticated' | 'forbidden' | 'step_up' | 'enroll' | 'unavailable'

export type ExpertAuth = { ok: true; viewer: ExpertViewer } | { ok: false; block: ExpertBlock }

/**
 * Authorise the request as coming from an expert or a staff Admin / Super Admin.
 *
 * Experts are platform staff (D1), so the same rules as GIGA staff apply:
 *  - who: lib/access/actor.ts (migration 140) — an approved profile with
 *    role 'expert', or an approved profile with a staff_roles row admin /
 *    super_admin. A legacy profiles.role admin / super_admin without
 *    staff_roles is refused (SR-03); pending / rejected / blocked / archived
 *    accounts get nothing, whatever their role says;
 *  - the second factor: when the person enrolled (or the platform requires
 *    2FA for staff) the signed step-up cookie of THIS user must be present
 *    (staffMfaGate). Middleware does not gate /api/*, so this is the gate.
 * Fails closed when the profile or the MFA state cannot be read.
 */
export async function resolveExpert(): Promise<ExpertAuth> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return { ok: false, block: 'unauthenticated' }

  const actor = await resolveActor(user.id)
  if (!actor) return { ok: false, block: 'unavailable' }
  if (!isExpertPortalActor(actor)) return { ok: false, block: 'forbidden' }

  let gate: Awaited<ReturnType<typeof staffMfaGate>>
  try {
    gate = await staffMfaGate(cookies().get(MFA_COOKIE_NAME)?.value, user)
  } catch {
    return { ok: false, block: 'unavailable' }
  }
  if (gate !== 'ok') return { ok: false, block: gate }

  const role = expertPortalRole(actor)
  return {
    ok: true,
    viewer: { id: user.id, role, email: user.email ?? null, clientScope: role === 'expert' ? 'assigned' : 'all' },
  }
}

/**
 * Gate of the expert-bot link API (/api/expert/telegram-link): the expert
 * portal gate, widened to SuperExpert staff (approved, same second-factor
 * rule). Does NOT open the rest of /api/expert/* to SuperExperts.
 */
export async function resolveExpertBotUser(): Promise<ExpertAuth> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return { ok: false, block: 'unauthenticated' }

  // Migration 140 rule (lib/access/actor.ts): an active expert, a staff Admin /
  // Super Admin, or a staff SuperExpert — never the legacy profile role alone.
  const actor = await resolveActor(user.id)
  if (!actor) return { ok: false, block: 'unavailable' }
  const superExpert = actor.staffRole === 'super_expert'
  if (!isExpertPortalActor(actor) && !superExpert) return { ok: false, block: 'forbidden' }

  let gate: Awaited<ReturnType<typeof staffMfaGate>>
  try {
    gate = await staffMfaGate(cookies().get(MFA_COOKIE_NAME)?.value, user)
  } catch {
    return { ok: false, block: 'unavailable' }
  }
  if (gate !== 'ok') return { ok: false, block: gate }

  const role = isExpertPortalActor(actor) ? expertPortalRole(actor) : 'super_expert'
  return { ok: true, viewer: { id: user.id, role, email: user.email ?? null } }
}

/**
 * The viewer, or null when the caller may not use the expert portal API
 * (see resolveExpert; routes answer their usual 401/403). Routes that want to
 * tell the UI WHY (second factor) use resolveExpert + expertBlockResponse.
 */
export async function requireExpert(): Promise<ExpertViewer | null> {
  const r = await resolveExpert()
  return r.ok ? r.viewer : null
}

/**
 * May this expert/admin work with THIS client? Staff Admin / Super Admin —
 * any client. An expert — only clients where they are the assignee
 * (user_assignments.assignee_id): spec 2026-10-18 §17 «эксперт — только
 * назначенные», the rule of migration 140 (lib/access/actor.ts). Fails
 * closed when the assignment cannot be read. Returns the refusal response,
 * or null to continue.
 */
export async function guardExpertClient(viewer: ExpertViewer, clientId: string): Promise<NextResponse | null> {
  if (!isUuid(clientId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  if (!(await canAccessClient(viewerScope(viewer), clientId))) {
    return NextResponse.json({ ok: false, error: NOT_ASSIGNED_ERROR }, { status: 403 })
  }
  return null
}

/**
 * guardExpertClient for a company: its owner must be the viewer's client (a
 * company without an owner — staff admins only). 404 unknown company, 503
 * unreadable (lib/admin/client-scope.ts guardCompanyAccess).
 */
export async function guardExpertCompany(viewer: ExpertViewer, companyId: string): Promise<NextResponse | null> {
  if (!companyId) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  return guardCompanyAccess(viewerScope(viewer), companyId)
}

/**
 * guardExpertClient for a report version (report_versions.company_id). An
 * unknown / malformed id answers 404 like the routes do; an unreadable row 503.
 */
export async function guardExpertReport(viewer: ExpertViewer, versionId: string): Promise<NextResponse | null> {
  if (!isUuid(versionId)) return NextResponse.json({ ok: false, error: 'Версия отчёта не найдена' }, { status: 404 })
  if (expertSeesAllClients(viewer)) return null
  const { data, error } = await createServiceClient().from('report_versions').select('company_id').eq('id', versionId).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 503 })
  const companyId = (data as { company_id?: string | null } | null)?.company_id
  if (!companyId) return NextResponse.json({ ok: false, error: 'Версия отчёта не найдена' }, { status: 404 })
  return guardExpertCompany(viewer, companyId)
}

/** JSON answer for a refused expert request; MFA blocks carry the same codes as GIGA. */
export function expertBlockResponse(block: ExpertBlock): NextResponse {
  switch (block) {
    case 'unauthenticated':
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    case 'forbidden':
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    case 'step_up':
      return NextResponse.json({
        ok: false,
        error: 'Подтвердите вход вторым фактором (страница /2fa), затем повторите действие',
        code: 'MFA_STEP_UP_REQUIRED',
      }, { status: 403 })
    case 'enroll':
      return NextResponse.json({
        ok: false,
        error: 'Включите двухфакторную аутентификацию (Настройки → Безопасность)',
        code: 'MFA_ENROLLMENT_REQUIRED',
      }, { status: 403 })
    case 'unavailable':
      return NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 503 })
  }
}
