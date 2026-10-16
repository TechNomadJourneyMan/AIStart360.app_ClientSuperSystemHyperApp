/**
 * lib/moderation/client.ts — разбор ответа API на клиенте (без серверных
 * зависимостей): если сервер отказал из-за мата (400, code: 'profanity'),
 * вернуть его понятный текст, чтобы показать в тосте или рядом с полем.
 */

export interface ProfanityRejection {
  message: string
  field: string | null
}

/** Ответ API → текст отказа из-за мата, или null. */
export function profanityRejection(json: unknown): ProfanityRejection | null {
  if (!json || typeof json !== 'object') return null
  const j = json as { code?: unknown; error?: unknown; field?: unknown }
  if (j.code !== 'profanity' || typeof j.error !== 'string') return null
  return { message: j.error, field: typeof j.field === 'string' ? j.field : null }
}

/** Текст ошибки для пользователя: отказ из-за мата или запасной вариант. */
export function apiErrorMessage(json: unknown, fallback: string): string {
  return profanityRejection(json)?.message ?? fallback
}
