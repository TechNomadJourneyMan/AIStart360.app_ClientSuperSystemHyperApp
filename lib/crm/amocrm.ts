import { guardCrmEndpoint, type Resolver } from './endpoint-guard'
import {
  CrmApiError,
  requestTimeoutMs,
  type ListOptions,
  type ProviderContact,
  type ProviderDeal,
  type ProviderList,
} from './sync-types'

/**
 * amoCRM API v4 client
 * Docs: https://www.amocrm.ru/developers/content/crm_platform/api-reference
 *
 * Auth: a long-lived token (amoCRM → «amoМаркет» → «Создать интеграцию» → «Внешняя интеграция»
 * → вкладка «Ключи и доступы» → «Долгосрочный токен»), sent as `Authorization: Bearer`.
 *
 * Every call goes through guardCrmEndpoint (allowlisted <account>.amocrm.ru|.amocrm.com|.kommo.com,
 * public addresses only) and does not follow redirects (R-225, as Bitrix24).
 *
 * Reading (H3, M2 of waves 2 and 3): a list returns at most 250 records per page (`limit` above
 * 250 is refused); an empty page is HTTP 204 with no body; amoCRM reports no total. The API cannot
 * filter by «id greater than» (filter[id] matches exact ids only), so listContacts / listDeals read
 * in ascending id order page by page with a FIXED page size of 250. The position is
 * `<next page>:<last id read>`. Pages are offsets, so a record deleted below the stored place
 * shifts every later one back (and a restored one, forward): a run that resumes therefore reads ONE
 * PAGE EARLIER and continues with the first id after the last one read, but only once a page shows
 * an id already read — the proof that nothing between was skipped. A page without one (more than a
 * page was deleted meanwhile) makes it step back another page, down to page 1; the pages fetched on
 * the way are kept, not asked twice. Records already read are never returned again, so re-reads
 * cost requests, not records of the cap. A position in another form (the page-only form of wave 2)
 * starts again from page 1 — the pass re-reads, it never skips.
 * Remaining limit: a record deleted in the seconds BETWEEN two page requests of one run still
 * shifts that one boundary (no overlap there — amoCRM has no offset parameter to make one); that
 * record is read in the next pass. The cap is rounded up to whole pages.
 */

interface AmoCrmConfig {
  domain: string       // e.g. "mycompany.amocrm.ru"
  accessToken: string  // long-lived token (or a legacy OAuth access token)
  /** DNS resolver for the SSRF guard (tests inject one; default: system DNS). */
  resolve?: Resolver
}

/** The largest page amoCRM API v4 accepts, and the fixed page size of the page cursor. */
export const AMO_PAGE_SIZE = 250
/** amoCRM's system status «Закрыто и не реализовано» (lost). */
export const AMO_STATUS_LOST = 143

async function baseUrl(config: AmoCrmConfig): Promise<string> {
  const g = await guardCrmEndpoint('amocrm', config.domain ?? '', config.accessToken ?? '', config.resolve)
  if (!g.ok) throw new Error(g.error)
  return `https://${g.host}/api/v4/`
}

function errorMessage(status: number): string {
  if (status === 401 || status === 403) return 'CRM отклонила доступ: проверьте ключ или права интеграции'
  if (status === 402) return 'Аккаунт amoCRM не оплачен — API amoCRM недоступен'
  if (status === 429) return 'amoCRM ограничила частоту запросов — следующая синхронизация продолжит с этого места'
  return `CRM ответила ошибкой (HTTP ${status})`
}

/** GET `path`; null for 204 No Content (an empty list). */
async function callApi(base: string, token: string, path: string, timeoutMs = 15_000): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${base}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      // A redirect could lead to an address the guard never saw.
      redirect: 'manual',
    })

    if (res.status === 204) return null
    if (!res.ok) {
      // The upstream body may echo internal details; log a short excerpt, show only the status.
      const text = await res.text().catch(() => '')
      console.warn(`[crm] AmoCRM HTTP ${res.status}: ${text.slice(0, 120)}`)
      throw new CrmApiError(errorMessage(res.status), res.status)
    }

    const body = await res.text()
    return body ? (JSON.parse(body) as Record<string, unknown>) : null
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      throw new Error('Таймаут подключения — сервер AmoCRM не отвечает')
    }
    if (err.message === 'fetch failed') {
      throw new Error('Не удалось подключиться к серверу AmoCRM. Проверьте домен и доступность.')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

const POSITION = /^(\d+):(\d+)$/

/** `<next page>:<last id read>` → its parts; anything else → from the start. */
function readPosition(from: string | null | undefined): { page: number; after: number | null } {
  const m = POSITION.exec(from ?? '')
  const page = m ? Number(m[1]) : NaN
  const after = m ? Number(m[2]) : NaN
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(after)) return { page: 1, after: null }
  return { page, after }
}

const idOf = (row: unknown): number | null => {
  const id = row && typeof row === 'object' ? Number(text((row as { id?: unknown }).id)) : NaN
  return Number.isSafeInteger(id) ? id : null
}

/**
 * Records of `path` (ascending id, 250 per page) after the position `opts.from` (see the module
 * comment). Stops at the end, at a page boundary once `maxRecords` were read, or when the time is
 * up (no new request then); the position says where the next run continues. A failure of the FIRST
 * request is thrown; a later one ends the listing with what was read.
 */
async function listPages<T extends { id: string }>(
  config: AmoCrmConfig,
  path: string,
  key: string,
  map: (row: Record<string, unknown>) => T | null,
  opts: ListOptions,
): Promise<ProviderList<T>> {
  const base = await baseUrl(config)
  const now = opts.now ?? Date.now
  const max = Math.max(1, Math.floor(opts.maxRecords))
  const items: T[] = []
  const positions: string[] = []
  const start = readPosition(opts.from)
  /** The last id read in this pass: every record up to it was read (null: none yet). */
  let after = start.after
  let page = after === null ? 1 : Math.max(1, start.page - 1)
  /** The page being read starts at or before the first record after `after` (page 1 always does). */
  let proven = page === 1
  /** While not proven: the lowest page seen to start after `after` — the next run steps back from it. */
  let resumeAt = start.page
  const fetched = new Map<number, Record<string, unknown> | null>()
  let requests = 0
  const position = (): string | null => (after === null ? null : `${proven ? page : resumeAt}:${after}`)
  for (;;) {
    const stop = (stoppedBy: ProviderList<T>['stoppedBy'], error?: string): ProviderList<T> => ({
      items, positions, total: null, complete: false, stoppedBy, position: position(), ...(error ? { error } : {}),
    })
    if (items.length >= max) return stop('cap')
    let data: Record<string, unknown> | null
    if (fetched.has(page)) {
      data = fetched.get(page) ?? null
    } else {
      if (opts.fetchUntil !== undefined && now() >= opts.fetchUntil) return stop('time')
      try {
        data = await callApi(base, config.accessToken, `${path}&limit=${AMO_PAGE_SIZE}&page=${page}`, requestTimeoutMs(opts))
      } catch (e) {
        if (requests === 0) throw e
        return stop('error', (e as Error).message)
      }
      requests++
    }
    const embedded = (data?._embedded as Record<string, unknown> | undefined)?.[key]
    const rows = (Array.isArray(embedded) ? embedded : []) as Record<string, unknown>[]
    if (!proven) {
      if (page > 1 && !rows.some((r) => { const id = idOf(r); return id !== null && id <= (after as number) })) {
        fetched.set(page, data)
        resumeAt = page
        page--
        continue
      }
      proven = true
    }
    for (const row of rows) {
      const item = row && typeof row === 'object' ? map(row) : null
      const id = item ? idOf(item) : null
      if (!item || id === null || (after !== null && id <= after)) continue
      items.push(item)
      // Right after this record: the next run reads its page first (it holds the id: the proof).
      positions.push(`${page + 1}:${id}`)
      after = id
    }
    const hasNext = Boolean((data?._links as { next?: { href?: unknown } } | undefined)?.next?.href)
    if (!data || !hasNext || rows.length === 0) {
      return { items, positions, total: null, complete: true, stoppedBy: null, position: null }
    }
    page++
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** Values of the multitext field with `field_code` (PHONE / EMAIL) from custom_fields_values. */
function fieldValues(c: Record<string, unknown>, code: string): string[] {
  const fields = Array.isArray(c.custom_fields_values) ? (c.custom_fields_values as Array<Record<string, unknown>>) : []
  return fields
    .filter((f) => f && f.field_code === code)
    .flatMap((f) => (Array.isArray(f.values) ? (f.values as Array<{ value?: unknown }>) : []))
    .map((v) => text(v?.value))
    .filter(Boolean)
}

export function mapAmoContact(c: Record<string, unknown>): ProviderContact | null {
  const id = text(c.id)
  if (!id) return null
  const name = text(c.name) || [c.first_name, c.last_name].map(text).filter(Boolean).join(' ') || null
  return { id, name, phones: fieldValues(c, 'PHONE'), emails: fieldValues(c, 'EMAIL') }
}

/** A lead → deal: its main contact (is_main, else the first), price, the account's currency. */
export function mapAmoLead(d: Record<string, unknown>, currency: string | null): ProviderDeal | null {
  const id = text(d.id)
  if (!id) return null
  const contacts = ((d._embedded as { contacts?: unknown } | undefined)?.contacts ?? []) as Array<{ id?: unknown; is_main?: unknown }>
  const list = Array.isArray(contacts) ? contacts : []
  const main = list.find((c) => c?.is_main === true) ?? list[0]
  const contactId = main ? text(main.id) : ''
  const price = Number(d.price)
  return {
    id,
    contactId: contactId || null,
    amount: Number.isFinite(price) && price > 0 ? price : null,
    currency,
    lost: Number(d.status_id) === AMO_STATUS_LOST,
  }
}

export interface AmoAccount {
  /** The account id: stable when the account moves between amocrm.ru / amocrm.com / kommo.com. */
  id: string | null
  /** ISO code (KZT, RUB…), null when amoCRM does not say. */
  currency: string | null
}

/** GET /api/v4/account. Throws on a refused token. */
export async function fetchAccount(config: AmoCrmConfig, opts: Pick<ListOptions, 'abortAt' | 'now'> = {}): Promise<AmoAccount> {
  const data = await callApi(await baseUrl(config), config.accessToken, 'account', requestTimeoutMs(opts))
  return { id: text(data?.id) || null, currency: text(data?.currency).toUpperCase() || null }
}

/** Contacts in ascending id order from page `opts.from`, up to `opts.maxRecords` (whole pages). */
export async function listContacts(config: AmoCrmConfig, opts: ListOptions): Promise<ProviderList<ProviderContact>> {
  return listPages(config, 'contacts?order[id]=asc', 'contacts', mapAmoContact, opts)
}

/** Leads with their contacts in ascending id order from page `opts.from`, up to `opts.maxRecords`. */
export async function listDeals(config: AmoCrmConfig, opts: ListOptions & { currency: string | null }): Promise<ProviderList<ProviderDeal>> {
  return listPages(config, 'leads?with=contacts&order[id]=asc', 'leads', (row) => mapAmoLead(row, opts.currency), opts)
}

export async function testConnection(config: AmoCrmConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await callApi(await baseUrl(config), config.accessToken, 'account')
    if (data?.id) {
      return { ok: true }
    }
    return { ok: false, error: 'Не удалось получить данные аккаунта' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
