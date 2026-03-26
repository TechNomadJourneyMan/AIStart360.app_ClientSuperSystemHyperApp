import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { NextResponse } from 'next/server'

const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS  = ['/login', '/register', '/forgot-password']
const ADMIN_PATHS   = [
  '/dashboard', '/gri', '/market', '/point-a', '/point-b',
  '/insights', '/competitors', '/metrics', '/settings',
  '/clients', '/reports', '/analytics', '/intelligence',
  '/team', '/notifications', '/profile', '/users',
]
const EXPERT_PATHS  = ['/expert']
const OWNER_PATHS   = ['/owner']

export default auth((request) => {
  const { pathname } = request.nextUrl
  const isAuthenticated = !!request.auth
  const userRole = (request.auth?.user as any)?.role?.toLowerCase()

  // Allow Next.js internals, static files, logos
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

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  // Authenticated user visiting auth page → redirect to correct panel
  if (isPublic && isAuthenticated && userRole) {
    const dest = userRole === 'admin' ? '/dashboard' : userRole === 'owner' ? '/owner/dashboard' : '/expert/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Not authenticated, accessing protected page → redirect to login
  if (!isPublic && !isAuthenticated) {
    const url = new URL('/login', request.url)
    url.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(url)
  }

  // Expert trying to access admin-only pages → redirect to expert panel
  if (
    userRole === 'expert' &&
    ADMIN_PATHS.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.redirect(new URL('/expert/dashboard', request.url))
  }

  // Owner trying to access admin or expert pages → redirect to owner panel
  if (
    userRole === 'owner' &&
    (ADMIN_PATHS.some((p) => pathname.startsWith(p)) || EXPERT_PATHS.some((p) => pathname.startsWith(p)))
  ) {
    return NextResponse.redirect(new URL('/owner/dashboard', request.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
