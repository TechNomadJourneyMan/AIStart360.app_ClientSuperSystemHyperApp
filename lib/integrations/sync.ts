/**
 * lib/integrations/sync.ts — one synchronisation of one connection, and the
 * bounded batch the integration_sync agent runs (lib/agents/definitions/
 * integration-sync.ts).
 *
 *   claim (lease)  → decrypt credentials → adapter.sync (request budget)
 *   success        → facts upserted + cursor advanced in ONE transaction
 *                    (idempotent: a re-run of the same days rewrites the same rows)
 *   auth error     → status needs_reauth (no more runs until reconnected) and an
 *                    INTEGRATION_FAILED platform event at once
 *   rate limit     → not a failure: next run after the provider's hint
 *   budget spent   → not a failure: the window halves (cursor.window_days), the
 *                    next run continues; at one day it becomes a failure. A
 *                    later run that uses at most half of the budget doubles
 *                    the window back towards the adapter's maxDaysPerRun.
 *   deadline       → (the batch ran out of time, DeadlineReached) not a failure
 *                    and not a budget signal: cursor, window, status and error
 *                    count stay; the connection is due again in a few minutes
 *   no key store   → SECRETS_ENCRYPTION_KEY missing / invalid on this server:
 *                    runDueSyncs claims nothing (logged once, 'not_configured');
 *                    a connection already claimed is released unchanged. Only
 *                    a decrypt failure WITH a valid key means needs_reauth.
 *   other errors   → error_count + 1, exponential backoff; at
 *                    FAILURE_ALERT_THRESHOLD consecutive failures status 'error'
 *                    and an INTEGRATION_FAILED event to staff (once per day)
 *
 * Nothing here loops without bound: a batch takes at most `limit` connections
 * and stops at its deadline; an adapter stops at its request budget.
 */
import { emitPlatformEvent, type PlatformEventInput } from '@/lib/events/platform'
import { CredentialsStorageNotReadyError, CredentialsUnavailableError, credentialsStorageReady, openCredentials, secretValues } from './credentials'
import { BudgetExhausted, DeadlineReached, IntegrationError, sanitizeMessage, type ErrorKind } from './http'
import { adapterFor } from './providers'
import type { ProviderAdapter } from './providers/types'
import { providerLabel } from './registry'
import {
  claimConnection,
  claimDueConnections,
  finishSyncFailure,
  finishSyncSuccess,
  isIntegrationsTableMissing,
  releaseSync,
  type ClaimedConnection,
  type ConnectionStatus,
} from './store'

export const FAILURE_ALERT_THRESHOLD = 3
export const LEASE_SECONDS = 180
const MAX_BACKOFF_MINUTES = 24 * 60
/** A connection released unchanged because the key store is not configured is retried after this. */
const NOT_CONFIGURED_RETRY_MINUTES = 15

export interface SyncDeps {
  fetch?: typeof fetch
  /** Epoch ms: no request starts after it (the agent run's deadline). */
  deadlineAt?: number
  now?: () => Date
  /** Platform events (INTEGRATION_FAILED). Default: emitPlatformEvent. */
  emit?: (e: PlatformEventInput) => Promise<unknown>
}

/**
 * partial         the request budget ran out: window halved, next run soon
 * deferred        the run's deadline passed: nothing changed, next run soon
 * not_configured  no key store on this server: released unchanged
 */
export type SyncOutcomeStatus = 'synced' | 'failed' | 'needs_reauth' | 'rate_limited' | 'partial' | 'deferred' | 'not_configured' | 'lease_lost'

export interface SyncOutcome {
  connectionId: string
  companyId: string
  provider: string
  status: SyncOutcomeStatus
  factsWritten: number
  errorKind?: ErrorKind
  message?: string
  alerted: boolean
}

const minutes = (now: Date, m: number) => new Date(now.getTime() + m * 60_000)

async function alert(deps: SyncDeps, conn: ClaimedConnection, kind: ErrorKind, message: string, now: Date): Promise<boolean> {
  const emit = deps.emit ?? emitPlatformEvent
  try {
    await emit({
      name: 'INTEGRATION_FAILED',
      companyId: conn.companyId,
      subjectType: 'integration_connection',
      subjectId: conn.id,
      actor: 'agent:integration_sync',
      payload: { provider: providerLabel(conn.provider), provider_key: conn.provider, error_kind: kind, error: message },
      // One alert per connection, kind and day.
      dedupeKey: `integration_failed:${conn.id}:${kind}:${now.toISOString().slice(0, 10)}`,
    })
    return true
  } catch (err) {
    console.error('[integrations] INTEGRATION_FAILED event not written', err instanceof Error ? err.message.split('\n')[0] : 'error')
    return false
  }
}

function windowDays(cursor: Record<string, unknown>): number | null {
  const n = Number(cursor.window_days)
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * Cursor after a successful run: a window that was halved earlier doubles
 * back towards the adapter's maxDaysPerRun once a run fetched something and
 * used at most half of its request budget (the key disappears at the maximum).
 */
export function relaxWindow(cursor: Record<string, unknown>, requestsUsed: number, adapter: Pick<ProviderAdapter, 'maxDaysPerRun' | 'requestBudget'>): Record<string, unknown> {
  const current = windowDays(cursor)
  if (current === null) return cursor
  const rest = { ...cursor }
  delete rest.window_days
  if (current >= adapter.maxDaysPerRun) return rest
  if (requestsUsed <= 0 || requestsUsed * 2 > adapter.requestBudget) return cursor
  const next = Math.min(current * 2, adapter.maxDaysPerRun)
  return next >= adapter.maxDaysPerRun ? rest : { ...rest, window_days: next }
}

export async function syncClaimed(conn: ClaimedConnection, deps: SyncDeps = {}): Promise<SyncOutcome> {
  const now = (deps.now ?? (() => new Date()))()
  const base = { connectionId: conn.id, companyId: conn.companyId, provider: conn.provider }
  const adapter = adapterFor(conn.provider)
  let secrets: string[] = []

  const fail = async (kind: ErrorKind, rawMessage: string, opts: { retryAfterMs?: number | null } = {}): Promise<SyncOutcome> => {
    const message = sanitizeMessage(rawMessage, secrets)
    const counted = kind !== 'rate_limit'
    const nextCount = conn.errorCount + (counted ? 1 : 0)
    let status: ConnectionStatus = nextCount >= FAILURE_ALERT_THRESHOLD ? 'error' : 'connected'
    let next: Date
    if (kind === 'auth') {
      status = 'needs_reauth'
      next = minutes(now, MAX_BACKOFF_MINUTES)
    } else if (kind === 'rate_limit') {
      const hint = opts.retryAfterMs ?? 0
      next = new Date(now.getTime() + Math.max(hint, (adapter?.backfillIntervalMinutes ?? 15) * 60_000))
    } else {
      next = minutes(now, Math.min(15 * 2 ** Math.min(nextCount, 7), MAX_BACKOFF_MINUTES))
    }
    const res = await finishSyncFailure(conn, { kind, message, nextSyncAt: next, status, countAsFailure: counted })
    if (res.leaseLost) return { ...base, status: 'lease_lost', factsWritten: 0, errorKind: kind, message, alerted: false }
    const shouldAlert = kind === 'auth' || (counted && res.errorCount >= FAILURE_ALERT_THRESHOLD)
    const alerted = shouldAlert ? await alert(deps, conn, kind, message, now) : false
    return {
      ...base,
      status: kind === 'auth' ? 'needs_reauth' : kind === 'rate_limit' ? 'rate_limited' : 'failed',
      factsWritten: 0,
      errorKind: kind,
      message,
      alerted,
    }
  }

  if (!adapter) return fail('config', `${providerLabel(conn.provider)}: живой синхронизации нет — данные загружаются выгрузками`)

  let secret: Record<string, string>
  try {
    secret = openCredentials(conn.secretCiphertext)
    secrets = secretValues(secret)
  } catch (err) {
    if (err instanceof CredentialsStorageNotReadyError) {
      // This server cannot open any key — not the connection's fault: release it unchanged.
      logNotConfiguredOnce()
      const res = await releaseSync(conn, minutes(now, NOT_CONFIGURED_RETRY_MINUTES))
      return { ...base, status: res.leaseLost ? 'lease_lost' : 'not_configured', factsWritten: 0, errorKind: 'config', message: err.message, alerted: false }
    }
    return fail('auth', err instanceof CredentialsUnavailableError ? err.message : 'ключ интеграции недоступен')
  }

  const ctx = { fetch: deps.fetch ?? fetch, now, budget: { remaining: adapter.requestBudget, deadlineAt: deps.deadlineAt }, secrets }
  try {
    const result = await adapter.sync(secret, conn.settings, conn.cursor, ctx)
    const next = minutes(now, result.caughtUp ? adapter.refreshIntervalMinutes : adapter.backfillIntervalMinutes)
    const cursor = relaxWindow(result.cursor, adapter.requestBudget - ctx.budget.remaining, adapter)
    const done = await finishSyncSuccess(conn, { facts: result.facts, cursor, accountLabel: result.accountLabel ?? null, nextSyncAt: next })
    if (done.leaseLost) return { ...base, status: 'lease_lost', factsWritten: 0, alerted: false }
    return { ...base, status: 'synced', factsWritten: done.written, alerted: false }
  } catch (err) {
    if (err instanceof DeadlineReached) {
      // The batch ran out of time — says nothing about the provider: keep everything, come back soon.
      const res = await releaseSync(conn, minutes(now, adapter.backfillIntervalMinutes))
      return { ...base, status: res.leaseLost ? 'lease_lost' : 'deferred', factsWritten: 0, message: 'время запуска истекло — продолжение в следующем запуске', alerted: false }
    }
    if (err instanceof BudgetExhausted) {
      const current = windowDays(conn.cursor) ?? adapter.maxDaysPerRun
      if (current <= 1) {
        return fail('permanent', `${providerLabel(conn.provider)}: данных за один день больше, чем позволяет лимит запросов за запуск`)
      }
      // Halve the window and try again soon; the history already written stays.
      const halved = Math.max(1, Math.floor(current / 2))
      const res = await finishSyncSuccess(conn, {
        facts: [],
        cursor: { ...conn.cursor, window_days: halved },
        nextSyncAt: minutes(now, adapter.backfillIntervalMinutes),
      })
      return { ...base, status: res.leaseLost ? 'lease_lost' : 'partial', factsWritten: 0, message: 'лимит запросов за запуск исчерпан — окно уменьшено', alerted: false }
    }
    if (err instanceof IntegrationError) return fail(err.kind, err.message, { retryAfterMs: err.retryAfterMs })
    console.error('[integrations] sync crashed', conn.provider, err instanceof Error ? sanitizeMessage(err.message, secrets) : 'error')
    return fail('transient', `${providerLabel(conn.provider)}: внутренняя ошибка синхронизации`)
  }
}

export interface BatchResult {
  outcomes: SyncOutcome[]
  /** Companies whose facts changed (their metrics need recalculation). */
  companiesWithNewFacts: string[]
  /** Set when nothing was claimed because this server has no key store (SECRETS_ENCRYPTION_KEY). */
  notConfigured?: 'not_configured'
}

let notConfiguredLogged = false

function logNotConfiguredOnce(): void {
  if (notConfiguredLogged) return
  notConfiguredLogged = true
  console.error('[integrations] SECRETS_ENCRYPTION_KEY is not configured — integration syncs are skipped, connections keep their status')
}

/** Due connections, at most `limit`, until `deadlineMs` (epoch ms). */
export async function runDueSyncs(opts: { limit: number; deadlineMs: number }, deps: SyncDeps = {}): Promise<BatchResult> {
  // Without a key store no credential can be opened: claim nothing rather than
  // turning every connection into needs_reauth.
  if (!credentialsStorageReady()) {
    logNotConfiguredOnce()
    return { outcomes: [], companiesWithNewFacts: [], notConfigured: 'not_configured' }
  }
  let claimed: ClaimedConnection[]
  try {
    claimed = await claimDueConnections(opts.limit, LEASE_SECONDS)
  } catch (err) {
    // Before migration 105 there is nothing to sync — not an agent failure every 15 minutes.
    if (isIntegrationsTableMissing(err)) return { outcomes: [], companiesWithNewFacts: [] }
    throw err
  }
  const outcomes: SyncOutcome[] = []
  for (const conn of claimed) {
    if (Date.now() > opts.deadlineMs) break
    outcomes.push(await syncClaimed(conn, { ...deps, deadlineAt: deps.deadlineAt ?? opts.deadlineMs }))
  }
  // Connections left unprocessed keep their lease until it expires (≤ LEASE_SECONDS) — harmless.
  const companies = [...new Set(outcomes.filter((o) => o.status === 'synced' && o.factsWritten > 0).map((o) => o.companyId))]
  return { outcomes, companiesWithNewFacts: companies }
}

/** One connection now (manual «Синхронизировать» in GIGA / tests). */
export async function syncConnectionNow(connectionId: string, deps: SyncDeps = {}): Promise<SyncOutcome | null> {
  const conn = await claimConnection(connectionId, LEASE_SECONDS)
  return conn ? syncClaimed(conn, deps) : null
}
