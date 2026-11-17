/**
 * lib/auth/invite-only-shared.ts — правило «регистрация по приглашению» без
 * серверных зависимостей (Раунд 4, B3; ревью W3A-1). Edge-safe: им пользуются
 * middleware.ts, /auth/callback, /auth/verify, вход по паролю и
 * /api/client/register.
 *
 * Метка `app_metadata.signup_blocked = 'invite_only'` — «аккаунт создан в обход
 * приглашения». app_metadata пишет только служебный ключ, пользователь её не
 * снимет; она есть и в JWT (claim app_metadata), поэтому middleware проверяет
 * API без запроса в базу. Метку снимают приглашение (принятое или найденное в
 * platform_invitations) и одобрение персоналом (applyApprovalDecision).
 *
 * Профиль ожидающего создаёт ТРИГГЕР handle_new_user на auth.users — любой
 * новый пользователь GoTrue (signup по anon-ключу, Google, implicit-поток)
 * сразу «client / pending_approval». Поэтому второе правило — для ожидающих без
 * метки (pendingSignupVerdict): режим 'invite' + профиль «на одобрении» + не
 * приглашён + аккаунт создан ПОСЛЕ включения режима (updated_at строки
 * registration_mode) → метка и экран «по приглашению». Регистрации эпохи
 * «по подтверждению» (созданы раньше) правило не задевает.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { INVITE_ONLY_NOTICE_PARAM } from '@/lib/registration/wait-text'

export const SIGNUP_BLOCKED_KEY = 'signup_blocked'
export const SIGNUP_BLOCKED_VALUE = 'invite_only'
export const INVITE_ONLY_PATH = `/register?notice=${INVITE_ONLY_NOTICE_PARAM}`
/** Статусы приглашения, при которых человека звали (failed — письмо не ушло). */
export const INVITED_STATUSES = ['sent', 'accepted', 'expired'] as const

export const INVITE_ONLY_MESSAGE =
  'Регистрация на платформе — по приглашению. Этот аккаунт ещё не открыт: оставьте заявку на странице «Запросить приглашение» — команда AIStart360 свяжется с вами.'

type UserLike = { app_metadata?: Record<string, unknown> | null } | null | undefined

/** Метка «аккаунт создан в обход приглашения» (app_metadata пишет только служебный ключ). */
export function isSignupBlocked(user: UserLike): boolean {
  return user?.app_metadata?.[SIGNUP_BLOCKED_KEY] === SIGNUP_BLOCKED_VALUE
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/**
 * Метка в claim app_metadata access-токена — БЕЗ проверки подписи. Годится
 * только чтобы ДОБАВИТЬ запрет: убрать claim из токена нельзя, не сломав
 * подпись, а подделанный токен не пройдёт getUser() в самом маршруте.
 */
export function signupBlockedInToken(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false
  const parts = accessToken.split('.')
  if (parts.length !== 3 || !parts[1]) return false
  try {
    const p = JSON.parse(base64UrlDecode(parts[1])) as { app_metadata?: Record<string, unknown> }
    return isSignupBlocked({ app_metadata: p.app_metadata ?? null })
  } catch {
    return false
  }
}

/**
 * API, которые помеченному аккаунту остаются доступны: выход, сама форма
 * «Запросить приглашение», выход из режима «от имени» и API персонала
 * (/api/giga-admin — своя проверка роли сотрудника; помеченный клиент её не
 * пройдёт, а сотрудник, у которого во вкладке сессия «от имени» помеченного,
 * не должен терять ГИГА — проверка NV3-1).
 */
export function inviteOnlyExemptApi(pathname: string, method: string): boolean {
  if (pathname === '/api/v1/auth/sign-out') return true
  if (pathname === '/api/v1/impersonation/exit') return true
  if (pathname.startsWith('/api/giga-admin/')) return true
  if (pathname === '/api/auth/request-invite' && method.toUpperCase() === 'POST') return true
  return false
}

const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/

/** Погасить все cookie сессии Supabase: пришедшие с запросом и только что выставленные. */
export function expireSessionCookies(out: NextResponse, request: NextRequest, sessionResponse?: NextResponse | null): NextResponse {
  if (sessionResponse) for (const c of sessionResponse.cookies.getAll()) out.cookies.set(c)
  const names = new Set<string>([
    ...request.cookies.getAll().map((c) => c.name),
    ...(sessionResponse ? sessionResponse.cookies.getAll().map((c) => c.name) : []),
  ])
  for (const name of Array.from(names)) {
    if (SESSION_COOKIE.test(name)) out.cookies.set(name, '', { path: '/', maxAge: 0 })
  }
  return out
}

/**
 * Редирект на «Регистрация по приглашению» без сессии: переносит то, что
 * записал signOut (очистка cookie), и гасит все cookie сессии Supabase.
 */
export function inviteOnlyRedirect(origin: string, request: NextRequest, sessionResponse: NextResponse): NextResponse {
  return expireSessionCookies(NextResponse.redirect(new URL(INVITE_ONLY_PATH, origin)), request, sessionResponse)
}

/** Ответ API помеченному аккаунту: 403 и выход из сессии в этом же ответе. */
export function inviteOnlyApiResponse(request: NextRequest): NextResponse {
  return expireSessionCookies(
    NextResponse.json({ ok: false, error: INVITE_ONLY_MESSAGE, code: 'invite_only' }, { status: 403, headers: { 'cache-control': 'no-store' } }),
    request,
  )
}

export type PendingVerdict = 'allow' | 'block' | 'unknown'

export interface PendingSignupInput {
  createdAt: string | null | undefined
  /** GoTrue invited_at: аккаунт создан приглашением. */
  invitedAt?: string | null
  email: string | null | undefined
}

export interface PendingSignupDeps {
  /** Режим и когда его в последний раз записали; null — прочитать не удалось. */
  mode: () => Promise<{ mode: string; since: string | null } | null>
  /** Есть ли приглашение на эту почту; null — прочитать не удалось. */
  invited: (email: string) => Promise<boolean | null>
}

/**
 * Ожидающий одобрения без метки: создан ли он в обход приглашения.
 *   allow   — приглашён, режим не 'invite', или аккаунт старше включения режима;
 *   block   — режим 'invite', аккаунт создан после его включения, приглашения нет;
 *   unknown — не удалось прочитать режим или приглашения (вызывающий отвечает
 *             «временная ошибка», ничего не меняя).
 */
export async function pendingSignupVerdict(input: PendingSignupInput, deps: PendingSignupDeps): Promise<PendingVerdict> {
  if (input.invitedAt) return 'allow'
  const m = await deps.mode()
  if (!m) return 'unknown'
  if (m.mode !== 'invite') return 'allow'
  const created = Date.parse(String(input.createdAt ?? ''))
  const since = Date.parse(String(m.since ?? ''))
  // The mode row has no time, or the account is from before the switch (the
  // registrations of the «approval» era) — not this rule's business.
  if (!Number.isFinite(created) || !Number.isFinite(since) || created <= since) return 'allow'
  const email = (input.email ?? '').trim().toLowerCase()
  if (!email) return 'block'
  const invited = await deps.invited(email)
  if (invited === null) return 'unknown'
  return invited ? 'allow' : 'block'
}

/** GoTrue вернул «регистрация закрыта» (GOTRUE_DISABLE_SIGNUP=true) — вход через Google нового человека. */
export function isSignupDisabledError(params: URLSearchParams): boolean {
  const code = params.get('error_code') ?? ''
  const desc = params.get('error_description') ?? ''
  return code === 'signup_disabled' || /signups? not allowed/i.test(desc)
}
