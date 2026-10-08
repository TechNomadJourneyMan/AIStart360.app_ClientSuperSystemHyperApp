import { NextResponse, type NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { signToken, verifyToken } from '@/lib/security/signed-token'
import { getSetting } from '@/lib/settings/store'
import { MFA_COOKIE_NAME, verifyStepUp } from '@/lib/mfa/step-up'
import { mfaFlagsEnrolled } from '@/lib/mfa/flags'
import { e2eSeamEnabled } from '@/lib/admin/e2e-auth-seam-edge'
import { canManageTarget, effectiveClientScope, hasPermission, isStaffRole, permissionsFor, type ClientScope, type Permission, type StaffRole } from '@/lib/admin/rbac'

/**
 * Actor resolution for /api/giga-admin/* routes (GIGA-CRM).
 *
 * Ways into the panel, in priority order:
 *  1. PERSONAL SESSION — a Supabase session whose profile is super_admin or who
 *     holds a row in `staff_roles`. Every action is attributable to a person.
 *  2. STAFF COOKIE — a short-lived signed token issued to a session actor when
 *     they open a user's cabinet (impersonation replaces the browser's Supabase
 *     session with the user's, so the panel keeps working through this cookie).
 *     The role is re-read from `staff_roles` on every request: revoking a role
 *     takes effect immediately.
 *
 * The shared-password «break-glass» entry was removed (owner decision,
 * 2026-10): there is no way into the panel without a personal account.
 * 'break_glass' survives only as a label on historical audit rows.
 *
 * Test-only: the E2E auth seam (lib/admin/e2e-auth-seam-edge.ts) resolves a
 * seeded user's real staff role from the database. It is compiled out of
 * production builds and needs E2E_AUTH_SEAM_SECRET (≥32 chars) otherwise.
 * The owner may also sign in with email + a password whose hash lives only in
 * the environment (app/api/giga-admin/auth); that yields an ordinary personal
 * session, which goes through the same checks.
 *
 * Routes authorize with `requireGiga(req, permission)` — never with a bare
 * non-null check: different staff roles see different parts of the panel.
 */

export const STAFF_COOKIE_NAME = 'aistart360_giga_staff'
export const STAFF_COOKIE_TTL_SECONDS = 2 * 60 * 60

export interface GigaActor {
  /** profiles UUID of the staff member. */
  id: string
  kind: 'session' | 'staff_cookie'
  role: StaffRole
  email?: string
  permissions: Permission[]
  /**
   * Каких клиентов видит сотрудник: всех или только назначенных ему
   * (`staff_roles.client_scope`, миграция 086). Проверяется в
   * lib/admin/client-scope.ts на каждом маршруте с данными клиента.
   */
  clientScope: ClientScope
}

interface StaffIdentity { role: StaffRole; clientScope: ClientScope }

function actor(id: string, kind: GigaActor['kind'], who: StaffIdentity, email?: string): GigaActor {
  return { id, kind, role: who.role, email, permissions: permissionsFor(who.role), clientScope: who.clientScope }
}

/** Staff role of a person: super_admin profile, else their `staff_roles` row. */
async function staffRoleOf(
  client: { from: ReturnType<typeof createServiceClient>['from'] },
  userId: string,
): Promise<StaffIdentity | null> {
  const [{ data: profile, error: profileError }, { data: staff, error: staffError }] = await Promise.all([
    client.from('profiles').select('role, status').eq('id', userId).maybeSingle(),
    // '*' а не список колонок: client_scope появляется миграцией 086, и до её
    // применения явный select упал бы и лишил доступа весь персонал.
    client.from('staff_roles').select('*').eq('user_id', userId).maybeSingle(),
  ])
  // A failed read is not "no role": callers decide how to fail closed.
  if (profileError || staffError) throw new Error('staff role unavailable')
  const p = profile as { role?: string; status?: string } | null
  // Only an approved account works in the panel: pending, rejected, blocked
  // and archived profiles get no staff access, whatever their role says.
  if (p?.status !== 'approved') return null
  const row = staff as { role?: string; client_scope?: string } | null
  if (p.role === 'super_admin') return { role: 'super_admin', clientScope: 'all' }
  const r = row?.role
  return isStaffRole(r) ? { role: r, clientScope: effectiveClientScope(r, row?.client_scope) } : null
}

/** Why a personal session was not admitted although its role allows the panel. */
export type GigaMfaBlock = 'step_up' | 'enroll'

/**
 * Second-factor gate for personal staff sessions on the API (middleware only
 * gates pages; /api/* skips it). Enrolment is read from the database
 * (user_security, webauthn_credentials) and the JWT flags, never from
 * user-editable metadata alone; the proof is the signed step-up cookie.
 */
export async function staffMfaGate(
  stepUpCookie: string | null | undefined,
  user: { id: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> },
): Promise<'ok' | GigaMfaBlock> {
  let enrolled = mfaFlagsEnrolled(user)
  if (!enrolled) {
    const service = createServiceClient()
    const [sec, keys] = await Promise.all([
      service.from('user_security').select('totp_enabled').eq('user_id', user.id).maybeSingle(),
      service.from('webauthn_credentials').select('user_id', { count: 'exact', head: true }).eq('user_id', user.id),
    ])
    if (sec.error || keys.error) throw new Error('mfa state unavailable')
    enrolled = (sec.data as { totp_enabled?: boolean } | null)?.totp_enabled === true || (keys.count ?? 0) > 0
  }
  if (enrolled) return verifyStepUp(stepUpCookie, user.id) ? 'ok' : 'step_up'
  return (await getSetting('staff_require_mfa')) ? 'enroll' : 'ok'
}

interface GigaResolution {
  actor: GigaActor | null
  /** A staff session was found but its second factor is missing. */
  mfa?: GigaMfaBlock
  /**
   * The caller is staff even though no actor was admitted (MFA-blocked staff
   * session), or staff status could not be determined (`unavailable`). Shared
   * routes (expert portal fallbacks) must refuse such callers instead of
   * treating them as non-staff.
   */
  staff: boolean
  /** The staff role / second-factor state could not be read (DB down). */
  unavailable?: boolean
}

async function resolveGigaActor(req: NextRequest): Promise<GigaResolution> {
  // 0) Test-only E2E seam: `false` in production builds, so this branch and
  //    its module are never loaded there.
  if (e2eSeamEnabled()) {
    const { resolveE2eSeamIdentity } = await import('@/lib/admin/e2e-auth-seam')
    const seam = await resolveE2eSeamIdentity(req.cookies)
    if (seam) {
      const who = { role: seam.role, clientScope: effectiveClientScope(seam.role, null) }
      return { actor: actor(seam.userId, 'session', who, seam.email), staff: true }
    }
  }

  let mfa: GigaMfaBlock | undefined
  let staffSession = false
  let unavailable = false
  // 1) Personal Supabase session.
  let sb: ReturnType<typeof createServerClient> | null = null
  let user: User | null = null
  try {
    sb = createServerClient()
    user = (await sb.auth.getUser()).data.user
  } catch {
    // No session context — fall through to cookies.
  }
  if (sb && user) {
    try {
      // Own profile / own staff_roles row are readable under RLS.
      const role = await staffRoleOf(sb, user.id)
      if (role) {
        staffSession = true
        const gate = await staffMfaGate(req.cookies.get(MFA_COOKIE_NAME)?.value, user)
        if (gate === 'ok') return { actor: actor(user.id, 'session', role, user.email ?? undefined), staff: true }
        mfa = gate
      }
    } catch {
      // The role or the second-factor state could not be read: never treat
      // this caller as "not staff" (fail closed); cookies below may still admit.
      unavailable = true
    }
  }

  // 2) Short-lived personal staff cookie (re-validated against the DB). Issued
  //    only to an admitted session actor (who passed the gate above) — see
  //    signStaffCookie().
  const staffToken = req.cookies.get(STAFF_COOKIE_NAME)?.value
  if (staffToken) {
    const v = await verifyToken<{ sub: string; email?: string }>('staff', staffToken)
    if (v.ok && typeof v.claims.sub === 'string') {
      try {
        const role = await staffRoleOf(createServiceClient(), v.claims.sub)
        if (role) return { actor: actor(v.claims.sub, 'staff_cookie', role, v.claims.email), staff: true }
      } catch {
        /* fall through */
      }
    }
  }

  return { actor: null, mfa, staff: staffSession || unavailable, ...(unavailable ? { unavailable } : {}) }
}

export async function getGigaActor(req: NextRequest): Promise<GigaActor | null> {
  return (await resolveGigaActor(req)).actor
}

/**
 * The staff cookie that keeps an admin in the panel while impersonation swaps
 * the browser's Supabase session. Minted ONLY for a personal session actor who
 * passed the second-factor gate in this request: a 'staff_cookie' actor must not
 * re-mint it (that would extend panel access indefinitely without a fresh
 * second factor).
 */
export async function signStaffCookie(a: GigaActor): Promise<string | null> {
  if (a.kind !== 'session') return null
  return signToken('staff', { sub: a.id, email: a.email ?? null }, STAFF_COOKIE_TTL_SECONDS)
}

/** Boolean convenience kept for older call sites: true only for super_admin. */
export async function isGigaSuperAdmin(req: NextRequest): Promise<boolean> {
  return (await getGigaActor(req))?.role === 'super_admin'
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for cookie-authenticated mutations: a browser always sends
 * Origin on cross-origin POST/PATCH/DELETE; it must match our own host.
 */
export function isSameOriginMutation(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = req.headers.get('origin')
  if (!origin) return true // non-browser clients (tests, server-to-server)
  try {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export type GigaGuard =
  | { actor: GigaActor; response?: undefined; staff?: undefined }
  /** `staff`: the caller is (or may be) staff although refused — see GigaResolution. */
  | { actor?: undefined; response: NextResponse; staff?: boolean }

/**
 * Authorize a GIGA-CRM request: a staff actor holding `permission` (all of
 * them, when an array is passed), and a same-origin request for mutations.
 */
export async function requireGiga(req: NextRequest, permission: Permission | Permission[]): Promise<GigaGuard> {
  if (!isSameOriginMutation(req)) {
    return { response: NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 }) }
  }
  const { actor: a, mfa, staff, unavailable } = await resolveGigaActor(req)
  if (!a && mfa) {
    return {
      staff: true,
      response: NextResponse.json({
        ok: false,
        error: mfa === 'step_up'
          ? 'Подтвердите вход вторым фактором (страница /2fa), затем повторите действие'
          : 'Для работы в панели включите двухфакторную аутентификацию (Настройки → Безопасность)',
        code: mfa === 'step_up' ? 'MFA_STEP_UP_REQUIRED' : 'MFA_ENROLLMENT_REQUIRED',
      }, { status: 403 }),
    }
  }
  if (!a && unavailable) {
    return { staff: true, response: NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 503 }) }
  }
  if (!a) return { staff, response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  const needed = Array.isArray(permission) ? permission : [permission]
  const missing = needed.filter((p) => !hasPermission(a.role, p))
  if (missing.length) {
    return {
      staff: true,
      response: NextResponse.json({ ok: false, error: 'Недостаточно прав', missing }, { status: 403 }),
    }
  }
  return { actor: a }
}

/** Current staff role of any user (for target checks). */
export async function staffRoleOfUser(userId: string): Promise<{ staffRole: StaffRole | null; profileRole: string | null; status: string | null; email: string | null }> {
  const sb = createServiceClient()
  const [{ data: profile, error: profileError }, { data: staff, error: staffError }] = await Promise.all([
    sb.from('profiles').select('role, status, email').eq('id', userId).maybeSingle(),
    sb.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
  ])
  const p = profile as { role?: string; status?: string; email?: string } | null
  const r = (staff as { role?: string } | null)?.role
  const staffRole: StaffRole | null = p?.role === 'super_admin' ? 'super_admin' : isStaffRole(r) ? r : null
  return { staffRole, profileRole: p?.role ?? null, status: p?.status ?? null, email: p?.email ?? null }
}

/**
 * 403 when `actor` may not act on `userId` (staff at or above the actor's rank);
 * null when the action may proceed. Unknown users pass through — the route
 * reports its own 404.
 */
export async function forbidTarget(actor: GigaActor, userId: string): Promise<NextResponse | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null
  try {
    const t = await staffRoleOfUser(userId)
    if (!canManageTarget(actor.role, t.staffRole)) {
      return NextResponse.json({ ok: false, error: 'Недостаточно прав для действий с этим сотрудником' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 500 })
  }
  return null
}
