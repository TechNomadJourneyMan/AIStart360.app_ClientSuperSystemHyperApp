/**
 * lib/admin/invite-shared.ts — то, что нужно и серверу, и странице панели.
 *
 * Отдельный модуль без серверных зависимостей: страница приглашений —
 * клиентская, и импорт lib/email (Resend) тянул бы почтовый пакет в браузерный
 * бандл, из-за чего падала сборка.
 */

export type InviteOutcome = 'invited' | 'relinked' | 'failed'

export interface InviteResult {
  email: string
  outcome: InviteOutcome
  /** Что показать в панели рядом с адресом. */
  message: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return EMAIL_RE.test(email) && email.length <= 200 ? email : null
}

/** Разбирает список адресов из textarea: запятые, точки с запятой, переводы строк. */
export function parseEmailList(raw: string): { emails: string[]; invalid: string[] } {
  const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  const emails: string[] = []
  const invalid: string[] = []
  for (const part of parts) {
    const email = normalizeEmail(part)
    if (!email) invalid.push(part)
    else if (!emails.includes(email)) emails.push(email)
  }
  return { emails, invalid }
}
