import { NextResponse } from 'next/server'
import { createClient as createStandalone } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity/log'
import { createNotification } from '@/lib/notifications/create'
import { isRateLimitedKey } from '@/lib/rate-limit'
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  classifyPasswordUpdateError,
  passwordPolicyError,
  passwordUpdateMessage,
} from '@/lib/auth/password-policy'

// Change the caller's own password. Verifies the current password first (via a
// throwaway standalone client that does NOT touch session cookies), then updates
// on the session client — Supabase then keeps this session and revokes the
// others. No new tables.
//
// Every refusal carries `error` (machine code, used by the UI) and `message`
// (Russian text to show as is).
export const dynamic = 'force-dynamic'

const SCHEMA = z.object({
  current: z.string().min(1).max(512),
  newPassword: z.string().max(512),
})

function fail(error: string, message: string, status = 422, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, message, ...extra }, { status })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return fail('unauthorized', 'Сессия истекла. Войдите заново.', 401)

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return fail('validation', `Введите текущий пароль и новый пароль (${PASSWORD_MIN}–${PASSWORD_MAX} символов)`)
  }
  const { current, newPassword } = parsed.data
  const policy = passwordPolicyError(newPassword)
  if (policy) return fail('validation', policy)
  if (current === newPassword) return fail('same_password', passwordUpdateMessage('same_password'))

  // Each attempt costs a real sign-in against Supabase: cap guessing of the
  // current password per account.
  if (await isRateLimitedKey(user.id, 'settings-password', { max: 5, windowMs: 15 * 60_000 })) {
    return fail('rate_limited', passwordUpdateMessage('rate_limited'), 429)
  }

  // Verify current password without disturbing the live session.
  const verifier = createStandalone(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: signErr } = await verifier.auth.signInWithPassword({ email: user.email, password: current })
  if (signErr) {
    // An account created through Google has no password at all: the only way
    // to get one is the recovery link (proves the mailbox), not this form.
    const oauthOnly = !(user.identities ?? []).some((i) => i.provider === 'email')
    return fail(
      'wrong_current_password',
      oauthOnly
        ? 'Неверный текущий пароль. Если вы входите через Google, пароля у аккаунта может не быть — задайте его по ссылке из письма.'
        : passwordUpdateMessage('wrong_current_password'),
      422,
      { oauthOnly },
    )
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword })
  if (updErr) {
    const failure = classifyPasswordUpdateError(updErr)
    console.error('[settings/password]', failure, updErr.message)
    return fail(
      failure,
      passwordUpdateMessage(failure, (updErr as { reasons?: unknown }).reasons),
      failure === 'rate_limited' ? 429 : 422,
    )
  }
  await logActivity({
    userId: user.id,
    action: 'security.password_changed',
    category: 'security',
    severity: 'critical',
    description: 'Пароль изменён',
    req: request,
  })
  await createNotification({
    userId: user.id,
    title: 'Пароль изменён',
    body: 'Пароль вашего аккаунта был успешно изменён. Если это были не вы — немедленно смените пароль.',
    category: 'security',
    priority: 'high',
    link: '/settings',
  })
  return NextResponse.json({ ok: true })
}
