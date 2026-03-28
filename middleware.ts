import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

type UserRole = 'admin' | 'expert' | 'owner' | 'client' | 'super_admin'

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/auth/callback']

const GIGA_PANEL_PATH = '/admin-giga-panel'
const GIGA_LOGIN_PATH = '/giga-login'

const ADMIN_PATHS = [
  '/dashboard', '/gri', '/market', '/point-a', '/point-b',
  '/insights', '/competitors', '/metrics', '/settings',
  '/clients', '/reports', '/analytics', '/intelligence',
  '/team', '/notifications', '/profile', '/users', '/admin',
]
const EXPERT_PATHS = ['/expert']
const OWNER_PATHS  = ['/owner']
// Client portal — auth handled by Supabase session check on each page
const CLIENT_PATHS = ['/client']

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

  // ГИГА-Панель login page — always allow
  if (pathname === GIGA_LOGIN_PATH) {
    return NextResponse.next()
  }

  // Refresh Supabase session cookies and get current user
  const { supabaseResponse, user } = await updateSession(request)

  // Derive role from Supabase user metadata
  const role = (user?.user_metadata?.role ?? null) as UserRole | null

  // ГИГА-Панель: строгая изоляция — только super_admin
  // Fall back to legacy cookie for super_admin during migration period
  if (pathname.startsWith(GIGA_PANEL_PATH)) {
    const legacyRole = request.cookies.get('aistart360_role')?.value
    if (role !== 'super_admin' && legacyRole !== 'super_admin') {
      return NextResponse.redirect(new URL(GIGA_LOGIN_PATH, request.url))
    }
    return supabaseResponse
  }

  // Client portal — allow through (page-level auth check via Supabase)
  if (CLIENT_PATHS.some((p) => pathname.startsWith(p))) {
    return supabaseResponse
  }

  // Public auth pages
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  // Authenticated user visiting auth page → redirect to their panel
  if (isPublic && user) {
    const dest =
      role === 'admin'       ? '/dashboard' :
      role === 'owner'       ? '/owner/dashboard' :
      role === 'expert'      ? '/expert/dashboard' :
      role === 'client'      ? '/client/waiting-room' :
      role === 'super_admin' ? '/admin-giga-panel' :
                               '/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Not authenticated, accessing protected page → redirect to login
  if (!isPublic && !user) {
    // Also check legacy cookie during migration period
    const legacyRole = request.cookies.get('aistart360_role')?.value
    if (!legacyRole) {
      const url = new URL('/login', request.url)
      url.searchParams.set('from', pathname)
      return NextResponse.redirect(url)
    }
    // Legacy session present — allow through
    return supabaseResponse
  }

  // Role-based access control
  if (user) {
    // Expert → only expert paths
    if (role === 'expert' && ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/expert/dashboard', request.url))
    }
    // Owner → only owner paths
    if (
      role === 'owner' &&
      (ADMIN_PATHS.some((p) => pathname.startsWith(p)) ||
       EXPERT_PATHS.some((p) => pathname.startsWith(p)))
    ) {
      return NextResponse.redirect(new URL('/owner/dashboard', request.url))
    }
    // Client → only client paths
    if (
      role === 'client' &&
      (ADMIN_PATHS.some((p) => pathname.startsWith(p)) ||
       EXPERT_PATHS.some((p) => pathname.startsWith(p)) ||
       OWNER_PATHS.some((p) => pathname.startsWith(p)))
    ) {
      return NextResponse.redirect(new URL('/client/waiting-room', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
}
