import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/auth/callback', '/auth/reset-password']

const VALID_ROLES = ['admin', 'expert', 'owner', 'client', 'super_admin'] as const
type ValidRole = typeof VALID_ROLES[number]

// ГИГА-Панель — доступна только SUPER_ADMIN
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

  const metadataRole = user && typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : null
  const role = user ? await resolveRole(supabase, user.id, metadataRole) : null
  
  if (role) {
    response.headers.set('x-user-role', role)
  }

  // Public auth pages
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isGigaLogin = pathname === '/giga-login'

  if (isGigaLogin) {
    if (user && role === 'super_admin') {
      return NextResponse.redirect(new URL('/admin-giga-panel', request.url))
    }
    return response // allow access to login page
  }

  // ГИГА-Панель: строгая изоляция — только SUPER_ADMIN
  if (pathname.startsWith(GIGA_PANEL_PATH)) {
    if (role !== 'super_admin') {
      return NextResponse.redirect(new URL('/giga-login', request.url))
    }
    return response
  }

  // Client portal pages (waiting-room, onboarding, point-a)
  const isClientPortal = pathname.startsWith('/client')
  if (isClientPortal) {
    if (role !== 'client') {
       // redirect to appropriate dashboard if not client
       if (role === 'admin' || role === 'super_admin') return NextResponse.redirect(new URL('/dashboard', request.url))
       if (role === 'expert') return NextResponse.redirect(new URL('/expert/dashboard', request.url))
       if (role === 'owner') return NextResponse.redirect(new URL('/owner/dashboard', request.url))
       // if no role, redirect to login
       if (!user) return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // Authenticated user visiting auth page → redirect to correct panel
  if (isPublic && role) {
    const dest =
      role === 'super_admin' ? '/admin-giga-panel' :
      role === 'admin' ? '/dashboard' :
      role === 'owner' ? '/owner/dashboard' :
      role === 'client' ? '/client/waiting-room' :
      '/expert/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Not authenticated, accessing protected page → redirect to login
  if (!isPublic && !role) {
    const url = new URL('/login', request.url)
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  // ── Role-based route protection ──

  // Expert trying to access admin-only pages → redirect to expert panel
  if (role === 'expert' && ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/expert/dashboard', request.url))
  }

  // Client trying to access admin/expert pages → redirect to client portal
  if (role === 'client' && (ADMIN_PATHS.some((p) => pathname.startsWith(p)) || EXPERT_PATHS.some((p) => pathname.startsWith(p)))) {
    return NextResponse.redirect(new URL('/client/waiting-room', request.url))
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
