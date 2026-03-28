import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const next  = searchParams.get('next') ?? '/'

  if (code) {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const role = data.user.user_metadata?.role as string | undefined

      // Redirect based on role after email verification
      const dest =
        role === 'client'      ? '/client/waiting-room' :
        role === 'admin'       ? '/dashboard' :
        role === 'expert'      ? '/expert/dashboard' :
        role === 'owner'       ? '/owner/dashboard' :
        role === 'super_admin' ? '/admin-giga-panel' :
        next !== '/'           ? next :
                                 '/dashboard'

      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  // Exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
