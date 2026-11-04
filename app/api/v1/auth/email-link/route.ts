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

// A fresh Response per request: a body stream can be sent only once, so one
// module-level instance would break every request after the first.
const ok = () => NextResponse.json({
  ok: true,
  message: 'Если аккаунт с таким адресом существует, мы отправили письмо со ссылкой для входа.',
})

/** Текст ошибки провайдера без адресов и ссылок (в ссылке — одноразовый токен). */
function errorText(e: unknown): string {
  if (!e) return 'unknown'
  if (typeof e === 'string') return e.slice(0, 200)
  const m = (e as { message?: unknown }).message
  return typeof m === 'string' ? m.slice(0, 200) : 'unknown'
}

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
    // Нет такого пользователя — отвечаем так же, как при успехе. Прочие сбои
    // (ключ, сеть) пишем в журнал, но наружу ответ тот же.
    if (error || !tokenHash) {
      const status = (error as { status?: number } | null)?.status
      if (error && status !== 404 && status !== 422) {
        console.error(`[auth/email-link] generateLink failed (${purpose}): ${errorText(error)}`)
      }
      return ok()
    }

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
    // Resend не бросает, а возвращает { error } — без этой проверки письмо
    // «уходило» молча и человек ждал его впустую.
    const sendError = (sent as { error?: unknown } | null | undefined)?.error
    if (sendError) {
      console.error(`[auth/email-link] email delivery failed (${purpose}): ${errorText(sendError)}`)
    }
    return ok()
  } catch (e) {
    console.error(`[auth/email-link] failed (${purpose}): ${errorText(e)}`)
    return ok()
  }
}
