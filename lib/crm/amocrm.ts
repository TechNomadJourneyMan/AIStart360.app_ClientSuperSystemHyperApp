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
 * Reading (H3, M2 of wave 2): a list returns at most 250 records per page (`limit` above 250 is
 * refused); an empty page is HTTP 204 with no body; amoCRM reports no total. The API cannot filter
 * by «id greater than», so listContacts / listDeals read in ascending id order page by page with a
 * FIXED page size of 250 and return the next page number: the next run continues there. A record
 * deleted meanwhile shifts the later ones back by one, so one record at a page boundary can be
 * missed for that pass (it is read on the next pass). The cap is rounded up to whole pages.
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

/**
 * Pages of `path` (ascending id, 250 per page) from page `opts.from` (default 1). Stops at the end,
 * at a page boundary once `maxRecords` were read, or when the time is up; the position is the next
 * page to read. A failure of the FIRST page is thrown; a later one ends the listing with what was read.
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
  const seen = new Set<string>()
  const first = Math.max(1, Number.parseInt(opts.from ?? '1', 10) || 1)
  for (let page = first; ; page++) {
    const stop = (stoppedBy: ProviderList<T>['stoppedBy'], error?: string): ProviderList<T> => ({
      items, total: null, complete: false, stoppedBy, position: String(page), ...(error ? { error } : {}),
    })
    if (opts.fetchUntil !== undefined && now() >= opts.fetchUntil) return stop('time')
    if (items.length >= max) return stop('cap')
    let data: Record<string, unknown> | null
    try {
      data = await callApi(base, config.accessToken, `${path}&limit=${AMO_PAGE_SIZE}&page=${page}`, requestTimeoutMs(opts))
    } catch (e) {
      if (page === first) throw e
      return stop('error', (e as Error).message)
    }
    const rows = ((data?._embedded as Record<string, unknown> | undefined)?.[key] ?? []) as Record<string, unknown>[]
    for (const row of Array.isArray(rows) ? rows : []) {
      const item = row && typeof row === 'object' ? map(row) : null
      if (item && !seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
      }
    }
    const hasNext = Boolean((data?._links as { next?: { href?: unknown } } | undefined)?.next?.href)
    if (!data || !hasNext || !Array.isArray(rows) || rows.length === 0) {
      return { items, total: null, complete: true, stoppedBy: null, position: null }
    }
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
