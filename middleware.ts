import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { GIGA_COOKIE_NAME, verifyGigaRoleEdge } from '@/lib/giga-cookie-edge'
import { MFA_COOKIE_NAME, verifyStepUpEdge } from '@/lib/mfa/step-up-edge'
import { roleLandingPath, WAITING_ROOM_PATH } from '@/lib/role-landing'
import { isJourneyPublicDemoEnabled } from '@/lib/journey/public-demo'

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

// Paths a client whose profile is not `approved` yet may still open: the
// waiting room itself, the vertical picker, the onboarding questionnaire
// (generic / medical / e-commerce, including its /documents step), the
// read-back of their own answers and the MFA challenge. The '-medical' /
// '-ecommerce' variants are separate entries because route matching is
// whole-segment.
// '/client/welcome' is the picker that routes into the medical / e-commerce
// questionnaires — without it those two forms are unreachable through the UI
// for exactly the users the open questionnaire is meant for.
const CLIENT_PENDING_PATHS = [
  WAITING_ROOM_PATH,
  '/client/welcome',
  '/client/onboarding',
  '/client/onboarding-medical',
  '/client/onboarding-ecommerce',
  '/client/my-data',
  MFA_CHALLENGE_PATH,
]

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

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

  // A rejected client is out of the funnel: end the session and drop them on
  // the login page with a notice. Signing out is what breaks the bounce — a
  // still-authenticated rejected user would be redirected from /login back
  // into the cabinet on every request. Unlike blocked/archived users there is
  // no GoTrue ban here, so the cleared auth cookies are carried over onto the
  // redirect (signOut writes them to `response`, which we do not return).
  if (user && role === 'client' && resolved?.status === 'rejected') {
    await supabase.auth.signOut()
    const url = new URL('/login', request.url)
    url.searchParams.set('rejected', '1')
    const rejectedResponse = NextResponse.redirect(url)
    response.cookies.getAll().forEach((cookie) => rejectedResponse.cookies.set(cookie))
    return rejectedResponse
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
  const hasGigaAccess =
    (await verifyGigaRoleEdge(request.cookies.get(GIGA_COOKIE_NAME)?.value)) === 'super_admin'

  if (isGigaLogin) {
    if (hasApprovedPersonalGigaAccess || hasGigaAccess) {
      return NextResponse.redirect(new URL(GIGA_PANEL_PATH, request.url))
    }
    return response // allow access to login page
  }

  // ГИГА-Панель: строгая изоляция — только SUPER_ADMIN
  if (pathname.startsWith(GIGA_PANEL_PATH)) {
    if (!hasApprovedPersonalGigaAccess && !hasGigaAccess) {
      return NextResponse.redirect(new URL(GIGA_LOGIN_PATH, request.url))
    }
    // Break-glass has no personal session to step up with MFA. An approved
    // personal super_admin continues below so the normal MFA gate applies.
    if (!hasApprovedPersonalGigaAccess) return response
  }

  // Authenticated user visiting auth page → redirect to correct panel.
  // FE-06: the destination comes from roleLandingPath — the same helper the
  // login and register pages use — so the three flows can no longer diverge.
  // It also honours the approval status we already read from `profiles`.
  if (isPublic && role) {
    return NextResponse.redirect(new URL(roleLandingPath(role, resolved?.status), request.url))
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
    mfaEnrolled
  ) {
    const passed = await verifyStepUpEdge(request.cookies.get(MFA_COOKIE_NAME)?.value, user.id)
    if (!passed) {
      const url = new URL(MFA_CHALLENGE_PATH, request.url)
      url.searchParams.set('from', pathname)
      return NextResponse.redirect(url)
    }
  }

  // ── Approval gate ──
  // Until `profiles.status` says 'approved', a client sees the waiting room and
  // the onboarding questionnaire only — pending_approval / requires_clarification
  // used to walk the whole portal. The questionnaire routes stay open on purpose:
  // filling it in is exactly what moves the request forward.
  // (blocked/archived/rejected returned earlier; public pages never reach this
  // point — an authenticated user is redirected off them above.)
  if (
    user &&
    role === 'client' &&
    resolved?.status !== 'approved' &&
    !matchesAny(pathname, CLIENT_PENDING_PATHS)
  ) {
    return NextResponse.redirect(new URL(WAITING_ROOM_PATH, request.url))
  }

  // ── Role-based route protection ──
  if (user) {
    // Expert trying to access admin- or owner-only pages
    if (
      role === 'expert' &&
      (matchesAny(pathname, ADMIN_PATHS) || matchesAny(pathname, OWNER_PATHS))
    ) {
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
      // Staff-only page → back to the shared cabinet (sidebar dashboard).
      // No '/client' exception is needed here: matchesRoute is whole-segment,
      // so a /client/* cabinet path never enters this branch in the first place
      // (only '/clients' does, and that one is admin-only).
      return NextResponse.redirect(new URL('/dashboard', request.url))
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
