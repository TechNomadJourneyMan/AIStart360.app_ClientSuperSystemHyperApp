/**
 * lib/crm/sync-types.ts — what the CRM sync reads from Bitrix24 / amoCRM (lib/crm/bitrix24.ts,
 * lib/crm/amocrm.ts) and how a listing tells that it stopped early.
 *
 * A client of the portal is a CRM CONTACT. A deal is never a client: its amount goes into the
 * average check of its contact (lib/crm/provider-sync.ts, crm_sync_apply_deal_totals).
 * Lists are read in ascending id order from a stored position, so a CRM larger than one run's cap
 * is caught up over several runs (lib/crm/sync-cursor.ts).
 */

export interface ProviderContact {
  /** Contact id inside its CRM portal. */
  id: string
  /** Display name; null when the CRM has none. */
  name: string | null
  /** Raw phone values in CRM order (not normalised). */
  phones: string[]
  emails: string[]
}

export interface ProviderDeal {
  id: string
  /** The deal's main contact; null when the deal has no contact (only a company, or nothing). */
  contactId: string | null
  /** Amount > 0; null when the CRM has no amount (Bitrix24 and amoCRM store «not filled» as 0). */
  amount: number | null
  /** ISO code (KZT, RUB, USD…); null when the CRM does not say. */
  currency: string | null
  /** Closed as lost (Bitrix24 STAGE_SEMANTIC_ID = F, amoCRM status 143). */
  lost: boolean
}

export type ListStop = 'cap' | 'time' | 'error'

export interface ProviderList<T> {
  items: T[]
  /**
   * How many records the CRM reports from the starting position on, those read included (Bitrix24
   * `total` of the filtered list); null when it does not say (amoCRM).
   */
  total: number | null
  /** The end of the list was reached. */
  complete: boolean
  /** Why reading stopped before the end: the record cap, the time budget or a failed later page. */
  stoppedBy: ListStop | null
  /** The error of the page that failed (stoppedBy = 'error'). */
  error?: string
  /**
   * Where the next run continues (Bitrix24: the last id read; amoCRM: `<next page>:<last id read>`,
   * lib/crm/amocrm.ts); null when the end was reached.
   */
  position: string | null
}

export interface ListOptions {
  /** At most this many records (the cap of one sync run). */
  maxRecords: number
  /** Continue after this position (ProviderList.position of the previous run); null = from the start. */
  from?: string | null
  /** No new page is requested at or after this moment (ms since epoch). */
  fetchUntil?: number
  /** A request still running at this moment is aborted (ms since epoch). */
  abortAt?: number
  now?: () => number
}

/** Per-request timeout: 15 s, never past `abortAt`, never below 1 s. */
export function requestTimeoutMs(opts: Pick<ListOptions, 'abortAt' | 'now'> | undefined): number {
  const max = 15_000
  if (!opts?.abortAt) return max
  const left = opts.abortAt - (opts.now ?? Date.now)()
  return Math.max(1_000, Math.min(max, left))
}

/** An error of the CRM's HTTP API, with the status and the CRM's own error code when it sent one. */
export class CrmApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: string | null = null) {
    super(message)
    this.name = 'CrmApiError'
  }
}
