import { NextResponse, type NextRequest } from 'next/server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { verifyToken } from '@/lib/security/signed-token'
import { getSetting } from '@/lib/settings/store'
import { canManageTarget, hasPermission, isStaffRole, permissionsFor, type Permission, type StaffRole } from '@/lib/admin/rbac'

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
 *  3. BREAK-GLASS — the shared-password HMAC cookie. Always super_admin,
 *     attributed to 'giga:super_admin' with kind 'break_glass'.
 *
 * Routes authorize with `requireGiga(req, permission)` — never with a bare
 * non-null check: different staff roles see different parts of the panel.
 */

export const STAFF_COOKIE_NAME = 'aistart360_giga_staff'
export const STAFF_COOKIE_TTL_SECONDS = 2 * 60 * 60

export interface GigaActor {
  /** profiles UUID for people; the literal 'giga:super_admin' for break-glass. */
  id: string
  kind: 'session' | 'staff_cookie' | 'break_glass'
  role: StaffRole
  email?: string
  permissions: Permission[]
}

function actor(id: string, kind: GigaActor['kind'], role: StaffRole, email?: string): GigaActor {
  return { id, kind, role, email, permissions: permissionsFor(role) }
}

/** Staff role of a person: super_admin profile, else their `staff_roles` row. */
async function staffRoleOf(
  client: { from: ReturnType<typeof createServiceClient>['from'] },
  userId: string,
): Promise<StaffRole | null> {
  const [{ data: profile }, { data: staff }] = await Promise.all([
    client.from('profiles').select('role, status').eq('id', userId).maybeSingle(),
    client.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
  ])
  const p = profile as { role?: string; status?: string } | null
  // Only an approved account works in the panel: pending, rejected, blocked
  // and archived profiles get no staff access, whatever their role says.
  if (p?.status !== 'approved') return null
  if (p.role === 'super_admin') return 'super_admin'
  const r = (staff as { role?: string } | null)?.role
  return isStaffRole(r) ? r : null
}

export async function getGigaActor(req: NextRequest): Promise<GigaActor | null> {
  // 1) Personal Supabase session.
  try {
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      // Own profile / own staff_roles row are readable under RLS.
      const role = await staffRoleOf(sb, user.id)
      if (role) return actor(user.id, 'session', role, user.email ?? undefined)
    }
  } catch {
    // No session context (or Supabase unreachable) — fall through to cookies.
  }

  // 2) Short-lived personal staff cookie (re-validated against the DB).
  const staffToken = req.cookies.get(STAFF_COOKIE_NAME)?.value
  if (staffToken) {
    const v = await verifyToken<{ sub: string; email?: string }>('staff', staffToken)
    if (v.ok && typeof v.claims.sub === 'string') {
      try {
        const role = await staffRoleOf(createServiceClient(), v.claims.sub)
        if (role) return actor(v.claims.sub, 'staff_cookie', role, v.claims.email)
      } catch {
        /* fall through */
      }
    }
  }

  // 3) Break-glass signed cookie — unless switched off in platform settings.
  if (verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin' && (await getSetting('break_glass_enabled'))) {
    return actor('giga:super_admin', 'break_glass', 'super_admin')
  }

  return null
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

export type GigaGuard = { actor: GigaActor; response?: undefined } | { actor?: undefined; response: NextResponse }

/**
 * Authorize a GIGA-CRM request: a staff actor holding `permission` (all of
 * them, when an array is passed), and a same-origin request for mutations.
 */
export async function requireGiga(req: NextRequest, permission: Permission | Permission[]): Promise<GigaGuard> {
  if (!isSameOriginMutation(req)) {
    return { response: NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 }) }
  }
  const a = await getGigaActor(req)
  if (!a) return { response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  const needed = Array.isArray(permission) ? permission : [permission]
  const missing = needed.filter((p) => !hasPermission(a.role, p))
  if (missing.length) {
    return {
      response: NextResponse.json({ ok: false, error: 'Недостаточно прав', missing }, { status: 403 }),
    }
  }
  return { actor: a }
}

/** Current staff role of any user (for target checks). */
export async function staffRoleOfUser(userId: string): Promise<{ staffRole: StaffRole | null; profileRole: string | null; status: string | null; email: string | null }> {
  const sb = createServiceClient()
  const [{ data: profile }, { data: staff }] = await Promise.all([
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
