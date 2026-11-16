import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { checkRateLimitForRequest, rateLimitResponse } from '@/lib/rate-limit'
import { getRegistrationMode } from '@/lib/settings/system-settings'
import { profanityResponse } from '@/lib/moderation/http'
import { runInBackground } from '@/lib/background'
import { InviteRequestBody, isBotSubmission, notifyStaffInviteRequested, submitInviteRequest } from '@/lib/registration/invite-requests'
import { INVITE_REQUEST_ACCEPTED } from '@/lib/registration/wait-text'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/auth/request-invite — «Запросить приглашение» (Раунд 4, B3, N4B-3).
 *
 * Публичный: регистрация по приглашению, а аккаунта у человека ещё нет.
 * Аккаунт НЕ создаётся — только заявка в ГИГА «Заявки» → «Регистрация» и
 * уведомление Admin / Super Admin (lib/registration/invite-requests.ts).
 *
 *   • Zod-проверка тела, фильтр мата, частота: 5 запросов за 10 минут с адреса.
 *   • Ловушка для ботов (скрытое поле `website`): ответ как при успехе, ничего не пишется.
 *   • Режим не «по приглашению» — 409: регистрация открыта, нужна обычная форма.
 *   • Ответ одинаковый для новой и повторной заявки и не говорит, есть ли
 *     аккаунт с этой почтой.
 */
const ACCEPTED = { ok: true, message: INVITE_REQUEST_ACCEPTED }

export async function POST(request: Request) {
  const limit = await checkRateLimitForRequest(request, 'auth-request-invite', { max: 5, windowMs: 10 * 60_000 })
  if (limit.limited) return rateLimitResponse(limit, 'Слишком много заявок. Попробуйте позже.')

  const parsed = InviteRequestBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }, { status: 400 })
  }
  // Боту — тот же ответ, что человеку: пусть не учится обходить ловушку.
  if (isBotSubmission(parsed.data)) return NextResponse.json(ACCEPTED)

  const { name, company, contact } = parsed.data
  const profane = profanityResponse({ name, company, contact })
  if (profane) return profane

  if ((await getRegistrationMode()) !== 'invite') {
    return NextResponse.json(
      { ok: false, error: 'Регистрация сейчас открыта — создайте аккаунт на вкладке «Регистрация».', code: 'registration_open' },
      { status: 409 },
    )
  }

  try {
    const sb = createServiceClient()
    const result = await submitInviteRequest(sb, parsed.data)
    if (result.outcome === 'created') {
      void runInBackground('request-invite:notify', () =>
        notifyStaffInviteRequested(sb, { requestId: result.requestId, person: result.person, accountExists: result.accountExists }),
      )
    }
    return NextResponse.json(ACCEPTED)
  } catch (err) {
    console.error('[auth/request-invite] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось отправить заявку. Попробуйте ещё раз.' }, { status: 500 })
  }
}
