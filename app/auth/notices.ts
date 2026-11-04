/**
 * Сообщения страниц входа по параметрам адреса: сюда приводят middleware
 * (?blocked=1 — заблокированный аккаунт) и /auth/verify (?error=link_expired |
 * link_invalid — одноразовая ссылка из письма не сработала).
 */
export interface LoginNotice {
  tone: 'error' | 'info'
  text: string
  /** Ссылка «запросить новую» — для устаревших ссылок из письма. */
  action?: { href: string; label: string }
}

export function loginNoticeFrom(get: (key: string) => string | null | undefined): LoginNotice | null {
  if (get('blocked') === '1') {
    return { tone: 'error', text: 'Аккаунт заблокирован. Свяжитесь с поддержкой.' }
  }
  const error = get('error')
  if (error === 'link_expired') {
    return {
      tone: 'error',
      text: 'Ссылка из письма устарела или уже была использована. Запросите новую.',
      action: { href: '/forgot-password', label: 'Восстановить пароль' },
    }
  }
  if (error === 'link_invalid') {
    return {
      tone: 'error',
      text: 'Ссылка из письма недействительна — возможно, она открылась не целиком. Запросите новую.',
      action: { href: '/forgot-password', label: 'Восстановить пароль' },
    }
  }
  return null
}
