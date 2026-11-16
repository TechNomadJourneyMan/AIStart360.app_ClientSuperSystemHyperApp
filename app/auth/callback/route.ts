import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { prisma } from '@/lib/db'
import { trackEvent } from '@/lib/events/track'
import { safeInternalPath } from '@/lib/safe-redirect'
import { requestOrigin } from '@/lib/site-url'
import { notifyAdmins } from '@/lib/notifications'
import { runInBackground } from '@/lib/background'
import { CABINET_ENTRY_PATH, roleLandingPath } from '@/lib/role-landing'
import {
  INVITE_ONLY_PATH,
  inviteOnlyDecision,
  inviteOnlyRedirect,
  isSignupBlocked,
  isSignupDisabledError,
  markSignupBlocked,
} from '@/lib/auth/invite-only-gate'
import type { UserRole } from '@/types'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = requestOrigin(request)
  const code = searchParams.get('code')
  // Guard against open redirect: `next` is attacker-controllable on this
  // unauthenticated endpoint, so only allow internal paths.
  // R-029: no fixed cabinet page as the fallback — /login sends a signed-in
  // user to the landing of their role (a failed exchange shows the form).
  const next = safeInternalPath(searchParams.get('next'), CABINET_ENTRY_PATH)
  const explicitNext = Boolean(searchParams.get('next'))

  if (code) {
    const response = NextResponse.redirect(new URL(next, origin))
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
              response.cookies.set(name, value, options)
            })
          },
        },
      },
    )

    const { data: sessionData } = await supabase.auth.exchangeCodeForSession(code)
    const user = sessionData?.user
    if (user) void trackEvent({ userId: user.id, name: 'LOGIN', metadata: { method: 'oauth' } })

    if (user) {
      // Check if profile already exists. Service role: the request cookies do
      // not carry the fresh session yet, so an anon/SSR read would always miss
      // the row under RLS.
      const supabaseAdmin = createServiceClient()
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, status, role')
        .eq('id', user.id)
        .single()

      // The trigger creates the row inside the same auth.users INSERT, so a
      // first-time OAuth user already HAS a (pending) profile here. Treat a
      // freshly created pending account as a new signup too.
      const createdMs = user.created_at ? Date.parse(user.created_at) : NaN
      const justSignedUp =
        !existingProfile ||
        (existingProfile.status === 'pending_approval' && Number.isFinite(createdMs) && Date.now() - createdMs < 10 * 60_000)

      // R4 B3 (N4B-3 / N4B-14): registration is by invitation — Google is not a
      // way around it. In 'invite' mode a NEW person without an invitation gets
      // no request, no staff notice and no waiting room: marked, signed out,
      // sent to «Регистрация по приглашению» with the request form. The mark
      // keeps a later Google sign-in (past the 10-minute window above) out too,
      // until the person is invited or a staff member approves the account.
      // Existing accounts, invited people, staff and the other modes — as before.
      // The GoTrue user and its profile are NOT deleted (PO): see lib/auth/invite-only-gate.ts.
      // «New» here also needs a fresh GoTrue user: a failed profile read of an
      // old (approved) account must never turn it back.
      const freshAccount = Number.isFinite(createdMs) && Date.now() - createdMs < 10 * 60_000
      const newcomer = freshAccount && (!existingProfile || existingProfile.status === 'pending_approval')
      const markedPending = existingProfile?.status === 'pending_approval' && isSignupBlocked(user)
      if ((newcomer || markedPending) && (await inviteOnlyDecision(supabaseAdmin, user)) === 'block') {
        if (!isSignupBlocked(user)) await markSignupBlocked(supabaseAdmin, user.id)
        try {
          await supabase.auth.signOut()
        } catch (e) {
          console.warn('[auth/callback] sign-out of a blocked sign-up failed:', e instanceof Error ? e.message : e)
        }
        console.info('[auth/callback] invite-only: a new Google sign-in without an invitation was turned back', user.id)
        return inviteOnlyRedirect(origin, request, response)
      }

      if (justSignedUp) {
        // First time Google OAuth user — create profile with pending_approval
        const fullName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'

        // Normally handle_new_user already created the row (always client +
        // pending_approval, migration 084). Only fill the gap, never overwrite.
        await supabaseAdmin.from('profiles').upsert({
          id: user.id,
          email: user.email,
          full_name: fullName,
          role: 'client',
          status: 'pending_approval',
        }, { onConflict: 'id', ignoreDuplicates: true })

        // Create AdminRequest for GIGA panel
        try {
          await prisma.adminRequest.create({
            data: {
              type: 'registration',
              status: 'new',
              priority: 'medium',
              source: 'google_oauth',
              payload: {
                userId: user.id,
                email: user.email,
                name: fullName,
                subject: `Регистрация через Google: ${fullName}`,
                description: `Новый пользователь зарегистрировался через Google OAuth.\nEmail: ${user.email}\nИмя: ${fullName}`,
              },
            },
          })
        } catch (e) {
          console.error('[auth/callback] AdminRequest creation error:', e)
        }

        void runInBackground('auth-callback:notify', () =>
          notifyAdmins('user_registered', { name: fullName, email: user.email ?? null, role: 'client', organization: null, status: 'pending_approval', via: 'google_oauth' }, user.id),
        )

        // Redirect to waiting room instead of dashboard
        return NextResponse.redirect(new URL('/client/waiting-room', origin), {
          headers: response.headers,
        })
      }

      // Existing user — check status
      if (existingProfile?.status === 'pending_approval') {
        return NextResponse.redirect(new URL('/client/waiting-room', origin), {
          headers: response.headers,
        })
      }

      // No explicit destination: land by role like the password login
      // (staff → GIGA panel, SuperExpert → /super-expert, expert → cabinet).
      if (!explicitNext) {
        const { data: staff } = await supabaseAdmin
          .from('staff_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle()
        const target = roleLandingPath(
          (existingProfile as { role?: string | null }).role as UserRole | null,
          existingProfile.status,
          (staff as { role?: string } | null)?.role ?? null,
        )
        if (target !== next) {
          return NextResponse.redirect(new URL(target, origin), { headers: response.headers })
        }
      }
    }

    return response
  }

  // R4 B3: with GOTRUE_DISABLE_SIGNUP=true GoTrue refuses a NEW Google user and
  // comes back here without a code — show «Регистрация по приглашению», not a bare form.
  if (isSignupDisabledError(searchParams)) {
    return NextResponse.redirect(new URL(INVITE_ONLY_PATH, origin))
  }

  return NextResponse.redirect(new URL('/login', origin))
}
