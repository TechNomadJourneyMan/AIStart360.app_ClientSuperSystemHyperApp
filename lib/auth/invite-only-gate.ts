/**
 * lib/auth/invite-only-gate.ts — регистрация по приглашению не обходится через
 * Google (Раунд 4, B3: N4B-3, N4B-14). Только сервер.
 *
 * GoTrue прода пускает самостоятельную регистрацию (disable_signup: false), а
 * Google включён: первый вход через Google создаёт пользователя GoTrue, триггер
 * handle_new_user — профиль «на одобрении». Раньше /auth/callback дальше заводил
 * заявку, звал администраторов и вёл в зал ожидания (анкета с ИИ, документы,
 * «Сообщения») — в обход режима «по приглашению».
 *
 * Теперь в режиме 'invite' НОВЫЙ человек без приглашения:
 *   • не получает заявку и уведомления;
 *   • помечается доверенной меткой app_metadata.signup_blocked = 'invite_only'
 *     (её пишет только служебный ключ) — чтобы повторный вход (через Google
 *     позже 10 минут или по ссылке на почту, /auth/verify) тоже не пустил;
 *   • выходит из сессии и видит «Регистрация по приглашению» с формой запроса
 *     (/register?notice=invite_only).
 * Пользователь GoTrue и профиль, созданные Google, НЕ удаляются (без решения PO) —
 * остаются «сиротой» на одобрении. Новые такие сироты перестанут появляться с
 * GOTRUE_DISABLE_SIGNUP=true (настройка GoTrue на Railway, решение PO).
 *
 * «Приглашён» = есть запись platform_invitations на эту почту (отправлено,
 * принято или истекло — человека звали). Тогда метка снимается и вход идёт как
 * раньше. Ошибка чтения — «не приглашён» (закрыто): человек может открыть
 * ссылку из письма-приглашения, она примет приглашение и снимет метку.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { getRegistrationMode } from '@/lib/settings/system-settings'
import { normalizeEmail } from '@/lib/admin/invite-shared'
import { INVITE_ONLY_NOTICE_PARAM } from '@/lib/registration/wait-text'

export const SIGNUP_BLOCKED_KEY = 'signup_blocked'
export const SIGNUP_BLOCKED_VALUE = 'invite_only'
export const INVITE_ONLY_PATH = `/register?notice=${INVITE_ONLY_NOTICE_PARAM}`
/** Статусы приглашения, при которых человека звали (failed — письмо не ушло). */
export const INVITED_STATUSES = ['sent', 'accepted', 'expired'] as const

type Admin = Pick<SupabaseClient, 'from' | 'auth'>

/** Метка «вход через Google без приглашения» (app_metadata пишет только служебный ключ). */
export function isSignupBlocked(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.app_metadata?.[SIGNUP_BLOCKED_KEY] === SIGNUP_BLOCKED_VALUE
}

/** Есть ли приглашение на эту почту. Ошибка чтения — false (закрыто). */
export async function hasInvitation(sb: Pick<SupabaseClient, 'from'>, rawEmail: string | null | undefined): Promise<boolean> {
  const email = normalizeEmail(rawEmail ?? '')
  if (!email) return false
  try {
    const { data, error } = await sb
      .from('platform_invitations')
      .select('id')
      .eq('email', email)
      .in('status', [...INVITED_STATUSES])
      .limit(1)
      .maybeSingle()
    if (error) {
      console.warn('[invite-only-gate] invitations unavailable:', String(error.message ?? '').slice(0, 160))
      return false
    }
    return !!data
  } catch (err) {
    console.warn('[invite-only-gate] invitations unavailable:', err instanceof Error ? err.message : err)
    return false
  }
}

export type GateDecision = 'allow' | 'block'

/**
 * Пускать ли человека дальше. Режим не «по приглашению» — пускать (как раньше).
 * Приглашён — пускать и снять метку, если была.
 */
export async function inviteOnlyDecision(
  sb: Admin,
  user: { id: string; email?: string | null; app_metadata?: Record<string, unknown> | null },
): Promise<GateDecision> {
  if ((await getRegistrationMode()) !== 'invite') return 'allow'
  if (await hasInvitation(sb, user.email)) {
    if (isSignupBlocked(user)) await clearSignupBlocked(sb, user.id)
    return 'allow'
  }
  return 'block'
}

/** Поставить метку (best-effort: не вышло — человек всё равно выходит из сессии). */
export async function markSignupBlocked(sb: Admin, userId: string, now: Date = new Date()): Promise<void> {
  try {
    const { error } = await sb.auth.admin.updateUserById(userId, {
      app_metadata: { [SIGNUP_BLOCKED_KEY]: SIGNUP_BLOCKED_VALUE, signup_blocked_at: now.toISOString() },
    })
    if (error) console.warn('[invite-only-gate] mark failed:', error.message)
  } catch (err) {
    console.warn('[invite-only-gate] mark failed:', err instanceof Error ? err.message : err)
  }
}

/** Снять метку (GoTrue сливает app_metadata: null удаляет ключ). */
export async function clearSignupBlocked(sb: Admin, userId: string): Promise<void> {
  try {
    const { error } = await sb.auth.admin.updateUserById(userId, {
      app_metadata: { [SIGNUP_BLOCKED_KEY]: null, signup_blocked_at: null },
    })
    if (error) console.warn('[invite-only-gate] clear failed:', error.message)
  } catch (err) {
    console.warn('[invite-only-gate] clear failed:', err instanceof Error ? err.message : err)
  }
}

const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/

/**
 * Редирект на «Регистрация по приглашению» без сессии: переносит то, что
 * записал signOut (очистка cookie), и на всякий случай гасит все cookie сессии
 * Supabase — и пришедшие с запросом, и только что выставленные обменом кода.
 */
export function inviteOnlyRedirect(origin: string, request: NextRequest, sessionResponse: NextResponse): NextResponse {
  const out = NextResponse.redirect(new URL(INVITE_ONLY_PATH, origin))
  for (const c of sessionResponse.cookies.getAll()) out.cookies.set(c)
  const names = new Set<string>([
    ...request.cookies.getAll().map((c) => c.name),
    ...sessionResponse.cookies.getAll().map((c) => c.name),
  ])
  for (const name of Array.from(names)) {
    if (SESSION_COOKIE.test(name)) out.cookies.set(name, '', { path: '/', maxAge: 0 })
  }
  return out
}

/** GoTrue вернул «регистрация закрыта» (GOTRUE_DISABLE_SIGNUP=true) — вход через Google нового человека. */
export function isSignupDisabledError(params: URLSearchParams): boolean {
  const code = params.get('error_code') ?? ''
  const desc = params.get('error_description') ?? ''
  return code === 'signup_disabled' || /signups? not allowed/i.test(desc)
}
