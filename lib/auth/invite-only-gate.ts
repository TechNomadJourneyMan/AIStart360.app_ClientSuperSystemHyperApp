/**
 * lib/auth/invite-only-gate.ts — регистрация по приглашению не обходится
 * (Раунд 4, B3: N4B-3, N4B-14; ревью W3A-1…W3A-3). Только сервер. Правило и
 * его edge-часть — lib/auth/invite-only-shared.ts, lib/auth/invite-only-edge.ts.
 *
 * GoTrue прода пускает самостоятельную регистрацию (disable_signup: false):
 * Google, signup по anon-ключу, implicit-поток. Любой новый пользователь GoTrue
 * сразу получает профиль «на одобрении» (триггер handle_new_user), а с ним зал
 * ожидания (анкета с ИИ, документы, «Сообщения»). В режиме 'invite':
 *   • /auth/callback (Google): новый без приглашения — метка
 *     app_metadata.signup_blocked, выход, экран «по приглашению»;
 *   • middleware.ts: метка в JWT закрывает API (без запроса в базу) и
 *     страницы; ожидающий без метки, созданный после включения режима и без
 *     приглашения, получает метку и выходит (pendingSignupVerdict);
 *   • /auth/verify, вход по паролю, /api/client/register — тоже по метке / правилу.
 * Снимают метку: приглашение (принятое или найденное) и одобрение персоналом.
 * Пользователь GoTrue и профиль НЕ удаляются (без решения PO) — «сирота» на
 * одобрении. Новые сироты перестанут появляться с GOTRUE_DISABLE_SIGNUP=true;
 * эти проверки после него остаются страховкой (implicit-вход уже помеченного,
 * восстановление пароля, токены, выданные до включения).
 *
 * Ошибка чтения режима (сбой базы, не «строки нет») — закрыто: блок без метки
 * (метка ставится только когда режим 'invite' прочитан наверняка). Ошибка
 * чтения приглашений — «не приглашён».
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readRegistrationMode } from '@/lib/settings/system-settings'
import { normalizeEmail } from '@/lib/admin/invite-shared'
import {
  INVITED_STATUSES,
  SIGNUP_BLOCKED_KEY,
  SIGNUP_BLOCKED_VALUE,
  isSignupBlocked,
  pendingSignupVerdict,
  type PendingVerdict,
} from './invite-only-shared'

export {
  INVITE_ONLY_MESSAGE,
  INVITE_ONLY_PATH,
  INVITED_STATUSES,
  SIGNUP_BLOCKED_KEY,
  SIGNUP_BLOCKED_VALUE,
  expireSessionCookies,
  inviteOnlyRedirect,
  isSignupBlocked,
  isSignupDisabledError,
} from './invite-only-shared'

type Admin = Pick<SupabaseClient, 'from' | 'auth'>

interface GateUser {
  id: string
  email?: string | null
  invited_at?: string | null
  created_at?: string | null
  app_metadata?: Record<string, unknown> | null
}

/** Есть ли приглашение на эту почту. Ошибка чтения — false (закрыто). */
export async function hasInvitation(sb: Pick<SupabaseClient, 'from'>, rawEmail: string | null | undefined): Promise<boolean> {
  return (await invitationOn(sb, rawEmail)) === true
}

/** То же, но ошибка чтения — null. */
async function invitationOn(sb: Pick<SupabaseClient, 'from'>, rawEmail: string | null | undefined): Promise<boolean | null> {
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
      return null
    }
    return !!data
  } catch (err) {
    console.warn('[invite-only-gate] invitations unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

export type GateVerdict =
  | { decision: 'allow'; cleared: boolean }
  /** `mark` — поставить метку (только когда режим 'invite' прочитан наверняка и метки ещё нет). */
  | { decision: 'block'; mark: boolean }

/**
 * Пускать ли человека (новый вход через Google, помеченный аккаунт).
 *   • помечен: приглашён — снять метку и пустить; иначе — нет (в любом режиме:
 *     метку снимают приглашение и одобрение персоналом);
 *   • не помечен: режим не 'invite' (прочитан) — пустить; приглашён — пустить;
 *     иначе — нет, с меткой только если режим прочитан (сбой базы — закрыто, без метки).
 */
export async function inviteOnlyDecision(sb: Admin, user: GateUser): Promise<GateVerdict> {
  const invited = async () => !!user.invited_at || (await hasInvitation(sb, user.email))
  if (isSignupBlocked(user)) {
    if (await invited()) {
      await clearSignupBlocked(sb, user.id)
      return { decision: 'allow', cleared: true }
    }
    return { decision: 'block', mark: false }
  }
  const read = await readRegistrationMode()
  if (read.ok && read.mode !== 'invite') return { decision: 'allow', cleared: false }
  if (await invited()) return { decision: 'allow', cleared: false }
  return { decision: 'block', mark: read.ok }
}

/**
 * Ожидающий одобрения без метки — создан ли он в обход приглашения
 * (серверная сторона того же правила, что в middleware). Ошибка чтения — 'unknown'.
 */
export async function pendingSignupVerdictServer(sb: Pick<SupabaseClient, 'from'>, user: GateUser): Promise<PendingVerdict> {
  return pendingSignupVerdict(
    { createdAt: user.created_at, invitedAt: user.invited_at ?? null, email: user.email },
    {
      mode: async () => {
        const r = await readRegistrationMode()
        return r.ok ? { mode: r.mode, since: r.updatedAt } : null
      },
      invited: (email) => invitationOn(sb, email),
    },
  )
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

/**
 * После снятия метки — свежий токен: в JWT сессии claim app_metadata ещё со
 * старой меткой, и middleware закрыл бы API до обновления токена (≤ 1 ч).
 */
export async function refreshAfterClear(supabase: { auth: { refreshSession: () => Promise<unknown> } }): Promise<void> {
  try {
    await supabase.auth.refreshSession()
  } catch (err) {
    console.warn('[invite-only-gate] session refresh after clearing the mark failed:', err instanceof Error ? err.message : err)
  }
}
