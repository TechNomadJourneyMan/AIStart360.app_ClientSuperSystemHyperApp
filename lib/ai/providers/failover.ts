/**
 * lib/ai/providers/failover.ts — try the router's candidates in order (A1).
 *
 * A call moves on to the next candidate when the current one fails with a
 * failover-worthy error: HTTP 401/403/404/408/429/5xx, a timeout or a network
 * error (the key, model or provider is the problem, so another target can
 * answer the same request). Any other error (400 bad request, invalid output)
 * is returned as is — another model would get the same request.
 *
 * Every failover-worthy failure marks the target unhealthy for 5 minutes and
 * every success clears it (health.ts). A target whose provider budget is spent
 * is skipped (its refusal is returned when nothing else answered). Callers keep
 * their per-attempt accounting in `onFailure` (ledger of timed-out attempts,
 * logs). With a single candidate, `retryAlone` retries a retryable error once
 * after a pause (the gateway's pre-A1 behaviour).
 */
import type { ClientFailure } from './client'
import { markFailure, markSuccess } from './health'
import type { ProviderTarget } from './types'

const FAILOVER_STATUSES = new Set([401, 403, 404, 408, 429])

/** Should the next candidate be tried after this failure? */
export function isFailoverWorthy(f: ClientFailure): boolean {
  if (f.status === null) return f.retryable // timeout / network error
  return FAILOVER_STATUSES.has(f.status) || f.status >= 500
}

function failureText(f: ClientFailure): string {
  return f.status !== null ? `HTTP ${f.status}${f.code === 'RATE_LIMITED' ? ' (лимит запросов)' : ''}` : f.message
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
  attempt: (target: ProviderTarget) => Promise<S | ClientFailure>,
  opts: FailoverOptions = {},
): Promise<FailoverResult<S>> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 4)
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
    tried.push(target)
    const alone = candidates.length === 1 && opts.retryAlone
    const rounds = alone ? 2 : 1
    for (let round = 1; round <= rounds && attempts < maxAttempts; round++) {
      attempts += 1
      lastTarget = target
      const res = await attempt(target)
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
        await sleep(opts.retryDelayMs ?? 1500)
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
