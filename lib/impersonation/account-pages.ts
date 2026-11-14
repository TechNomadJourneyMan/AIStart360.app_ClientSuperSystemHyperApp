/**
 * SR-07b — страницы учётной записи клиента, закрытые во время impersonation.
 *
 * Сессия impersonation — настоящая сессия GoTrue клиента. На этих страницах
 * браузер меняет учётные данные или защиту клиента: `/auth/reset-password`
 * вызывает `supabase.auth.updateUser({ password })` прямо из браузера (мимо
 * Next API и `guard.ts`, текущий пароль не нужен), `/2fa` проходит step-up
 * клиента и тратит его резервные коды, вкладка «Безопасность» настроек меняет
 * пароль, факторы 2FA, ключи и сессии. Сотрудник «от имени клиента» их не
 * открывает: middleware уводит в кабинет клиента с пояснением.
 *
 * Это защита страниц портала. Прямые вызовы GoTrue (`PUT /auth/v1/user`,
 * `/auth/v1/factors`) токеном impersonation закрываются на уровне сессии и БД
 * (короткий срок и отзыв сессии impersonation — отчёт V1/V3).
 *
 * Edge-safe: только строки, без node:* и supabase-js.
 */

export const IMPERSONATION_UNAVAILABLE_KEY = 'impersonation'
/** Куда middleware уводит со страниц учётной записи во время impersonation. */
export const IMPERSONATION_LOCKED_REDIRECT = `/client/home?unavailable=${IMPERSONATION_UNAVAILABLE_KEY}`
export const IMPERSONATION_ACCOUNT_LOCKED_MESSAGE = 'Недоступно в режиме просмотра от имени клиента'
export const IMPERSONATION_ACCOUNT_LOCKED_DETAILS =
  'Пароль, двухфакторную защиту, ключи входа и сеансы клиента меняет только сам клиент. Из режима «от имени клиента» эти страницы не открываются.'
/** Действие в admin_audit_log для заблокированной попытки. */
export const IMPERSONATION_ACCOUNT_PAGE_BLOCKED_ACTION = 'impersonation.account_page_blocked'

/** Страницы целиком (с подпутями). */
const LOCKED_ROUTES = ['/auth/reset-password', '/2fa']
/** Страницы настроек, где вкладка «Безопасность» открывается по `?tab=security`. */
const SETTINGS_ROUTES = ['/settings']
const SECURITY_TAB = 'security'

const matchesRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(route + '/')

/** Страница меняет учётные данные / защиту аккаунта (закрыта в impersonation). */
export function isAccountSecurityPage(pathname: string, search: URLSearchParams): boolean {
  if (LOCKED_ROUTES.some((r) => matchesRoute(pathname, r))) return true
  if (SETTINGS_ROUTES.some((r) => matchesRoute(pathname, r))) {
    return search.getAll('tab').some((t) => t.trim().toLowerCase() === SECURITY_TAB)
  }
  return false
}

/**
 * Why the account pages are locked for this session: an impersonation, or it
 * could not be told now (fail closed); null — an ordinary session.
 */
export type AccountLock = 'impersonation' | 'unknown' | null
export const ACCOUNT_LOCK_UNKNOWN_MESSAGE = 'Не удалось проверить режим сессии'
export const ACCOUNT_LOCK_UNKNOWN_DETAILS = 'Смена пароля и настроек безопасности временно недоступна. Обновите страницу через несколько секунд.'
