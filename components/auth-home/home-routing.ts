/**
 * Главная (/) — окно входа и регистрации. Чистые функции выбора, без React и
 * Next, чтобы их можно было проверить юнит-тестом.
 *
 * Middleware пропускает `/` без проверки сессии (список публичных путей в
 * middleware.ts), поэтому вошедшего пользователя отправляет страница. Мы не
 * повторяем здесь разбор роли: при наличии cookie сессии Supabase отправляем
 * на /login, а там middleware уже ведёт вошедшего в его кабинет (роль из
 * profiles + staff_roles → roleLandingPath), выкидывает заблокированного и
 * показывает форму, если сессия протухла. Один источник истины, ноль сетевых
 * запросов на главной для гостя.
 */

export type HomeTab = 'login' | 'register'

/** Supabase-сессия в cookie: `sb-<ref>-auth-token` (в т.ч. чанки `.0`, `.1`). Как в middleware.ts. */
export function hasSupabaseSessionCookie(cookies: ReadonlyArray<{ name: string }>): boolean {
  return cookies.some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
}

/** Куда отправить посетителя главной; `null` — показать окно входа. */
export function homeRedirectFor(cookies: ReadonlyArray<{ name: string }>): string | null {
  return hasSupabaseSessionCookie(cookies) ? '/login' : null
}

/** Стартовая вкладка: `/?tab=register` открывает регистрацию, всё прочее — вход. */
export function initialHomeTab(params: { tab?: string | string[] } | undefined): HomeTab {
  const raw = params?.tab
  const tab = Array.isArray(raw) ? raw[0] : raw
  return tab === 'register' ? 'register' : 'login'
}

/** Основной маркетинговый сайт продукта. */
export const PRODUCT_SITE_URL = 'https://aistart360.app'
