import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { trackEvent } from '@/lib/events/track'
import { safeInternalPath } from '@/lib/safe-redirect'
import { acceptInvitation } from '@/lib/admin/invites'

/**
 * GET /auth/verify — приземление ссылки, отправленной нами (см.
 * /api/v1/auth/email-link). Меняет одноразовый токен на сессию прямо на нашем
 * домене, поэтому Site URL в Supabase роли не играет.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const raw = searchParams.get('type')
  const type = raw === 'recovery' ? 'recovery' : raw === 'invite' ? 'invite' : 'magiclink'
  // Приглашённый ещё без пароля — ведём его на страницу, где он его задаёт.
  const fallback = type === 'magiclink' ? '/dashboard' : '/auth/reset-password'
  const next = safeInternalPath(searchParams.get('next'), fallback)

  if (!tokenHash) {
    return NextResponse.redirect(new URL('/login?error=link_invalid', origin))
  }

  const response = NextResponse.redirect(new URL(next, origin))
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error || !data.user) {
    return NextResponse.redirect(new URL('/login?error=link_expired', origin))
  }

  // Приглашение принято: закрываем запись и, если в ней была роль персонала,
  // выдаём её. Никогда не бросает — вход важнее побочного учёта. Куда идти
  // дальше, решает общая маршрутизация по роли (middleware + /login).
  await acceptInvitation(data.user.email, data.user.id)

  void trackEvent({
    userId: data.user.id,
    name: 'LOGIN',
    metadata: { method: type === 'recovery' ? 'recovery_link' : type === 'invite' ? 'invite_link' : 'email_link' },
  })
  return response
}
