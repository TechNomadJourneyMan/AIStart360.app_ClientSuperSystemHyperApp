import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { GIGA_COOKIE_NAME, verifyGigaRoleEdge } from '@/lib/giga-cookie-edge'

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/auth/callback', '/auth/reset-password']

const VALID_ROLES = ['admin', 'expert', 'owner', 'client', 'super_admin'] as const
type ValidRole = typeof VALID_ROLES[number]

const GIGA_PANEL_PATH = '/admin-giga-panel'
const GIGA_LOGIN_PATH = '/giga-login'

const ADMIN_PATHS = [
  '/dashboard', '/gri', '/market', '/point-a', '/point-b',
  '/insights', '/competitors', '/metrics', '/settings',
  '/clients', '/reports', '/analytics', '/intelligence',
  '/team', '/notifications', '/profile', '/users', '/admin',
]

// Paths inside the (dashboard) layout group that clients are allowed to access
const CLIENT_DASHBOARD_PATHS = [
  '/dashboard', '/gri', '/point-a', '/point-b',
  '/metrics', '/market', '/profile', '/notifications', '/settings',
]
const EXPERT_PATHS = ['/expert']
const OWNER_PATHS = ['/owner']
const CLIENT_PATHS = ['/client']
const PORTAL_PATHS = ['/portal']

function normalizeRole(rawRole: string | null | undefined): ValidRole {
  if (rawRole === 'admin' || rawRole === 'expert' || rawRole === 'owner' || rawRole === 'client' || rawRole === 'super_admin') {
    return rawRole
  }
  if (rawRole === 'manager' || rawRole === 'analyst') {
    return 'expert'
  }
  return 'client'
}

async function resolveRole(
  supabase: Awaited<ReturnType<typeof updateSession>>['supabase'],
  userId: string,
  fallbackRole: string | null,
) {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  return normalizeRole(typeof data?.role === 'string' ? data.role : fallbackRole)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow Next.js internals, static files, API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/logo') ||
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
  const role = user ? await resolveRole(supabase, user.id, metadataRole) : null
  
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

  // ── Role-based route protection ──
  if (user) {
    // Expert trying to access admin-only pages
    if (role === 'expert' && ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/expert/dashboard', request.url))
    }

    // Client trying to access admin/expert/owner pages
    if (
      role === 'client' &&
      (ADMIN_PATHS.some((p) => pathname.startsWith(p)) ||
       EXPERT_PATHS.some((p) => pathname.startsWith(p)) ||
       OWNER_PATHS.some((p) => pathname.startsWith(p)))
    ) {
      // Allow clients through to the shared (dashboard) layout routes
      if (CLIENT_DASHBOARD_PATHS.some((p) => pathname.startsWith(p))) {
        return response
      }
      // If it's not a client portal path, redirect to the cabinet (sidebar dashboard)
      if (!pathname.startsWith('/client')) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    }

    // Owner trying to access admin or expert pages
    if (
      role === 'owner' &&
      (ADMIN_PATHS.some((p) => pathname.startsWith(p)) || EXPERT_PATHS.some((p) => pathname.startsWith(p)))
    ) {
      return NextResponse.redirect(new URL('/owner/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
}
