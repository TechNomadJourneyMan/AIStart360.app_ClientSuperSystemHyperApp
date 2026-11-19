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

export interface BriefingSegment {
  text: string
  bold: boolean
}

/**
 * The model's text as plain segments for React (rendered as text nodes — never as HTML): `**x**` /
 * `__x__` become bold segments; headings («# »), list bullets, inline-code backticks and single
 * `*emphasis*` markers are dropped, the words kept. Line breaks stay (the block is pre-line).
 */
export function briefingSegments(text: string): BriefingSegment[] {
  const plain = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))
    .join('\n')
    .replace(/`+/g, '')
  const out: BriefingSegment[] = []
  const re = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g
  let last = 0
  const pushPlain = (s: string) => {
    // a lone *emphasis* marker around words: keep the words
    const t = s.replace(/(^|[\s(«"])\*(?!\s)([^*\n]+?)\*(?=$|[\s.,;:!?)»"])/g, '$1$2').replace(/\*\*/g, '')
    if (t) out.push({ text: t, bold: false })
  }
  for (let m = re.exec(plain); m; m = re.exec(plain)) {
    pushPlain(plain.slice(last, m.index))
    out.push({ text: m[1] ?? m[2], bold: true })
    last = m.index + m[0].length
  }
  pushPlain(plain.slice(last))
  return out
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
