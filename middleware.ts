import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((request) => {
  const { pathname } = request.nextUrl
  const isAuthenticated = !!request.auth

  const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password']
  const AUTH_ROUTES   = ['/login', '/register']

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

  if (isAuthenticated && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (!isAuthenticated && !PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
