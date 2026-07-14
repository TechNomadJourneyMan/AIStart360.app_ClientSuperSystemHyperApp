import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { GIGA_COOKIE_NAME, verifyGigaRoleEdge } from '@/lib/giga-cookie-edge'
import { MFA_COOKIE_NAME, verifyStepUpEdge } from '@/lib/mfa/step-up-edge'

const MFA_CHALLENGE_PATH = '/2fa'
const IS_PUBLIC_JOURNEY_PREVIEW =
  process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV === 'preview'
const IS_PUBLIC_JOURNEY_PREVIEW =
  process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV === 'preview'

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow Next.js internals, static files, API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
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
    // Isolated AI-first lab: anonymous access is limited to local development
    // and Vercel Preview deployments. The production target keeps the normal
    // Supabase session gate.
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

  if (role) {
    response.headers.set('x-user-role', role)
  }

  // Public auth pages (login, register, etc.)
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isGigaLogin = pathname === GIGA_LOGIN_PATH

  // A2b: the giga gate is the HMAC-SIGNED `aistart360_giga` cookie, verified
  // here on the Edge runtime via Web Crypto. The unsigned `aistart360_role`
  // string is NO LONGER accepted for giga access.
  const hasGigaAccess =
    (await verifyGigaRoleEdge(request.cookies.get(GIGA_COOKIE_NAME)?.value)) === 'super_admin'

  if (isGigaLogin) {
    if ((user && role === 'super_admin') || hasGigaAccess) {
      return NextResponse.redirect(new URL(GIGA_PANEL_PATH, request.url))
    }
    return response // allow access to login page
  }

  // ГИГА-Панель: строгая изоляция — только SUPER_ADMIN
  if (pathname.startsWith(GIGA_PANEL_PATH)) {
    if (role !== 'super_admin' && !hasGigaAccess) {
      return NextResponse.redirect(new URL(GIGA_LOGIN_PATH, request.url))
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
    mfaEnrolled
  ) {
    const passed = await verifyStepUpEdge(request.cookies.get(MFA_COOKIE_NAME)?.value, user.id)
    if (!passed) {
      const url = new URL(MFA_CHALLENGE_PATH, request.url)
      url.searchParams.set('from', pathname)
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
}
