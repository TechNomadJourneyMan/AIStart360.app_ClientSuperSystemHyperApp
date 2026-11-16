export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { sendNotificationEmail } from '@/lib/email'
import { getSiteUrl } from '@/lib/site-url'
import { checkRateLimit, checkRateLimitForRequest } from '@/lib/rate-limit'
import { runInBackground } from '@/lib/background'
import { safeInternalPath } from '@/lib/safe-redirect'
import { CABINET_ENTRY_PATH } from '@/lib/role-landing'

/**
 * POST /api/v1/auth/email-link — вход и восстановление пароля по ссылке,
 * которую отправляем МЫ.
 *
 * Зачем свой маршрут: Supabase подставляет собственный Site URL вместо
 * запрошенного адреса, если тот не в списке разрешённых, и письма уводят на
 * чужой домен. Здесь одноразовый токен создаётся служебным ключом, а ссылка
 * ведёт на наш /auth/verify — настройки Supabase на это не влияют.
 *
 * Ответ всегда одинаковый: существование адреса не раскрываем.
 *
 * R4 B3 (N4B-14): generateLink({ type: 'magiclink' }) для НЕЗНАКОМОЙ почты сам
 * создаёт пользователя GoTrue (так устроен служебный API; GOTRUE_DISABLE_SIGNUP
 * его не останавливает). «Войти по ссылке на почту» с любым адресом заводило
 * аккаунт «на одобрении» в обход регистрации — и режима «по приглашению».
 * Теперь ссылка создаётся только для почты, у которой уже есть аккаунт
 * (профиль), ответ прежний.
 *
 * Ревью W3A-4: поиск, ссылка и письмо — после ответа (в фоне), поэтому ответ
 * для известной и незнакомой почты одинаков и по времени.
 */
const bodySchema = z.object({
  email: z.string().email().max(200),
  purpose: z.enum(['login', 'recovery']).default('login'),
  next: z.string().max(200).optional(),
})

const OK_MESSAGE = 'Если аккаунт с таким адресом существует, мы отправили письмо со ссылкой для входа.'

/**
 * A fresh answer every time. The module-level Response it replaces was shared
 * by every request: its body is a stream, so from the second answer on it was
 * empty (status 200) — review W3A, «попутно».
 */
const ok = () => NextResponse.json({ ok: true, message: OK_MESSAGE }, { headers: { 'cache-control': 'no-store' } })

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Укажите корректный email' }, { status: 422 })
  }
  const { email, purpose } = parsed.data
  // R-029: without an explicit return path the sign-in link leads to the
  // cabinet by role (middleware on /login), not to the old /dashboard.
  const next = safeInternalPath(parsed.data.next ?? null, purpose === 'recovery' ? '/auth/reset-password' : CABINET_ENTRY_PATH)

  // Review W3A-4: the per-address limit by the TRUSTED client IP (X-Real-IP /
  // the right-most X-Forwarded-For, lib/net/client-ip — R-049), as in
  // /api/auth/request-invite; the left-most X-Forwarded-For is the client's own text.
  const [byEmail, byIp] = await Promise.all([
    checkRateLimit(email.toLowerCase(), 'auth-email-link', { max: 5, windowMs: 15 * 60_000 }),
    checkRateLimitForRequest(req, 'auth-email-link-ip', { max: 20, windowMs: 15 * 60_000 }),
  ])
  if (byEmail.limited || byIp.limited) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте через несколько минут.' }, { status: 429 })
  }

  // Review W3A-4: the same answer at the same moment for a known and an
  // unknown address — the account lookup, the link and the letter happen after
  // the answer, so the response time does not tell whether the address exists.
  void runInBackground('auth-email-link:send', () => sendLink(email, purpose, next))
  return ok()
}

/** Look the account up, make the link, send the letter. Never throws (background). */
async function sendLink(email: string, purpose: 'login' | 'recovery', next: string): Promise<void> {
  try {
    const admin = createServiceClient()
    if (!(await accountExists(admin, email))) return
    const { data, error } = await admin.auth.admin.generateLink({
      type: purpose === 'recovery' ? 'recovery' : 'magiclink',
      email,
    })
    const tokenHash = data?.properties?.hashed_token
    if (error || !tokenHash) return

    const url = new URL('/auth/verify', getSiteUrl())
    url.searchParams.set('token_hash', tokenHash)
    url.searchParams.set('type', purpose === 'recovery' ? 'recovery' : 'magiclink')
    url.searchParams.set('next', next)

    const sent = await sendNotificationEmail({
      to: email,
      subject: purpose === 'recovery' ? 'Восстановление пароля — AIStart360' : 'Вход в AIStart360',
      title: purpose === 'recovery' ? 'Задайте новый пароль' : 'Вход по ссылке',
      body: purpose === 'recovery'
        ? 'Нажмите кнопку, чтобы задать новый пароль. Ссылка действует один час и срабатывает один раз. Если вы не запрашивали восстановление — просто проигнорируйте письмо.'
        : 'Нажмите кнопку, чтобы войти в кабинет. Ссылка действует один час и срабатывает один раз. Если вы не запрашивали вход — просто проигнорируйте письмо.',
      ctaLabel: purpose === 'recovery' ? 'Задать новый пароль' : 'Войти в кабинет',
      ctaUrl: url.toString(),
    })
    // A letter that did not leave (no RESEND_API_KEY, unverified sender domain…)
    // must be visible in the logs — never the link itself, it carries a one-time token.
    const sendError = (sent as { error?: unknown } | undefined)?.error
    if (sendError) {
      const reason = typeof sendError === 'string' ? sendError : (sendError as { message?: string }).message ?? 'unknown'
      console.error(`[auth/email-link] ${purpose}: письмо не отправлено — ${reason}`)
    }
  } catch (e) {
    console.error('[auth/email-link]', e instanceof Error ? e.message : e)
  }
}

/**
 * Есть ли аккаунт с этой почтой (профиль создаётся вместе с пользователем GoTrue).
 * Ошибка чтения — нет (ссылку не создаём: иначе generateLink завёл бы аккаунт).
 */
async function accountExists(admin: ReturnType<typeof createServiceClient>, rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase()
  try {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[auth/email-link] account lookup failed:', String(error.message ?? '').slice(0, 160))
      return false
    }
    return !!data
  } catch (e) {
    console.error('[auth/email-link] account lookup failed:', e instanceof Error ? e.message : e)
    return false
  }
}
