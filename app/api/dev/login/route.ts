export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isStaffRole } from '@/lib/admin/rbac'
import { DEV_MODE_COOKIE, DEV_MODE_COOKIE_OPTIONS, devAccessEnabledForRequest, devNotFound } from '@/lib/dev/dev-access'
import { DEV_ROLES, DevAccountError, devAccountShape, ensureDevAccount, findAuthUserByEmail } from '@/lib/dev/dev-accounts'
import { roleLandingPath } from '@/lib/role-landing'
import { createServiceClient } from '@/lib/supabase-service'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

/**
 * POST /api/dev/login { role } | { email } — enter the portal without a
 * password: as the developer account of a role (created on first use), or as
 * any account that already exists.
 *
 * Dev-only backdoor: it signs the browser in as ANY account, so it answers
 * 404 unless lib/dev/dev-access.ts allows the request — and in a production
 * build that guard is the constant `false`.
 *
 * The session is a real Supabase session, minted the way the owner login and
 * impersonation mint theirs: a one-time token is generated with the service
 * role and exchanged at once by the cookie-bound client; it never leaves the
 * server.
 */
const bodySchema = z.union([
  z.object({ role: z.enum(DEV_ROLES) }).strict(),
  z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict(),
])

/** Where the account lands — the same rule the sign-in page follows (lib/role-landing.ts). */
async function landingOf(admin: SupabaseClient, userId: string): Promise<string> {
  const [profile, staff] = await Promise.all([
    admin.from('profiles').select('role, status').eq('id', userId).maybeSingle(),
    admin.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
  ])
  const row = profile.data as { role?: string | null; status?: string | null } | null
  const staffRole = (staff.data as { role?: string | null } | null)?.role
  return roleLandingPath((row?.role ?? null) as UserRole | null, row?.status ?? null, isStaffRole(staffRole) ? staffRole : null)
}

const sessionFailed = (why: string) => {
  console.error(`[dev/login] no session: ${why}`)
  return NextResponse.json({ error: 'DEV_SESSION_FAILED' }, { status: 500 })
}

export async function POST(request: NextRequest) {
  if (!devAccessEnabledForRequest(request)) return devNotFound()

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })
  const body = parsed.data

  try {
    const admin = createServiceClient()

    let account: { userId: string; email: string }
    let redirect: string
    if ('role' in body) {
      account = await ensureDevAccount(body.role, admin)
      const shape = devAccountShape(body.role)
      redirect = roleLandingPath(shape.profileRole, 'approved', shape.staffRole)
    } else {
      // The account must exist BEFORE a link is asked for: Auth answers a
      // magic-link request for an unknown address by signing that address up.
      const user = await findAuthUserByEmail(admin, body.email)
      if (!user?.email) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
      account = { userId: user.id, email: user.email }
      redirect = await landingOf(admin, user.id)
    }

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: account.email })
    const tokenHash = link.data.properties?.hashed_token
    if (link.error || !tokenHash) return sessionFailed(link.error?.message ?? 'no token')
    if (link.data.user?.id !== account.userId) return sessionFailed('the link belongs to another account')

    const supabase = await createClient()
    let verified = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
    // An older Auth server knows this token only as 'magiclink' (app/api/giga-admin/auth does the same).
    if (verified.error) verified = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
    if (verified.error) return sessionFailed(verified.error.message)
    if (verified.data.user?.id !== account.userId) {
      // Never leave the browser signed in as somebody it did not ask for.
      // Local scope: only this browser's session ends, not the account's others.
      await supabase.auth.signOut({ scope: 'local' })
      return sessionFailed('the session belongs to another account')
    }

    const res = NextResponse.json({ ok: true, redirect })
    res.cookies.set(DEV_MODE_COOKIE, '1', DEV_MODE_COOKIE_OPTIONS)
    return res
  } catch (error) {
    console.error('[dev/login]', error instanceof Error ? error.message : error)
    if (error instanceof DevAccountError) {
      return NextResponse.json({ error: error.code }, { status: error.code === 'DEV_ACCOUNT_CONFLICT' ? 409 : 500 })
    }
    return NextResponse.json({ error: 'DEV_LOGIN_FAILED' }, { status: 500 })
  }
}

// Any other method: there is no such route (Next.js would answer 405 / 204).
export { devNotFound as GET, devNotFound as PUT, devNotFound as PATCH, devNotFound as DELETE, devNotFound as OPTIONS }
