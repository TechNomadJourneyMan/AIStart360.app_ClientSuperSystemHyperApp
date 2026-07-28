import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import {
  normalizePortalRole,
  ownerRouteForLegacyClientPath,
  portalHomeFor,
  type PortalRole,
} from '@/lib/portal-routing'

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/auth/callback', '/auth/reset-password']

const GIGA_PANEL_PATH = '/admin-giga-panel'
const GIGA_LOGIN_PATH = '/giga-login'

const ADMIN_PATHS = [
  '/dashboard', '/gri', '/market', '/point-a', '/point-b',
  '/insights', '/competitors', '/metrics', '/settings',
  '/clients', '/reports', '/analytics', '/intelligence',
  '/team', '/notifications', '/profile', '/users', '/admin',
]
const EXPERT_PATHS = ['/expert']
const OWNER_PATHS = ['/owner']
const CLIENT_PATHS = ['/client']
const PORTAL_PATHS = ['/portal']
const KNOWN_LEGACY_ROLES = new Set(['admin', 'expert', 'owner', 'client', 'super_admin', 'manager', 'analyst'])

async function resolveProfile(
  supabase: Awaited<ReturnType<typeof updateSession>>['supabase'],
  userId: string,
  fallbackRole: string | null,
): Promise<{ role: PortalRole; status: string | null }> {
  const { data } = await supabase
    .from('profiles')
    .select('role,status')
    .eq('id', userId)
    .maybeSingle()

  return {
    role: normalizePortalRole(typeof data?.role === 'string' ? data.role : fallbackRole),
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
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname === '/'
  ) {
    return NextResponse.next()
  }

  // Refresh Supabase session cookies and get current user
  const { supabase, response, user } = await updateSession(request)

  const metadataRole = user && typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : null
  const profile = user ? await resolveProfile(supabase, user.id, metadataRole) : null
  const role = profile?.role ?? null
  
  if (role) {
    response.headers.set('x-user-role', role)
  }

  // Public auth pages (login, register, etc.)
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isGigaLogin = pathname === GIGA_LOGIN_PATH

  if (isGigaLogin) {
    if (user && role === 'super_admin') {
      return NextResponse.redirect(new URL(GIGA_PANEL_PATH, request.url))
    }
    return response // allow access to login page
  }

  // ГИГА-Панель: строгая изоляция — только SUPER_ADMIN
  if (pathname.startsWith(GIGA_PANEL_PATH)) {
    // Also check legacy cookie during migration
    const legacyRole = request.cookies.get('aistart360_role')?.value
    if (role !== 'super_admin' && legacyRole !== 'super_admin') {
      return NextResponse.redirect(new URL(GIGA_LOGIN_PATH, request.url))
    }
    return response
  }

  // Authenticated user visiting auth page → redirect to correct panel
  if (isPublic && role) {
    const dest = portalHomeFor(role, profile?.status)
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Not authenticated, accessing protected page → redirect to login
  if (!isPublic && !user) {
    // Check legacy cookie fallback
    const legacyRole = request.cookies.get('aistart360_role')?.value
    if (!legacyRole || !KNOWN_LEGACY_ROLES.has(legacyRole)) {
      const url = new URL('/login', request.url)
      url.searchParams.set('from', `${pathname}${request.nextUrl.search}`)
      return NextResponse.redirect(url)
    }
    // Legacy session present — allow through for now
    return response
  }

  // ── Role-based route protection ──
  if (user) {
    if (
      role !== 'client' &&
      role !== 'owner' &&
      CLIENT_PATHS.some((path) => pathname.startsWith(path))
    ) {
      return NextResponse.redirect(new URL(portalHomeFor(role, profile?.status), request.url))
    }

    const applicantPaths = ['/client/waiting-room', '/client/onboarding', '/client/point-a']
    const isApplicantPath = applicantPaths.some((path) => pathname.startsWith(path))
    if (role === 'client' && profile?.status !== 'approved' && !isApplicantPath) {
      return NextResponse.redirect(new URL('/client/waiting-room', request.url))
    }

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
      // If it's not a client portal path, redirect to waiting-room
      if (!pathname.startsWith('/client')) {
        return NextResponse.redirect(new URL('/client/waiting-room', request.url))
      }
    }

    // Owner trying to access admin or expert pages
    if (
      role === 'owner' &&
      (ADMIN_PATHS.some((p) => pathname.startsWith(p)) || EXPERT_PATHS.some((p) => pathname.startsWith(p)))
    ) {
      return NextResponse.redirect(new URL('/owner/dashboard', request.url))
    }

    if (role === 'owner' && CLIENT_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL(ownerRouteForLegacyClientPath(pathname), request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
}
