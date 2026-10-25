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

/**
 * Русский текст для отказа Supabase при входе/регистрации. Раньше всё, что не
 * совпало с парой известных кодов, показывалось как есть — по-английски
 * («Request rate limit reached», «Failed to fetch»). Русский текст
 * (например, из нашего API) пропускается без изменений.
 */
export function friendlyAuthError(message: string | null | undefined, fallback = 'Не удалось войти. Попробуйте ещё раз.'): string {
  const msg = (message ?? '').trim()
  if (!msg) return fallback
  if (/[а-яё]/i.test(msg)) return msg
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials') || m === 'wrong_password') {
    return 'Неверный адрес почты или пароль. Если вы регистрировались через Google — нажмите «Google» или задайте пароль через «Забыли пароль?».'
  }
  if (/rate limit|too many/.test(m)) return 'Слишком много попыток. Подождите несколько минут и попробуйте снова.'
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/.test(m)) {
    return 'Нет связи с сервером. Проверьте интернет и попробуйте снова.'
  }
  if (m.includes('banned')) return 'Доступ к аккаунту закрыт. Если это ошибка — напишите в поддержку.'
  if (m.includes('email not confirmed')) return 'Адрес почты не подтверждён. Откройте письмо со ссылкой или войдите по ссылке на почту.'
  if (/provider is not enabled|unsupported provider/.test(m)) return 'Этот способ входа сейчас недоступен. Войдите по адресу почты и паролю.'
  return fallback
}
