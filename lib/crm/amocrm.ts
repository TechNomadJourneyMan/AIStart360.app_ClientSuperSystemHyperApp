import type { CrmDeal, CrmContact } from './types'
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
 * Paging (H3): a list returns at most 250 records per page (`limit` above 250 is refused); pages are
 * numbered from 1 and `_links.next` is present while more remain. An empty list is HTTP 204 with no
 * body. listContacts / listDeals follow the pages until the end, the record cap of the run or its
 * time budget, and say which one stopped them. amoCRM does not report a total.
 */

interface AmoCrmConfig {
  domain: string       // e.g. "mycompany.amocrm.ru"
  accessToken: string  // long-lived token (or a legacy OAuth access token)
  /** DNS resolver for the SSRF guard (tests inject one; default: system DNS). */
  resolve?: Resolver
}

/** The largest page amoCRM API v4 accepts. */
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
  if (status === 429) return 'amoCRM ограничила частоту запросов — следующая синхронизация загрузит остальное'
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
 * Pages 1, 2, … of `path` (which has no `page` / `limit`). Records are de-duplicated by id; never
 * more than `maxRecords` are returned. A failure of the FIRST page is thrown; a failure of a later
 * page ends the listing with what was read.
 */
async function pageList<T extends { id: string }>(
  config: AmoCrmConfig,
  path: string,
  key: string,
  map: (row: Record<string, unknown>) => T | null,
  opts: ListOptions,
): Promise<ProviderList<T>> {
  const base = await baseUrl(config)
  const now = opts.now ?? Date.now
  const max = Math.max(1, Math.floor(opts.maxRecords))
  const limit = Math.min(AMO_PAGE_SIZE, max)
  const items: T[] = []
  const seen = new Set<string>()
  for (let page = 1; ; page++) {
    if (opts.fetchUntil !== undefined && now() >= opts.fetchUntil) {
      return { items, total: null, complete: false, stoppedBy: 'time' }
    }
    let data: Record<string, unknown> | null
    try {
      data = await callApi(base, config.accessToken, `${path}${path.includes('?') ? '&' : '?'}limit=${limit}&page=${page}`, requestTimeoutMs(opts))
    } catch (e) {
      if (page === 1) throw e
      return { items, total: null, complete: false, stoppedBy: 'error', error: (e as Error).message }
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
    if (items.length > max || (items.length === max && hasNext && rows.length > 0)) {
      return { items: items.slice(0, max), total: null, complete: false, stoppedBy: 'cap' }
    }
    if (!data || !hasNext || !Array.isArray(rows) || rows.length === 0) return { items, total: null, complete: true, stoppedBy: null }
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

/** The account's currency (ISO code, e.g. KZT or RUB), or null when amoCRM does not say. Throws on a bad token. */
export async function fetchAccountCurrency(config: AmoCrmConfig, opts: Pick<ListOptions, 'abortAt' | 'now'> = {}): Promise<string | null> {
  const data = await callApi(await baseUrl(config), config.accessToken, 'account', requestTimeoutMs(opts))
  const currency = text(data?.currency).toUpperCase()
  return currency || null
}

/** Contacts, newest first (id descending), up to `opts.maxRecords`. */
export async function listContacts(config: AmoCrmConfig, opts: ListOptions): Promise<ProviderList<ProviderContact>> {
  return pageList(config, 'contacts?order[id]=desc', 'contacts', mapAmoContact, opts)
}

/** Leads with their contacts, newest first (id descending), up to `opts.maxRecords`. */
export async function listDeals(config: AmoCrmConfig, opts: ListOptions & { currency: string | null }): Promise<ProviderList<ProviderDeal>> {
  return pageList(config, 'leads?with=contacts&order[id]=desc', 'leads', (row) => mapAmoLead(row, opts.currency), opts)
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

/** Recent leads for the Pulse screens (app/api/pulse/*), up to `limit` (paged by 250). */
export async function fetchDeals(config: AmoCrmConfig, limit = 50): Promise<CrmDeal[]> {
  const list = await pageList<CrmDeal>(config, 'leads?order[updated_at]=desc&with=contacts', 'leads', (d) => ({
    id: String(d.id),
    title: String(d.name || 'Без названия'),
    amount: Number(d.price) || 0,
    currency: 'KZT',
    stage: String(d.status_id || 'new'),
    createdAt: new Date(Number(d.created_at) * 1000).toISOString(),
    updatedAt: new Date(Number(d.updated_at) * 1000).toISOString(),
    contactName: (d._embedded as Record<string, unknown[]>)?.contacts?.[0]
      ? String((d._embedded as Record<string, Record<string, unknown>[]>).contacts[0].name || '')
      : undefined,
  }), { maxRecords: limit })
  return list.items
}

export async function fetchContacts(config: AmoCrmConfig, limit = 50): Promise<CrmContact[]> {
  const list = await pageList<CrmContact>(config, 'contacts?order[id]=desc', 'contacts', (c) => ({
    id: String(c.id),
    name: String(c.name || 'Без имени'),
    email: fieldValues(c, 'EMAIL')[0],
    phone: fieldValues(c, 'PHONE')[0],
    company: '',
    createdAt: new Date(Number(c.created_at) * 1000).toISOString(),
  }), { maxRecords: limit })
  return list.items
}
