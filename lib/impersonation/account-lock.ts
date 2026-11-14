/**
 * SR-07b, вторая линия (главная — middleware.ts): серверный ответ «закрыты ли
 * страницы учётной записи для ЭТОЙ сессии». Страница, которая из браузера
 * меняет пароль или 2FA клиента, не отдаёт форму, если сессия — impersonation
 * или это не удаётся проверить (fail closed, как guard.ts для API).
 */
import { impersonationOfThisSession, type SessionImpersonation } from './guard'
import type { AccountLock } from './account-pages'

export function accountLockOf(state: SessionImpersonation): AccountLock {
  if (state.kind === 'impersonation') return 'impersonation'
  if (state.kind === 'unknown') return 'unknown'
  return null
}

/**
 * `userId` — пользователь сессии, если известен; null — любой (страница без
 * проверенного пользователя, например /auth/reset-password до входа по ссылке).
 */
export async function accountLockForThisSession(userId: string | null): Promise<AccountLock> {
  try {
    return accountLockOf(await impersonationOfThisSession(userId))
  } catch {
    return 'unknown'
  }
}
