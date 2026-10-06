/**
 * lib/integrations/http.ts — the one HTTP path of every integration adapter.
 *
 *   • a request budget per run (no unbounded paging: an adapter that runs out
 *     stops and keeps its cursor, the next run continues);
 *   • the run's deadline (DeadlineReached — distinct from BudgetExhausted:
 *     a batch that ran out of time says nothing about the provider's window);
 *   • a timeout per request;
 *   • error classification: auth (401 → the connection needs new
 *     credentials), rate_limit (429, with the provider's retry hint),
 *     transient (5xx, timeouts, network), config (400/403/404/412: settings or
 *     rights are wrong — retrying will not help), permanent (other 4xx);
 *   • sanitised messages: an error text never carries a credential, a query
 *     string or a long token-like run of characters, and is capped — it is
 *     stored in integration_connections.last_error and shown to the client.
 */

export type ErrorKind = 'auth' | 'rate_limit' | 'transient' | 'config' | 'permanent'

export class IntegrationError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'IntegrationError'
  }
}

/** The run's request budget is spent: stop paging, keep the cursor. */
export class BudgetExhausted extends Error {
  constructor() {
    super('request budget exhausted')
    this.name = 'BudgetExhausted'
  }
}

/**
 * The run's deadline passed before the next request: stop, keep the cursor
 * and continue soon. Not a sign that the provider window is too large (the
 * batch simply ran long), so the sync engine neither shrinks the window nor
 * counts a failure.
 */
export class DeadlineReached extends Error {
  constructor() {
    super('run deadline reached')
    this.name = 'DeadlineReached'
  }
}

export interface RequestBudget {
  remaining: number
  /** Epoch ms after which no new request starts (the run's deadline). */
  deadlineAt?: number
}

export interface HttpContext {
  fetch: typeof fetch
  budget: RequestBudget
  /** Secrets of the connection: masked out of any error text. */
  secrets: readonly string[]
  timeoutMs?: number
}

export interface JsonRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Provider label used in messages («МойСклад: …»). */
  label: string
  /** Read a retry hint (ms) from response headers (provider-specific). */
  retryAfter?: (headers: Headers) => number | null
}

export interface JsonResponse<T> {
  status: number
  headers: Headers
  data: T
}

const DEFAULT_TIMEOUT_MS = 25_000
const MAX_MESSAGE = 300

export function classifyStatus(status: number): ErrorKind {
  if (status === 401) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'transient'
  if (status === 400 || status === 403 || status === 404 || status === 412 || status === 422) return 'config'
  return 'permanent'
}

/** Text safe to store and show: no secrets, no query strings, no token-like runs. */
export function sanitizeMessage(text: string, secrets: readonly string[] = []): string {
  let s = String(text ?? '')
  for (const secret of secrets) {
    if (secret && secret.length >= 4) s = s.split(secret).join('***')
  }
  s = s
    .replace(/(https?:\/\/[^\s?#"']+)\?[^\s"']*/gi, '$1?…')
    .replace(/\b(Bearer|Basic|OAuth)\s+[^\s"',]+/gi, '$1 ***')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?(-----END [^-]+-----|$)/g, '***')
    .replace(/[A-Za-z0-9_\-+/=.]{32,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s
}

function providerDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body.slice(0, 200) : ''
  const b = body as Record<string, unknown>
  const errors = b.errors
  if (Array.isArray(errors) && errors.length) {
    const e = errors[0] as Record<string, unknown>
    return String(e.error ?? e.message ?? e.detail ?? e.title ?? '')
  }
  if (b.error && typeof b.error === 'object') {
    const e = b.error as Record<string, unknown>
    return String(e.message ?? e.status ?? '')
  }
  return String(b.message ?? b.detail ?? b.title ?? b.error_description ?? b.error ?? '')
}

/** Take one request from the budget or stop the run (budget spent / deadline passed). */
export function take(budget: RequestBudget): void {
  if (budget.remaining <= 0) throw new BudgetExhausted()
  if (budget.deadlineAt !== undefined && Date.now() > budget.deadlineAt) throw new DeadlineReached()
  budget.remaining -= 1
}

export async function requestJson<T>(ctx: HttpContext, req: JsonRequest): Promise<JsonResponse<T>> {
  take(ctx.budget)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let res: Response
  try {
    res = await ctx.fetch(req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
    throw new IntegrationError(
      'transient',
      `${req.label}: ${aborted ? 'превышено время ожидания ответа' : 'сервис недоступен'}`,
      null,
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text().catch(() => '')
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const kind = classifyStatus(res.status)
    const detail = sanitizeMessage(providerDetail(data), ctx.secrets)
    const retry = kind === 'rate_limit' ? (req.retryAfter?.(res.headers) ?? retryAfterHeader(res.headers)) : null
    const prefix = kind === 'auth'
      ? 'ключ не принят (нужно переподключить)'
      : kind === 'rate_limit'
        ? 'превышен лимит запросов'
        : kind === 'config'
          ? 'запрос отклонён (проверьте права ключа и настройки)'
          : kind === 'transient'
            ? 'временная ошибка сервиса'
            : 'ошибка запроса'
    throw new IntegrationError(kind, sanitizeMessage(`${req.label}: ${prefix} (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`, ctx.secrets), res.status, retry)
  }
  if (data === null || typeof data === 'string') {
    // A 2xx without JSON is a contract change, not a transient blip.
    if (res.status === 204) return { status: res.status, headers: res.headers, data: null as T }
    throw new IntegrationError('permanent', `${req.label}: ответ не в формате JSON`, res.status)
  }
  return { status: res.status, headers: res.headers, data: data as T }
}

/** Standard Retry-After (seconds or HTTP date) → ms. */
export function retryAfterHeader(headers: Headers): number | null {
  const v = headers.get('retry-after')
  if (!v) return null
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return Math.min(n * 1000, 24 * 3600_000)
  const t = Date.parse(v)
  return Number.isFinite(t) ? Math.max(0, Math.min(t - Date.now(), 24 * 3600_000)) : null
}

/** Number or null (strings like "367.5" included). */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}
