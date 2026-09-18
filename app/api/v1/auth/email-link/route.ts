export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { sendNotificationEmail } from '@/lib/email'
import { getSiteUrl } from '@/lib/site-url'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeInternalPath } from '@/lib/safe-redirect'

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
 */
const bodySchema = z.object({
  email: z.string().email().max(200),
  purpose: z.enum(['login', 'recovery']).default('login'),
  next: z.string().max(200).optional(),
})

const OK = NextResponse.json({
  ok: true,
  message: 'Если аккаунт с таким адресом существует, мы отправили письмо со ссылкой для входа.',
})

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Укажите корректный email' }, { status: 422 })
  }
  const { email, purpose } = parsed.data
  const next = safeInternalPath(parsed.data.next ?? null, purpose === 'recovery' ? '/auth/reset-password' : '/dashboard')

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limited = await Promise.all([
    isRateLimitedKey(email.toLowerCase(), 'auth-email-link', { max: 5, windowMs: 15 * 60_000 }),
    isRateLimitedKey(ip, 'auth-email-link-ip', { max: 20, windowMs: 15 * 60_000 }),
  ])
  if (limited.some(Boolean)) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте через несколько минут.' }, { status: 429 })
  }

  try {
    const { data, error } = await createServiceClient().auth.admin.generateLink({
      type: purpose === 'recovery' ? 'recovery' : 'magiclink',
      email,
    })
    const tokenHash = data?.properties?.hashed_token
    // Нет такого пользователя — отвечаем так же, как при успехе.
    if (error || !tokenHash) return OK

    const url = new URL('/auth/verify', getSiteUrl())
    url.searchParams.set('token_hash', tokenHash)
    url.searchParams.set('type', purpose === 'recovery' ? 'recovery' : 'magiclink')
    url.searchParams.set('next', next)

    await sendNotificationEmail({
      to: email,
      subject: purpose === 'recovery' ? 'Восстановление пароля — AIStart360' : 'Вход в AIStart360',
      title: purpose === 'recovery' ? 'Задайте новый пароль' : 'Вход по ссылке',
      body: purpose === 'recovery'
        ? 'Нажмите кнопку, чтобы задать новый пароль. Ссылка действует один час и срабатывает один раз. Если вы не запрашивали восстановление — просто проигнорируйте письмо.'
        : 'Нажмите кнопку, чтобы войти в кабинет. Ссылка действует один час и срабатывает один раз. Если вы не запрашивали вход — просто проигнорируйте письмо.',
      ctaLabel: purpose === 'recovery' ? 'Задать новый пароль' : 'Войти в кабинет',
      ctaUrl: url.toString(),
    })
    return OK
  } catch (e) {
    console.error('[auth/email-link]', e instanceof Error ? e.message : e)
    return OK
  }
}
