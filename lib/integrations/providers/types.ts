/**
 * Contract of a live integration adapter (lib/integrations/providers/*).
 *
 * An adapter is pure transport + mapping: it receives decrypted credentials,
 * the connection's non-secret settings and cursor, an injected fetch and a
 * request budget, and returns facts plus the next cursor. It never touches the
 * database, never logs credentials and throws IntegrationError (classified)
 * or BudgetExhausted (stop and keep the cursor).
 */
import type { FactInput } from '../facts'
import type { RequestBudget } from '../http'
import type { ProviderKey } from '../registry'

export interface AdapterContext {
  fetch: typeof fetch
  now: Date
  budget: RequestBudget
  /** Secret values to mask in any error text. */
  secrets: readonly string[]
}

export interface TestResult {
  /** Human label of the connected account («Kaspi Магазин», «GA4 · ресурс 123»). */
  accountLabel: string | null
}

export interface SyncResult {
  facts: FactInput[]
  cursor: Record<string, unknown>
  /** History filled: only refreshes remain (the sync engine schedules the next run later). */
  caughtUp: boolean
  /** Updated account label (e.g. the account currency was learned). */
  accountLabel?: string | null
}

export interface ProviderAdapter {
  key: ProviderKey
  /** Minimal documented read call that proves the credentials work. */
  test(secret: Record<string, string>, settings: Record<string, string>, ctx: AdapterContext): Promise<TestResult>
  sync(
    secret: Record<string, string>,
    settings: Record<string, string>,
    cursor: Record<string, unknown>,
    ctx: AdapterContext,
  ): Promise<SyncResult>
  /** Days one run fetches at most (the engine halves it via cursor.window_days when the budget runs out). */
  maxDaysPerRun: number
  /** Requests one run may spend (the provider's rate limit decides). */
  requestBudget: number
  /** Minutes until the next run while the history is being filled. */
  backfillIntervalMinutes: number
  /** Minutes between refresh runs once caught up. */
  refreshIntervalMinutes: number
}
