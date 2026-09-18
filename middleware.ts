import { NextResponse } from 'next/server'
import type { NextFetchEvent, NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { GIGA_COOKIE_NAME, verifyGigaRoleEdge } from '@/lib/giga-cookie-edge'
import { MFA_COOKIE_NAME, verifyStepUpEdge } from '@/lib/mfa/step-up-edge'
import { isJourneyPublicDemoEnabled } from '@/lib/journey/public-demo'
import { IMP_COOKIE_NAME, READ_ONLY_POST_API, isViewModeAllowed, readImpersonation } from '@/lib/impersonation/token'
import { auditImpersonatedRequestEdge, endImpersonationEdge, isImpersonationActiveEdge } from '@/lib/impersonation/edge'
import { verifyToken } from '@/lib/security/signed-token'
import { blockedSectionFor } from '@/lib/platform/sections-edge'
import { edgeSettings } from '@/lib/settings/edge'

const STAFF_COOKIE_NAME = 'aistart360_giga_staff'
const IMP_ENDED_PATH = '/admin-giga-panel/impersonation'
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Redirect that keeps cookie changes (e.g. a sign-out) made on `from`. */
function redirectKeepingCookies(from: NextResponse, url: URL): NextResponse {
  const res = NextResponse.redirect(url)
  for (const c of from.cookies.getAll()) res.cookies.set(c)
  return res
}

/**
 * Impersonation on API calls: view mode is read-only (mutations → 403), an
 * expired/closed session cannot mutate (→ 401), and every mutation in edit
 * mode leaves an audit row. Staff API (/api/giga-admin) is not affected.
 */
async function guardImpersonatedApi(request: NextRequest, later: (p: Promise<unknown>) => void): Promise<NextResponse | null> {
  const token = request.cookies.get(IMP_COOKIE_NAME)?.value
  const method = request.method.toUpperCase()
  const { pathname } = request.nextUrl
  if (!token || !MUTATING.has(method) || pathname.startsWith('/api/giga-admin/')) return null
  if (pathname === '/api/v1/impersonation/exit') return null
  const v = await readImpersonation(token)
  if (!v.ok || !(await isImpersonationActiveEdge(v.claims.sid))) {
    return NextResponse.json({ ok: false, error: 'Сессия просмотра от имени пользователя завершена' }, { status: 401 })
  }
  if (v.claims.mode === 'view' && !isViewModeAllowed(pathname)) {
    return NextResponse.json({ ok: false, error: 'Режим просмотра: изменения запрещены' }, { status: 403 })
  }
  if (pathname !== '/api/v1/events' && !READ_ONLY_POST_API.includes(pathname)) {
    later(auditImpersonatedRequestEdge({
      sid: v.claims.sid,
      adminId: v.claims.aid,
      adminLabel: v.claims.alabel,
      adminRole: typeof v.claims.arole === 'string' ? v.claims.arole : null,
      targetUserId: v.claims.uid,
      method,
      path: pathname,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      ua: request.headers.get('user-agent')?.slice(0, 300) || null,
    }))
  }
  return null
}

const MFA_CHALLENGE_PATH = '/2fa'
const IS_PUBLIC_JOURNEY_PREVIEW =
  process.env.NODE_ENV !== 'production' ||
  process.env.VERCEL_ENV === 'preview' ||
  isJourneyPublicDemoEnabled()

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/auth/callback', '/auth/reset-password']

const VALID_ROLES = ['admin', 'expert', 'owner', 'client', 'super_admin'] as const
type ValidRole = typeof VALID_ROLES[number]

const GIGA_PANEL_PATH = '/admin-giga-panel'
const GIGA_LOGIN_PATH = '/giga-login'

const ADMIN_PATHS = [
  '/dashboard', '/gri', '/market', '/point-a', '/point-b', '/simulator',
  '/insights', '/competitors', '/metrics', '/settings',
  '/clients', '/reports', '/analytics', '/intelligence',
  '/team', '/notifications', '/profile', '/users', '/admin', '/activity',
  // Staff-only legacy GRI forecast tool. (/pulse is client-facing — see
  // CLIENT_DASHBOARD_PATHS — its API scopes data per role.)
  '/ai-scanner',
]

// Paths inside the (dashboard) layout group that clients are allowed to access
const CLIENT_DASHBOARD_PATHS = [
  '/dashboard', '/gri', '/pulse', '/point-a', '/point-b', '/simulator',
  '/metrics', '/market', '/profile', '/notifications', '/settings', '/activity',
]
const EXPERT_PATHS = ['/expert']
const OWNER_PATHS = ['/owner']

// Whole-segment route matching: '/clients' must NOT match the '/client'
// cabinet prefix (and vice versa) — plain startsWith leaks across routes.
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + '/')
}
const matchesAny = (pathname: string, routes: string[]) =>
  routes.some((r) => matchesRoute(pathname, r))

function normalizeRole(rawRole: string | null | undefined): ValidRole {
  if (rawRole === 'admin' || rawRole === 'expert' || rawRole === 'owner' || rawRole === 'client' || rawRole === 'super_admin') {
    return rawRole
  }
  if (rawRole === 'manager' || rawRole === 'analyst') {
    return 'expert'
  }
  return 'client'
}

async function resolveRoleAndStatus(
  supabase: Awaited<ReturnType<typeof updateSession>>['supabase'],
  userId: string,
  fallbackRole: string | null,
): Promise<{ role: ValidRole; status: string | null }> {
  const { data } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', userId)
    .maybeSingle()

  return {
    role: normalizeRole(typeof data?.role === 'string' ? data.role : fallbackRole),
    status: typeof data?.status === 'string' ? data.status : null,
  }
}

export async function middleware(request: NextRequest, event?: NextFetchEvent) {
  // Background work that must outlive the response (audit writes).
  const later = (p: Promise<unknown>) => { if (event) event.waitUntil(p); else void p }
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/api')) {
    const blocked = await guardImpersonatedApi(request, later)
    if (blocked) return blocked
  }

  // Allow Next.js internals, static files, API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    // Vercel Workflow invokes its generated step endpoints without an
    // application user session. Sending these internal calls through the
    // dashboard auth gate would redirect them to /login and leave every Meta
    // message workflow stuck after the webhook ACK.
    pathname.startsWith('/.well-known/workflow/') ||
    pathname.startsWith('/logo') ||
    pathname.startsWith('/fonts') ||
    // Static assets in public/ must skip the network auth (getUser + profiles):
    // otherwise every font/audio/css/js request pays 2 round-trips and, for
    // anonymous callers, gets 307→/login — which breaks SW precache and serves
    // HTML for a .ttf. public/ has no private files.
    /\.(svg|png|jpg|jpeg|gif|webp|ico|m4a|mp3|ttf|otf|woff|woff2|css|js|map|txt|xml)$/.test(pathname) ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    // PWA service worker, workbox runtime and web manifest must be served as-is
    // (no auth redirect) or SW registration / install fails.
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/workbox-') ||
    pathname.startsWith('/swe-worker-') ||
    pathname.startsWith('/fallback-') ||
    pathname === '/' ||
    pathname.startsWith('/presentation') ||
    // Isolated AI-first lab: anonymous access is limited to local development,
    // Vercel Preview, or an explicitly configured public demo deployment.
    // Canonical production keeps the normal Supabase gate because the flag is
    // absent there.
    (IS_PUBLIC_JOURNEY_PREVIEW && matchesRoute(pathname, '/journey')) ||
    pathname.startsWith('/gri-free') ||
    // Public legal pages — linked from the registration consent checkbox.
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname === '/maintenance' ||
    // Public read-only shared report links (/r/<token>) — no auth required.
    pathname === '/r' ||
    pathname.startsWith('/r/') ||
    // Demo acquiring + checkout outcome pages must render for anonymous visitors
    // (the stub is a public payment-flow demo; success/cancel may be hit pre-auth).
    pathname.startsWith('/checkout/stub') ||
    pathname.startsWith('/checkout/success') ||
    pathname.startsWith('/checkout/cancel')
  ) {
    return NextResponse.next()
  }

  // Refresh Supabase session cookies and get current user
  const { supabase, response, user } = await updateSession(request)

  const metadataRole = user && typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : null
  const resolved = user ? await resolveRoleAndStatus(supabase, user.id, metadataRole) : null
  const role = resolved?.role ?? null

  // ── Impersonation («кабинет от имени пользователя») ──
  // The browser holds the target's session; the signed cookie says an admin is
  // driving it. Anything stale ends the session and returns to the panel.
  let impersonating = false
  const impToken = request.cookies.get(IMP_COOKIE_NAME)?.value
  if (impToken) {
    const imp = await readImpersonation(impToken)
    const claims = imp.claims
    const failReason = imp.ok ? 'closed' : imp.reason
    const ownsSession = !!claims && !!user && user.id === claims.uid
    if (imp.ok && ownsSession && (await isImpersonationActiveEdge(imp.claims.sid))) {
      impersonating = true
      response.headers.set('x-impersonation', imp.claims.mode)
    } else if (claims && ownsSession) {
      // Authentic but expired / closed from the panel: drop the user session.
      if (failReason === 'expired') later(endImpersonationEdge(claims.sid, 'expired'))
      await supabase.auth.signOut()
      response.cookies.delete(IMP_COOKIE_NAME)
      const url = new URL(IMP_ENDED_PATH, request.url)
      url.searchParams.set('ended', failReason === 'expired' ? 'expired' : 'closed')
      const out = redirectKeepingCookies(response, url)
      out.cookies.delete(IMP_COOKIE_NAME)
      return out
    } else {
      // Forged, or left over after the admin session changed hands.
      response.cookies.delete(IMP_COOKIE_NAME)
    }
  }

  // R4: a persistently blocked/archived user gets no further than the login
  // page, regardless of role or which route they hit. The GoTrue ban (set by
  // the block route) kills token refresh; this check covers still-live access
  // tokens for the remainder of their lifetime.
  if (user && (resolved?.status === 'blocked' || resolved?.status === 'archived')) {
    await supabase.auth.signOut()
    const url = new URL('/login', request.url)
    url.searchParams.set('blocked', '1')
    return NextResponse.redirect(url)
  }

  if (role) {
    response.headers.set('x-user-role', role)
  }

  // Public auth pages (login, register, etc.)
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isGigaLogin = pathname === GIGA_LOGIN_PATH
  const hasApprovedPersonalGigaAccess =
    Boolean(user) && role === 'super_admin' && resolved?.status === 'approved'

  // A2b: the giga gate is the HMAC-SIGNED `aistart360_giga` cookie, verified
  // here on the Edge runtime via Web Crypto. The unsigned `aistart360_role`
  // string is NO LONGER accepted for giga access.
  // The shared-password entry can be switched off in platform settings.
  const hasGigaAccess =
    (await verifyGigaRoleEdge(request.cookies.get(GIGA_COOKIE_NAME)?.value)) === 'super_admin' &&
    (await edgeSettings()).break_glass_enabled

  if (isGigaLogin) {
    if (hasApprovedPersonalGigaAccess || hasGigaAccess) {
      return NextResponse.redirect(new URL(GIGA_PANEL_PATH, request.url))
    }
    return response // allow access to login page
  }

  // ГИГА-Панель: только персонал (super_admin, роль из staff_roles, личный
  // staff-cookie во время impersonation или break-glass). Права по разделам
  // проверяет каждый API-маршрут (lib/admin/rbac.ts).
  if (pathname.startsWith(GIGA_PANEL_PATH)) {
    let isStaff = role === 'super_admin' || hasGigaAccess
    if (!isStaff) {
      const staffToken = request.cookies.get(STAFF_COOKIE_NAME)?.value
      if (staffToken && (await verifyToken('staff', staffToken)).ok) isStaff = true
    }
    if (!isStaff && user && !impersonating) {
      const { data: staffRow } = await supabase.from('staff_roles').select('role').eq('user_id', user.id).maybeSingle()
      isStaff = !!staffRow
    }
    if (!isStaff) {
      return NextResponse.redirect(new URL(GIGA_LOGIN_PATH, request.url))
    }
    // A personal super_admin session that enrolled in 2FA must pass the step-up
    // here too — this branch returns early, so the general MFA gate below was
    // never reached and the most privileged surface was the one skipping 2FA.
    // (Break-glass entry has no Supabase user and is unaffected.)
    if (user && !impersonating && !hasGigaAccess) {
      const gigaMeta = user.user_metadata as Record<string, unknown> | undefined
      const enrolled = gigaMeta?.mfa_totp === true || gigaMeta?.mfa_webauthn === true
      if (enrolled && !(await verifyStepUpEdge(request.cookies.get(MFA_COOKIE_NAME)?.value, user.id))) {
        const url = new URL(MFA_CHALLENGE_PATH, request.url)
        url.searchParams.set('from', pathname)
        return NextResponse.redirect(url)
      }
      // Platform setting: staff without 2FA must enrol before using the panel.
      if (!enrolled && (await edgeSettings()).staff_require_mfa) {
        const url = new URL('/settings', request.url)
        url.searchParams.set('tab', 'security')
        url.searchParams.set('mfa', 'required')
        return NextResponse.redirect(url)
      }
    }
    return response
  }

  // Authenticated user visiting auth page → redirect to correct panel
  if (isPublic && role) {
    const dest =
      role === 'super_admin' ? '/admin-giga-panel' :
      role === 'admin' ? '/dashboard' :
      role === 'owner' ? '/owner/dashboard' :
      role === 'client' ? '/dashboard' :
      '/expert/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Not authenticated, accessing protected page → redirect to login.
  // A7: the legacy `aistart360_role` cookie bypass has been REMOVED — route-group
  // protection now always requires a valid Supabase session. (The giga-panel
  // path is handled above via its dedicated signed cookie and returns early.)
  if (!isPublic && !user) {
    const url = new URL('/login', request.url)
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  // ── MFA step-up gate ──
  // A user who enabled TOTP must pass the second-factor challenge once per
  // session before any protected page. The `mfa_totp` flag lives in the
  // (server-verified) Supabase JWT; the proof is the signed step-up cookie.
  // `/2fa` and public pages are exempt so there is no redirect loop.
  const meta = user?.user_metadata as Record<string, unknown> | undefined
  const mfaEnrolled = meta?.mfa_totp === true || meta?.mfa_webauthn === true
  if (
    user &&
    !isPublic &&
    pathname !== MFA_CHALLENGE_PATH &&
    mfaEnrolled &&
    // The admin cannot (and must not) answer the user's second factor; the
    // session was minted server-side after the admin's own authorization.
    !impersonating
  ) {
    const passed = await verifyStepUpEdge(request.cookies.get(MFA_COOKIE_NAME)?.value, user.id)
    if (!passed) {
      const url = new URL(MFA_CHALLENGE_PATH, request.url)
      url.searchParams.set('from', pathname)
      return NextResponse.redirect(url)
    }
  }

  // ── Maintenance mode (platform settings): client cabinets are closed ──
  // Staff, experts and an admin driving a cabinet keep working.
  if (user && (role === 'client' || role === 'owner') && !impersonating && !isPublic && pathname !== MFA_CHALLENGE_PATH) {
    if ((await edgeSettings()).maintenance.enabled) {
      return redirectKeepingCookies(response, new URL('/maintenance', request.url))
    }
  }

  // ── Platform sections managed in GIGA-CRM (enabled flag + audience) ──
  // Applies to client accounts (and to an admin driving a client's cabinet).
  if (user && role === 'client' && !pathname.startsWith('/client/home')) {
    const blockedKey = await blockedSectionFor(pathname, user.id)
    if (blockedKey) {
      const url = new URL('/client/home', request.url)
      url.searchParams.set('unavailable', blockedKey)
      return NextResponse.redirect(url)
    }
  }

  // ── Role-based route protection ──
  if (user) {
    // Expert trying to access admin-only pages
    if (role === 'expert' && matchesAny(pathname, ADMIN_PATHS)) {
      return NextResponse.redirect(new URL('/expert/dashboard', request.url))
    }

    // Client trying to access admin/expert/owner pages
    if (
      role === 'client' &&
      (matchesAny(pathname, ADMIN_PATHS) ||
       matchesAny(pathname, EXPERT_PATHS) ||
       matchesAny(pathname, OWNER_PATHS))
    ) {
      // Allow clients through to the shared (dashboard) layout routes
      if (matchesAny(pathname, CLIENT_DASHBOARD_PATHS)) {
        return response
      }
      // If it's not a client portal path, redirect to the cabinet (sidebar dashboard)
      if (!matchesRoute(pathname, '/client')) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    }

    // Owner trying to access admin or expert pages
    if (
      role === 'owner' &&
      (matchesAny(pathname, ADMIN_PATHS) || matchesAny(pathname, EXPERT_PATHS))
    ) {
      return NextResponse.redirect(new URL('/owner/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.svg|.*\\.png).*)',
  ],
}
