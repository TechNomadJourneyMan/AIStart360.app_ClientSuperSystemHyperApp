/**
 * lib/ai/providers/failover.ts — try the router's candidates in order (A1).
 *
 * A call moves on to the next candidate when the current one fails with a
 * failover-worthy error: HTTP 401/402/403/404/408/429/5xx, a timeout or a
 * network error (the key, account, model or provider is the problem — 402 is
 * OpenRouter's "insufficient credits" — so another target can answer the same
 * request). Any other error (400 bad request, invalid output) is returned as
 * is — another model would get the same request — unless the caller's
 * `alsoFailoverOn` says otherwise: the chat callers pass
 * isModelOrFormatRejection (a 400 that blames the model id or the requested
 * output format, not the prompt).
 *
 * Every failover-worthy failure marks the target unhealthy for 5 minutes and
 * every success clears it (health.ts); an `alsoFailoverOn` failure does not
 * (the target may serve other requests fine). A target whose provider budget
 * is spent is skipped (its refusal is returned when nothing else answered).
 * Callers keep their per-attempt accounting in `onFailure` (ledger of
 * timed-out attempts, logs). With a single candidate, `retryAlone` retries a
 * retryable error once after a pause (the gateway's pre-A1 behaviour).
 *
 * Deadline (R-016): `deadlineMs` is ONE budget for the whole chain — before it, 4 attempts of
 * 45–60 s each could keep a user waiting 240 s. Each attempt is handed the time it may take
 * (`budget.timeoutMs` = its own `attemptTimeoutMs`, never past the deadline, nor past the
 * ambient deadline of the request, lib/runtime/deadline.ts); no attempt starts with less than
 * `minAttemptMs` left. A spent budget ends the chain with a TIMEOUT failure (DEADLINE_MESSAGE):
 * callers already turn a failure into their «ИИ недоступен» answer (chatWithOpenRouter → null,
 * callLlm → error 'TIMEOUT').
 */
import { deadlineRemainingMs } from '@/lib/runtime/deadline'
import type { ClientFailure } from './client'
import { markFailure, markSuccess } from './health'
import type { ProviderTarget } from './types'

const FAILOVER_STATUSES = new Set([401, 402, 403, 404, 408, 429])

/** Should the next candidate be tried after this failure? */
export function isFailoverWorthy(f: ClientFailure): boolean {
  if (f.status === null) return f.retryable // timeout / network error
  return FAILOVER_STATUSES.has(f.status) || f.status >= 500
}

/**
 * The provider's error text of a 400 that rejects the model or the output
 * format rather than the prompt: "Claude is not a valid model ID", unknown /
 * unsupported model, response_format / json_schema / structured output the
 * model or endpoint cannot do, "… is not supported". A false positive (the
 * error echoes a prompt that mentions a model) costs one more rejected call.
 */
const MODEL_OR_FORMAT_400 =
  /\bmodel|not a valid|response_format|json_schema|json_object|structured[ _-]?output|unsupported|not supported/i

/**
 * A 400 that another candidate may answer (chat callers' `alsoFailoverOn`).
 * A generic 400 (malformed messages, a bad prompt) still stops the chain.
 * Reads `detail` only to classify — never logs it (it may echo client data).
 */
export function isModelOrFormatRejection(f: ClientFailure): boolean {
  if (f.status !== 400) return false
  return MODEL_OR_FORMAT_400.test(`${f.message} ${f.detail ?? ''}`)
}

function failureText(f: ClientFailure): string {
  if (f.status === null) return f.message
  const why = f.code === 'RATE_LIMITED' ? ' (лимит запросов)' : f.status === 402 ? ' (нет кредитов / оплаты)' : ''
  return `HTTP ${f.status}${why}`
}

/**
 * Default budgets (R-016):
 *   - userMs 45 s: someone is waiting for the answer. 45 s already is the per-attempt timeout the
 *     chat callers used; a slow Sonnet answer still fits, a failover after a hung provider too
 *     when the first one fails fast (a 4xx / 5xx / network error comes back in < 1–2 s);
 *   - backgroundMs 120 s: agent runs. Below the 125 s worst case the agent queue plans one model
 *     call with (lib/agents/queue.ts LLM_CALL_WORST_MS), so a drain never claims a task it cannot finish.
 * Env: AI_CALL_DEADLINE_MS, AI_BACKGROUND_DEADLINE_MS.
 */
export const AI_DEADLINE_DEFAULTS = Object.freeze({ userMs: 45_000, backgroundMs: 120_000 })

export const DEADLINE_MESSAGE = 'истёк общий лимит времени ответа ИИ'

/**
 * The budget of one call chain: the default for its kind (env-tunable), but never below the
 * caller's own per-attempt timeout — a caller that asks for one 90 s attempt still gets it.
 */
export function aiDeadlineMs(
  kind: 'user' | 'background',
  attemptTimeoutMs: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env[kind === 'user' ? 'AI_CALL_DEADLINE_MS' : 'AI_BACKGROUND_DEADLINE_MS'])
  const base = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : kind === 'user' ? AI_DEADLINE_DEFAULTS.userMs : AI_DEADLINE_DEFAULTS.backgroundMs
  return Math.max(base, attemptTimeoutMs)
}

/** What one attempt may spend. */
export interface AttemptBudget {
  timeoutMs: number
}

export interface FailoverOptions {
  /** A refusal message skips the candidate (provider budget spent). */
  budgetCheck?: (target: ProviderTarget) => Promise<string | null>
  /** Called after every failed attempt (accounting, logs). */
  onFailure?: (target: ProviderTarget, failure: ClientFailure) => Promise<void> | void
  /** Also fail over on these failures (e.g. 400 from a model without tool support). */
  alsoFailoverOn?: (target: ProviderTarget, failure: ClientFailure) => boolean
  /** Single candidate: retry a retryable failure once after `retryDelayMs`. */
  retryAlone?: boolean
  retryDelayMs?: number
  /** Upper bound of attempts across all candidates (default 4). */
  maxAttempts?: number
  /** One budget for every attempt and pause together (R-016). Unset: only the ambient deadline. */
  deadlineMs?: number
  /** Timeout of one attempt (handed to `attempt` as budget.timeoutMs). Default 45 s. */
  attemptTimeoutMs?: number
  /** No attempt starts with less time than this left (default 1 s). */
  minAttemptMs?: number
  /** Clock (tests). Default Date.now. */
  now?: () => number
}

export type FailoverResult<S> =
  | { ok: true; result: S; target: ProviderTarget; attempts: number; tried: ProviderTarget[] }
  | {
      ok: false
      /** The last failure (null when no call was made). */
      failure: ClientFailure | null
      /** Budget refusal when every candidate was refused. */
      refusal: string | null
      target: ProviderTarget | null
      attempts: number
      tried: ProviderTarget[]
    }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runWithFailover<S extends { ok: true }>(
  candidates: readonly ProviderTarget[],
  attempt: (target: ProviderTarget, budget: AttemptBudget) => Promise<S | ClientFailure>,
  opts: FailoverOptions = {},
): Promise<FailoverResult<S>> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 4)
  const now = opts.now ?? Date.now
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? 45_000
  const minAttemptMs = opts.minAttemptMs ?? 1_000
  const ambient = deadlineRemainingMs()
  const total = opts.deadlineMs === undefined ? ambient : ambient === null ? opts.deadlineMs : Math.min(opts.deadlineMs, ambient)
  const deadlineAt = total === null ? Number.POSITIVE_INFINITY : now() + total
  const left = () => deadlineAt - now()
  const spent = (attempts: number, tried: ProviderTarget[], target: ProviderTarget | null): FailoverResult<S> => ({
    ok: false,
    failure: { ok: false, code: 'TIMEOUT', status: null, message: DEADLINE_MESSAGE, retryable: false, detail: null },
    refusal: null,
    target,
    attempts,
    tried,
  })
  let attempts = 0
  let lastFailure: ClientFailure | null = null
  let lastTarget: ProviderTarget | null = null
  let refusal: string | null = null
  const tried: ProviderTarget[] = []

  for (const target of candidates) {
    if (attempts >= maxAttempts) break
    const refused = opts.budgetCheck ? await opts.budgetCheck(target) : null
    if (refused) {
      refusal = refusal ?? refused
      continue
    }
    if (left() < minAttemptMs) return spent(attempts, tried, lastTarget)
    tried.push(target)
    const alone = candidates.length === 1 && opts.retryAlone
    const rounds = alone ? 2 : 1
    for (let round = 1; round <= rounds && attempts < maxAttempts; round++) {
      if (left() < minAttemptMs) return spent(attempts, tried, lastTarget)
      attempts += 1
      lastTarget = target
      const res = await attempt(target, { timeoutMs: Math.max(1, Math.min(attemptTimeoutMs, left())) })
      if (res.ok) {
        markSuccess(target)
        return { ok: true, result: res as S, target, attempts, tried }
      }
      const f = res as ClientFailure
      lastFailure = f
      await opts.onFailure?.(target, f)
      const worthy = isFailoverWorthy(f)
      if (worthy) markFailure(target, failureText(f))
      if (round < rounds && f.retryable) {
        const delay = opts.retryDelayMs ?? 1500
        if (left() < delay + minAttemptMs) return spent(attempts, tried, target)
        await sleep(delay)
        continue
      }
      if (!worthy && !opts.alsoFailoverOn?.(target, f)) {
        return { ok: false, failure: f, refusal: null, target, attempts, tried }
      }
      break
    }
  }
  return { ok: false, failure: lastFailure, refusal: lastFailure ? null : refusal, target: lastTarget, attempts, tried }
}
