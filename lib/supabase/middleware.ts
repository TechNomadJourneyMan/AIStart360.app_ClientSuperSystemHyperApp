import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/** `profiles.role, status` of the verified user, read under RLS (own row). */
export interface SessionProfile {
  role: unknown
  status: unknown
}

/** `sub` of a JWT without verifying it — only used to start a speculative read. */
function jwtSubject(token: string | undefined): string | null {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    return typeof sub === 'string' && sub.length > 0 ? sub : null
  } catch {
    return null
  }
}

/**
 * The caller's own profile row, read with the caller's access token — the same
 * RLS self-read middleware does after `getUser()`, only started earlier.
 * `null` on any failure (the caller then falls back to the sequential read).
 */
async function readOwnProfile(userId: string, accessToken: string): Promise<SessionProfile | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    const res = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,status`,
      { headers: { apikey: anon, Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as Array<{ role?: unknown; status?: unknown }>
    if (!Array.isArray(rows) || rows.length > 1) return null
    return { role: rows[0]?.role ?? null, status: rows[0]?.status ?? null }
  } catch {
    return null
  }
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  // Speed-up: the profile row (role/status) used to be read only after the
  // Auth round trip. The session in the cookies (refreshed here exactly as
  // getUser() would refresh it) names the user, so the RLS self-read starts
  // together with getUser(). Its result is used ONLY when getUser() verifies
  // the very same user; otherwise middleware reads the row afterwards, as
  // before. Identity and role still come from getUser() + profiles only.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  const sessionUserId = jwtSubject(accessToken)
  const profileP = sessionUserId && accessToken ? readOwnProfile(sessionUserId, accessToken) : null

  const [
    {
      data: { user },
    },
    prefetched,
  ] = await Promise.all([supabase.auth.getUser(), profileP])

  const profile: SessionProfile | undefined =
    user && prefetched && user.id === sessionUserId ? prefetched : undefined

  return { supabase, response, user, profile }
}
