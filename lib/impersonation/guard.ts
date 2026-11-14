/**
 * SR-07 — что нельзя делать «от имени клиента», даже в режиме правки.
 *
 * Сессия impersonation — настоящая сессия GoTrue клиента. Режим «только
 * просмотр» и аудит действуют в middleware, но действия, которые меняют саму
 * учётную запись (факторы 2FA и резервные коды, пароль, сессии, привязки
 * каналов и выдача долгоживущих доступов: ссылки на отчёты, OAuth-согласия,
 * согласия на обработку данных), администратор от имени клиента не делает
 * никогда: иначе он может посадить клиенту свой первый фактор и забрать
 * резервные коды (клиент заперт), выкинуть клиента со всех устройств или
 * вынести из кабинета вечную ссылку.
 *
 * Сессия считается сессией impersonation, если:
 *  - есть подлинный cookie impersonation этого же пользователя (даже
 *    просроченный — окончание не превращает сессию в клиентскую), или
 *  - сама сессия GoTrue была выпущена под impersonation (серверная привязка
 *    R-008: работает и когда cookie удалён).
 * Привязку не удалось прочитать → отказ (fail closed): операции редкие, а
 * ошибка в другую сторону отдаёт аккаунт клиента.
 *
 * Прямые вызовы GoTrue/PostgREST токеном impersonation этим не закрываются —
 * см. отчёт Z2 (SR-07b).
 */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { logActivity } from '@/lib/activity/log'
import { NO_SESSION_ID, stepUpSessionKeyFromCookies } from '@/lib/mfa/session-binding'
import { IMP_COOKIE_NAME, readImpersonation } from './token'
import { impersonationForAuthSession } from './server'

export const IMPERSONATION_FORBIDDEN_MESSAGE = 'Недоступно в режиме просмотра от имени клиента'
export const IMPERSONATION_FORBIDDEN_CODE = 'IMPERSONATION_FORBIDDEN'

export type SessionImpersonation =
  | { kind: 'none' }
  | { kind: 'impersonation'; sid: string; adminId: string | null; via: 'cookie' | 'binding' }
  /** Не удалось выяснить (привязка недоступна). */
  | { kind: 'unknown' }

/**
 * Является ли сессия ТЕКУЩЕГО запроса сессией impersonation пользователя
 * `userId` (null — любого пользователя).
 */
export async function impersonationOfThisSession(userId: string | null | undefined): Promise<SessionImpersonation> {
  let token: string | undefined
  let sessionKey: string | null = null
  try {
    const jar = cookies()
    token = jar.get(IMP_COOKIE_NAME)?.value
    sessionKey = stepUpSessionKeyFromCookies(jar.getAll())
  } catch {
    return { kind: 'unknown' }
  }

  if (token) {
    const v = await readImpersonation(token)
    // Подпись верна (claims есть и у просроченного cookie) и это cookie того же
    // пользователя, чья сессия пришла.
    if (v.claims && (!userId || v.claims.uid === userId)) {
      return { kind: 'impersonation', sid: v.claims.sid, adminId: v.claims.aid ?? null, via: 'cookie' }
    }
  }

  if (!sessionKey || sessionKey === NO_SESSION_ID) return { kind: 'none' }
  try {
    const row = await impersonationForAuthSession(sessionKey)
    if (row && (!userId || row.target_user_id === userId)) {
      return { kind: 'impersonation', sid: row.id, adminId: row.admin_id ?? null, via: 'binding' }
    }
    return { kind: 'none' }
  } catch {
    return { kind: 'unknown' }
  }
}

/**
 * Отказ для операции `operation`, если запрос идёт из impersonation (403) или
 * это не удаётся проверить (503); null — можно продолжать. Отказ из
 * impersonation пишется в журнал безопасности клиента.
 */
export async function refuseDuringImpersonation(
  request: Request | null | undefined,
  user: { id: string },
  operation: string,
): Promise<NextResponse | null> {
  const state = await impersonationOfThisSession(user.id)
  if (state.kind === 'none') return null
  if (state.kind === 'unknown') {
    return NextResponse.json(
      { ok: false, error: 'Не удалось проверить режим сессии. Попробуйте позже.', message: 'Не удалось проверить режим сессии. Попробуйте позже.' },
      { status: 503 },
    )
  }
  await logActivity({
    userId: user.id,
    action: 'security.impersonation_action_blocked',
    category: 'security',
    severity: 'critical',
    status: 'failure',
    description: 'Действие с учётной записью отклонено: сессия «от имени клиента»',
    metadata: { operation, impersonation_session_id: state.sid, admin_id: state.adminId, via: state.via },
    req: request ?? undefined,
  })
  return NextResponse.json(
    { ok: false, error: IMPERSONATION_FORBIDDEN_MESSAGE, message: IMPERSONATION_FORBIDDEN_MESSAGE, code: IMPERSONATION_FORBIDDEN_CODE },
    { status: 403 },
  )
}
