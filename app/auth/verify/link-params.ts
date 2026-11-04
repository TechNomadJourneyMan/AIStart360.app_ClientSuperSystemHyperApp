import { safeInternalPath } from '@/lib/safe-redirect'

/**
 * Параметры одноразовой ссылки из нашего письма (/api/v1/auth/email-link,
 * приглашения): общий разбор для страницы подтверждения /auth/confirm и для
 * POST /auth/verify, чтобы обе стороны одинаково понимали тип и `next`.
 */
export type EmailLinkType = 'recovery' | 'invite' | 'magiclink'

export interface EmailLinkParams {
  tokenHash: string | null
  type: EmailLinkType
  /** Только путь на нашем же сайте — чужой адрес заменяется значением по умолчанию. */
  next: string
}

export function parseEmailLinkParams(get: (key: string) => string | null | undefined): EmailLinkParams {
  const raw = get('type')
  const type: EmailLinkType = raw === 'recovery' ? 'recovery' : raw === 'invite' ? 'invite' : 'magiclink'
  // Приглашённый ещё без пароля — ведём его на страницу, где он его задаёт.
  const fallback = type === 'magiclink' ? '/dashboard' : '/auth/reset-password'
  const token = (get('token_hash') ?? '').trim()
  return {
    // Токен — hex/base64url; всё прочее — мусор, а не ссылка.
    tokenHash: token && token.length <= 512 && /^[A-Za-z0-9_-]+$/.test(token) ? token : null,
    type,
    next: safeInternalPath(get('next'), fallback),
  }
}
