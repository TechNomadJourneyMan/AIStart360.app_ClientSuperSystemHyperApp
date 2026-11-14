/**
 * lib/runtime/webhook-log.ts — one structured line per refused or failed webhook delivery
 * (INT-01 / INT-02 / R-138).
 *
 * The webhook routes (WhatsApp bridge, Meta, Telegram inbox, Kaspi) answered 401 / 403 / 413 / 500 /
 * 503 without a word: a wrong secret after a rotation, a bridge that is switched off or a queue
 * that refuses looked the same from outside, and nobody saw it until customers complained.
 *
 * What a line carries: the route, the status, a fixed reason code, a request id (the platform's
 * header when it sends one, else a fresh one), and for a caught error its name / code — NEVER the
 * body, a header value, a phone number, a message text or an error message (they may carry customer
 * data). Both runtimes: Web APIs only.
 */

export interface WebhookRejection {
  route: string
  status: number
  /** A fixed code: 'bad_signature', 'not_configured', 'enqueue_failed', … */
  reason: string
  requestId: string
  /** A caught error: only its name / code is logged. */
  error?: unknown
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/

/** The platform's request id (Railway: x-railway-request-id) when it is a plain token, else a new one. */
export function webhookRequestId(req: Pick<Request, 'headers'>): string {
  for (const name of ['x-railway-request-id', 'x-request-id']) {
    const value = req.headers.get(name)?.trim()
    if (value && SAFE_ID.test(value)) return value
  }
  return globalThis.crypto?.randomUUID?.() ?? `wh-${Date.now().toString(36)}`
}

function errorLabel(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) return code
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' && name ? name.slice(0, 40) : 'Error'
}

/** Writes the line: console.error for 5xx, console.warn for 4xx. */
export function logWebhookRejection(entry: WebhookRejection): void {
  const line = JSON.stringify({
    event: 'webhook_rejected',
    route: entry.route,
    status: entry.status,
    reason: entry.reason,
    request_id: entry.requestId,
    ...(entry.error !== undefined ? { error: errorLabel(entry.error) } : {}),
  })
  if (entry.status >= 500) console.error(line)
  else console.warn(line)
}

/**
 * A per-request helper for a route: `const refuse = webhookRefusal('webhooks/meta', req)`, then
 * `return refuse(401, 'bad_signature', respond)` logs the line and returns `respond(status)`.
 */
export function webhookRefusal(route: string, req: Pick<Request, 'headers'>) {
  let requestId: string | null = null
  return <R>(status: number, reason: string, respond: (status: number) => R, error?: unknown): R => {
    requestId ??= webhookRequestId(req)
    logWebhookRejection({ route, status, reason, requestId, ...(error !== undefined ? { error } : {}) })
    return respond(status)
  }
}
