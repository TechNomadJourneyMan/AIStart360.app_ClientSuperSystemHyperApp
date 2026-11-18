/**
 * lib/crm/briefing-answer.ts — what the «Рекомендация на сегодня» block shows for an answer of
 * POST /api/pulse/briefing (pure; the page used to ignore every error and keep the old text or the
 * «Нажмите «Обновить»» hint, so a 403 / limit / failure looked like nothing happened).
 */

export type BriefingStatus = 'ok' | 'empty' | 'limited' | 'unavailable' | 'error'

export interface BriefingView {
  status: BriefingStatus
  /** The briefing text (status ok only). */
  text: string | null
  /** What to tell the owner when there is no text. */
  message: string | null
  /** The text came from today's cache. */
  cached: boolean
}

const FALLBACK: Record<Exclude<BriefingStatus, 'ok'>, string> = {
  empty: 'Рекомендацию строить не из чего.',
  limited: 'Лимит генераций или дневной AI-бюджет исчерпан. Попробуйте позже.',
  unavailable: 'AI-рекомендации сейчас недоступны.',
  error: 'Не удалось получить рекомендацию. Попробуйте позже.',
}

const STATUSES: readonly string[] = ['ok', 'empty', 'limited', 'unavailable', 'error']

/** An answer (HTTP status + parsed JSON body, or null when the body was not JSON) → the view. */
export function briefingView(httpStatus: number, body: unknown): BriefingView {
  const b = (body && typeof body === 'object' ? body : {}) as {
    status?: unknown
    briefing?: unknown
    message?: unknown
    cached?: unknown
  }
  const message = typeof b.message === 'string' && b.message.trim() ? b.message : null
  if (b.status === 'ok' && typeof b.briefing === 'string' && b.briefing.trim()) {
    return { status: 'ok', text: b.briefing, message: null, cached: b.cached === true }
  }
  if (typeof b.status === 'string' && STATUSES.includes(b.status) && b.status !== 'ok') {
    const status = b.status as Exclude<BriefingStatus, 'ok'>
    return { status, text: null, message: message ?? FALLBACK[status], cached: false }
  }
  if (httpStatus === 429) return { status: 'limited', text: null, message: message ?? FALLBACK.limited, cached: false }
  if (httpStatus === 504) {
    return { status: 'error', text: null, message: 'Сервер не успел подготовить рекомендацию. Попробуйте позже.', cached: false }
  }
  return { status: 'error', text: null, message: message ?? FALLBACK.error, cached: false }
}

/** The view when the request itself failed (network, timeout). */
export function briefingNetworkError(timedOut: boolean): BriefingView {
  return {
    status: 'error',
    text: null,
    message: timedOut ? 'Сервер не ответил вовремя. Попробуйте позже.' : 'Нет связи с сервером. Проверьте интернет и попробуйте снова.',
    cached: false,
  }
}
