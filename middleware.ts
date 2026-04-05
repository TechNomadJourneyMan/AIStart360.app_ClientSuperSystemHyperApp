import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/auth/callback', '/auth/reset-password']

<<<<<<< HEAD
// Client portal routes (waiting-room, onboarding, point-a) — accessible only to 'client' role
// But since current auth uses localStorage (not cookies for client role),
// we just allow them through and let the page handle auth checks via Supabase/localStorage.
=======
const VALID_ROLES = ['admin', 'expert', 'owner', 'client', 'super_admin'] as const
type ValidRole = typeof VALID_ROLES[number]
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace

// ГИГА-Панель — доступна только SUPER_ADMIN (cookie aistart360_role === 'super_admin')
const GIGA_PANEL_PATH = '/admin-giga-panel'

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

  // Allow Next.js internals, static files, logos, API
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

  const { supabase, response, user } = await updateSession(request)

<<<<<<< HEAD
  // ГИГА-Панель: строгая изоляция — только SUPER_ADMIN
  if (pathname.startsWith(GIGA_PANEL_PATH)) {
    const role = request.cookies.get('aistart360_role')?.value
    if (role !== 'super_admin') {
      return NextResponse.redirect(new URL('/giga-login', request.url))
    }
    return NextResponse.next()
  }

  // Client portal pages — allow through (auth handled client-side via Supabase)
  const isClientPortal = pathname.startsWith('/client')
  if (isClientPortal) {
    return NextResponse.next()
=======
  const metadataRole = user && typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : null
  const role = user ? await resolveRole(supabase, user.id, metadataRole) : null
  if (role) {
    response.headers.set('x-user-role', role)
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
  }

  // Public auth pages
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isGigaLogin = pathname === '/giga-login'

<<<<<<< HEAD
  // Read role cookie (set from client after localStorage login)
  const roleCookie = request.cookies.get('aistart360_role')
  const role = roleCookie?.value as 'admin' | 'expert' | 'owner' | 'client' | undefined
=======
  if (isGigaLogin && !user) {
    return response
  }

  if (isGigaLogin && role !== 'super_admin') {
    return response
  }

  if (isGigaLogin && role === 'super_admin') {
    return NextResponse.redirect(new URL('/admin-giga-panel', request.url))
  }

  if (pathname.startsWith(GIGA_PANEL_PATH) && role !== 'super_admin') {
    return NextResponse.redirect(new URL('/giga-login', request.url))
  }
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace

  // Authenticated user visiting auth page → redirect to correct panel
  if (isPublic && role && VALID_ROLES.includes(role)) {
    const dest =
      role === 'admin' ? '/dashboard' :
      role === 'owner' ? '/owner/dashboard' :
<<<<<<< HEAD
      role === 'client' ? '/dashboard' :
=======
      role === 'client' ? '/client/waiting-room' :
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
      '/expert/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Not authenticated, accessing protected page → redirect to login
  if (!isPublic && !role && !isClientPortal) {
    const url = new URL('/login', request.url)
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  // ── Role-based route protection ──

  // Client routes: only accessible to 'client' role
  if (CLIENT_PATHS.some((p) => pathname.startsWith(p))) {
    if (role !== 'client') {
      const dest =
        role === 'admin' ? '/dashboard' :
        role === 'owner' ? '/owner/dashboard' :
        '/expert/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    return response
  }

  // Expert trying to access admin-only pages → redirect to expert panel
  if (role === 'expert' && ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/expert/dashboard', request.url))
  }

<<<<<<< HEAD
  // Client trying to access pure admin pages → redirect to dashboard
  if (role === 'client' && ['/clients', '/team', '/users', '/admin'].some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
=======
  // Client trying to access admin/expert pages → redirect to client portal
  if (role === 'client' && (ADMIN_PATHS.some((p) => pathname.startsWith(p)) || EXPERT_PATHS.some((p) => pathname.startsWith(p)))) {
    return NextResponse.redirect(new URL('/client/waiting-room', request.url))
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
  }

  // Owner trying to access admin or expert pages → redirect to owner panel
  if (
    role === 'owner' &&
    (ADMIN_PATHS.some((p) => pathname.startsWith(p)) || EXPERT_PATHS.some((p) => pathname.startsWith(p)))
  ) {
    return NextResponse.redirect(new URL('/owner/dashboard', request.url))
  }

  if (PORTAL_PATHS.some((p) => pathname.startsWith(p)) && !role) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
}
