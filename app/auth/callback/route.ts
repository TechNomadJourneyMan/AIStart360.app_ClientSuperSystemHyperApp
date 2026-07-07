import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { createServerClient as createSupabaseAdmin } from '@/lib/supabase-server'
import { prisma } from '@/lib/db'
import { safeInternalPath } from '@/lib/safe-redirect'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Guard against open redirect: `next` is attacker-controllable on this
  // unauthenticated endpoint, so only allow internal paths.
  const next = safeInternalPath(searchParams.get('next'), '/dashboard')

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

    if (user) {
      // Check if profile already exists
      const supabaseAdmin = createSupabaseAdmin()
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, status')
        .eq('id', user.id)
        .single()

      if (!existingProfile) {
        // First time Google OAuth user — create profile with pending_approval
        const fullName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'

        await supabaseAdmin.from('profiles').upsert({
          id: user.id,
          email: user.email,
          full_name: fullName,
          role: 'client',
          status: 'pending_approval',
        }, { onConflict: 'id' })

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

        // Redirect to waiting room instead of dashboard
        return NextResponse.redirect(new URL('/client/waiting-room', origin), {
          headers: response.headers,
        })
      }

      // Existing user — check status
      if (existingProfile.status === 'pending_approval') {
        return NextResponse.redirect(new URL('/client/waiting-room', origin), {
          headers: response.headers,
        })
      }
    }

    return response
  }

  return NextResponse.redirect(new URL('/login', origin))
}
