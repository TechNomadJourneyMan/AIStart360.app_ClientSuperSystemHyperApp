/**
 * lib/registration/invite-request-shared.ts — то, что о «Запросе приглашения»
 * нужно и серверу, и ГИГА-панели (без серверных зависимостей).
 *
 * Запрос хранится в admin_requests: type = 'registration', "userId" = NULL
 * (аккаунта ещё нет), source = 'invite_request', payload.kind = 'invite_request'.
 */
export const INVITE_REQUEST_SOURCE = 'invite_request'
export const INVITE_REQUEST_KIND = 'invite_request'

/** Это запрос приглашения (а не регистрация аккаунта)? */
export function isInviteRequestRow(r: { type?: string | null; source?: string | null; category?: string | null } | null | undefined): boolean {
  if (!r) return false
  const type = r.type ?? r.category
  return type === 'registration' && r.source === INVITE_REQUEST_SOURCE
}
