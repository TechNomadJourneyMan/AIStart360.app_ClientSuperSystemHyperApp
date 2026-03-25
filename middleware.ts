import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware — reads a lightweight cookie `aistart360_role` set by the client
 * after login (see AuthProvider). Used for SSR-level route protection.
 *
 * Replace with NextAuth `auth()` when real backend is connected.
 */

const PUBLIC_PATHS  = ['/login', '/register', '/forgot-password']
const ADMIN_PATHS   = [
  '/dashboard', '/gri', '/market', '/point-a', '/point-b',
  '/insights', '/competitors', '/metrics', '/settings',
  '/clients', '/reports', '/analytics', '/intelligence',
  '/team', '/notifications', '/profile', '/users',
]
const EXPERT_PATHS  = ['/expert']
const OWNER_PATHS   = ['/owner']

export function middleware(request: NextRequest) {
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

  // Public auth pages
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  // Read role cookie (set from client after localStorage login)
  const roleCookie = request.cookies.get('aistart360_role')
  const role = roleCookie?.value as 'admin' | 'expert' | 'owner' | undefined

  // Authenticated user visiting auth page → redirect to correct panel
  if (isPublic && role) {
    const dest = role === 'admin' ? '/dashboard' : role === 'owner' ? '/owner/dashboard' : '/expert/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Not authenticated, accessing protected page → redirect to login
  if (!isPublic && !role) {
    const url = new URL('/login', request.url)
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  // Expert trying to access admin-only pages → redirect to expert panel
  if (
    role === 'expert' &&
    ADMIN_PATHS.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.redirect(new URL('/expert/dashboard', request.url))
  }

  // Owner trying to access admin or expert pages → redirect to owner panel
  if (
    role === 'owner' &&
    (ADMIN_PATHS.some((p) => pathname.startsWith(p)) || EXPERT_PATHS.some((p) => pathname.startsWith(p)))
  ) {
    return NextResponse.redirect(new URL('/owner/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
}
