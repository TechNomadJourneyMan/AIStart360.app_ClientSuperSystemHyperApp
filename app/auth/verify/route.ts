import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { trackEvent } from '@/lib/events/track'
import { acceptInvitation } from '@/lib/admin/invites'
import { parseEmailLinkParams } from './link-params'

/**
 * /auth/verify — приземление ссылки, отправленной нами (см.
 * /api/v1/auth/email-link и приглашения). Одноразовый токен меняется на сессию
 * прямо на нашем домене, поэтому Site URL в Supabase роли не играет.
 *
 * GET токен НЕ тратит. Почтовые сканеры (Outlook Safe Links, антивирусы
 * корпоративной почты) открывают ссылки из письма заранее — раньше такой
 * «предпросмотр» сжигал токен, и человек получал «ссылка устарела». Теперь GET
 * ведёт на страницу /auth/confirm с кнопкой «Продолжить», а токен расходуется
 * только её POST-запросом сюда. Старые письма (GET /auth/verify?token_hash=…)
 * попадают на ту же страницу с теми же параметрами.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const { tokenHash, type, next } = parseEmailLinkParams((k) => searchParams.get(k))
  if (!tokenHash) {
    return NextResponse.redirect(new URL('/login?error=link_invalid', origin))
  }
  const url = new URL('/auth/confirm', origin)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', type)
  url.searchParams.set('next', next)
  return NextResponse.redirect(url)
}

/**
 * Форма подтверждения отправляется только с нашей же страницы: чужой сайт не
 * должен уметь «войти» посетителя в свой аккаунт, подсунув ему свой токен
 * (login CSRF). Браузеры шлют Sec-Fetch-Site и Origin с каждым POST формы.
 */
function isSameOriginPost(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return false
  const originHeader = request.headers.get('origin')
  if (!originHeader) return true
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwarded || request.headers.get('host') || new URL(request.url).host
  try {
    return new URL(originHeader).host === host
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url)
  // 303: браузер повторит переход уже GET-запросом.
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), 303)

  if (!isSameOriginPost(request)) return go('/login?error=link_invalid')

  const form = await request.formData().catch(() => null)
  const { tokenHash, type, next } = parseEmailLinkParams((k) => {
    const v = form?.get(k)
    return typeof v === 'string' ? v : null
  })
  if (!tokenHash) return go('/login?error=link_invalid')

  const response = go(next)
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
    return go('/login?error=link_expired')
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
