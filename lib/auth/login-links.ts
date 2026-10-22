/**
 * lib/auth/login-links.ts — чистые помощники страницы входа (W6).
 */
import { safeInternalPath } from '@/lib/safe-redirect'

/**
 * Адрес возврата после Google. `next` передаётся только когда у входа был
 * явный `?from=`: /auth/callback считает любой `next` явным выбором, и
 * подстановка `/dashboard` по умолчанию уводила персонал (в том числе
 * владельца) в клиентский дашборд вместо ГИГА-Панели.
 */
export function oauthCallbackUrl(origin: string, redirectPath?: string | null): string {
  const url = new URL('/auth/callback', origin)
  const next = safeInternalPath(redirectPath ?? null, '')
  if (next) url.searchParams.set('next', next)
  return url.toString()
}

/**
 * Сообщение для /login по параметрам, с которыми туда возвращают:
 * /auth/verify (?error=link_expired|link_invalid), middleware (?blocked=1).
 * Раньше страница их не читала — после просроченной ссылки человек видел
 * обычную форму без объяснения.
 */
export function loginNotice(params: { get(name: string): string | null }): string | null {
  if (params.get('blocked') === '1') {
    return 'Доступ к аккаунту закрыт. Если это ошибка — напишите в поддержку.'
  }
  switch (params.get('error')) {
    case 'link_expired':
      return 'Ссылка из письма устарела или уже использована. Запросите новую — она действует один час.'
    case 'link_invalid':
      return 'Ссылка из письма неполная. Откройте её из письма целиком или запросите новую.'
    default:
      return null
  }
}
