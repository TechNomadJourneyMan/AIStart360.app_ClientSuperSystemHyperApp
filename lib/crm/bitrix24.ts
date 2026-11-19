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
 * Bitrix24 REST API client
 * Docs: https://apidocs.bitrix24.ru/ (crm.contact.list, crm.deal.list)
 *
 * Supports two auth modes:
 *   1. Incoming webhook URL (what the portal asks for: «Разработчикам → Другое → Входящий вебхук»,
 *      right «CRM (crm)»);
 *   2. OAuth access token (legacy rows only).
 *
 * R-225: every listing goes through guardCrmEndpoint (lib/crm/endpoint-guard.ts) — allowlisted
 * Bitrix24 host, webhook only as https://<same host>/rest/<id>/<key>/, public addresses only —
 * so a user-typed domain/webhook can never point the server at internal services. Redirects are
 * not followed (a 3xx surfaces as an HTTP error) and the OAuth token is URL-encoded.
 *
 * Reading (H2, M2 of wave 2): a list method returns at most 50 records per call. listContacts /
 * listDeals read in ascending ID order with the filter `>ID: <last id read>` (no offsets, so a
 * record added or removed meanwhile never shifts the pages) and `start: 0`, whose `total` is the
 * number of records left from that point. They stop at the end, the record cap of the run or its
 * time budget, say which one, and return the last ID read: the next run continues from there.
 */

interface Bitrix24Config {
  domain: string       // e.g. "mycompany.bitrix24.kz"
  accessToken: string  // OAuth token or webhook secret path
  webhookUrl?: string  // e.g. "https://mycompany.bitrix24.kz/rest/1/abc123/"
  /** DNS resolver for the SSRF guard (tests inject one; default: system DNS). */
  resolve?: Resolver
}

/** Bitrix24 returns this many records per list call; it cannot be raised. */
export const BITRIX_PAGE_SIZE = 50

type Endpoint = (method: string) => string

/** The guarded URL builder for this portal, or an Error with a user-facing message. */
async function endpointFor(config: Bitrix24Config): Promise<Endpoint> {
  let domain = config.domain?.trim() ?? ''
  if (!domain && config.webhookUrl) {
    try { domain = new URL(config.webhookUrl).hostname } catch { /* guard rejects below */ }
  }
  // Webhook mode passes the webhook URL as the "token" the guard validates; OAuth mode passes none
  // (a token is never a URL there).
  const g = await guardCrmEndpoint('bitrix24', domain, config.webhookUrl ?? '', config.resolve)
  if (!g.ok) throw new Error(g.error)
  if (config.webhookUrl) {
    if (!g.webhookUrl) throw new Error('Неверный адрес вебхука Bitrix24')
    const base = g.webhookUrl
    // Webhook mode: https://domain/rest/USER_ID/SECRET/method.json
    return (method) => `${base}${method}.json`
  }
  const host = g.host
  return (method) => `https://${host}/rest/${method}.json?auth=${encodeURIComponent(config.accessToken)}`
}

/** A short user-facing message for a Bitrix24 error (HTTP status + its `error` code). */
function errorMessage(status: number, code: string | null): string {
  if (code === 'insufficient_scope') {
    return 'У вебхука Bitrix24 нет права «CRM (crm)»: откройте входящий вебхук в Bitrix24 и добавьте это право'
  }
  if (code === 'QUERY_LIMIT_EXCEEDED' || status === 503 || status === 429) {
    return 'Bitrix24 ограничил частоту запросов — следующая синхронизация продолжит с этого места'
  }
  if (status === 401 || status === 403 || code === 'expired_token' || code === 'invalid_token' || code === 'NO_AUTH_FOUND') {
    return 'CRM отклонила доступ: проверьте ключ или права интеграции'
  }
  return `CRM ответила ошибкой (HTTP ${status})`
}

async function callApi(url: string, params: Record<string, unknown> | undefined, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
      signal: controller.signal,
      // A redirect could lead to an address the guard never saw.
      redirect: 'manual',
    })

    if (!res.ok) {
      // The upstream body may echo internal details; log a short excerpt, show only the status.
      const text = await res.text().catch(() => '')
      let code: string | null = null
      try {
        const body = JSON.parse(text) as { error?: unknown }
        if (typeof body?.error === 'string') code = body.error
      } catch { /* not JSON */ }
      console.warn(`[crm] Bitrix24 HTTP ${res.status}: ${text.slice(0, 120)}`)
      throw new CrmApiError(errorMessage(res.status, code), res.status, code)
    }

    const data = (await res.json()) as Record<string, unknown>
    // Some errors come with HTTP 200 and an `error` field.
    if (data && typeof data.error === 'string') throw new CrmApiError(errorMessage(res.status, data.error), res.status, data.error)
    return data
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      throw new Error('Таймаут подключения — сервер Bitrix24 не отвечает')
    }
    if (err.message === 'fetch failed') {
      throw new Error('Не удалось подключиться к серверу Bitrix24. Проверьте домен и доступность.')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Ascending by ID after `opts.from`. Never more than `maxRecords` are returned and the position is
 * the ID of the last one returned, so nothing is skipped. A failure of the FIRST page is thrown; a
 * failure of a later page ends the listing with what was read (and the position after it).
 */
async function listAfter<T extends { id: string }>(
  endpoint: Endpoint,
  method: string,
  select: string[],
  map: (row: Record<string, unknown>) => T | null,
  opts: ListOptions,
): Promise<ProviderList<T>> {
  const now = opts.now ?? Date.now
  const max = Math.max(1, Math.floor(opts.maxRecords))
  const items: T[] = []
  const positions: string[] = []
  const seen = new Set<string>()
  let total: number | null = null
  let after: string | null = opts.from ?? null
  const stop = (stoppedBy: ProviderList<T>['stoppedBy'], error?: string): ProviderList<T> => ({
    items, positions, total, complete: false, stoppedBy, position: after, ...(error ? { error } : {}),
  })
  for (let page = 0; ; page++) {
    if (opts.fetchUntil !== undefined && now() >= opts.fetchUntil) return stop('time')
    let data: Record<string, unknown>
    try {
      data = await callApi(endpoint(method), {
        select,
        order: { ID: 'ASC' },
        filter: after ? { '>ID': after } : {},
        start: 0,
      }, requestTimeoutMs(opts))
    } catch (e) {
      if (page === 0) throw e
      return stop('error', (e as Error).message)
    }
    const t = Number(data.total)
    if (page === 0 && data.total !== undefined && Number.isFinite(t) && t >= 0) total = t
    const rows = Array.isArray(data.result) ? (data.result as Record<string, unknown>[]) : []
    let lastId: string | null = null
    for (const row of rows) {
      const item = row && typeof row === 'object' ? map(row) : null
      const id = row && typeof row === 'object' ? text(row.ID) : ''
      if (!id) continue
      if (items.length >= max) {
        // The cap: the rest of this page is read again by the next run.
        return stop('cap')
      }
      lastId = id
      after = id
      if (item && !seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
        positions.push(id)
      }
    }
    // `next` is present while more records follow this page.
    const more = typeof data.next === 'number' && rows.length > 0 && lastId !== null
    if (!more) return { items, positions, total, complete: true, stoppedBy: null, position: null }
    if (items.length >= max) return stop('cap')
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** PHONE / EMAIL multi-fields: [{ ID, VALUE_TYPE, VALUE, TYPE_ID }]. */
function multiValues(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => (x && typeof x === 'object' ? text((x as { VALUE?: unknown }).VALUE) : '')).filter(Boolean)
}

export function mapBitrixContact(c: Record<string, unknown>): ProviderContact | null {
  const id = text(c.ID)
  if (!id) return null
  const name = [c.NAME, c.SECOND_NAME, c.LAST_NAME].map(text).filter(Boolean).join(' ') || null
  return { id, name, phones: multiValues(c.PHONE), emails: multiValues(c.EMAIL) }
}

export function mapBitrixDeal(d: Record<string, unknown>): ProviderDeal | null {
  const id = text(d.ID)
  if (!id) return null
  const contact = text(d.CONTACT_ID)
  const amount = Number.parseFloat(text(d.OPPORTUNITY))
  const currency = text(d.CURRENCY_ID).toUpperCase()
  return {
    id,
    contactId: contact && contact !== '0' ? contact : null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: currency || null,
    lost: text(d.STAGE_SEMANTIC_ID) === 'F',
  }
}

/** Contacts in ascending ID order after `opts.from`, up to `opts.maxRecords`. */
export async function listContacts(config: Bitrix24Config, opts: ListOptions): Promise<ProviderList<ProviderContact>> {
  const endpoint = await endpointFor(config)
  return listAfter(endpoint, 'crm.contact.list', ['ID', 'NAME', 'SECOND_NAME', 'LAST_NAME', 'PHONE', 'EMAIL'], mapBitrixContact, opts)
}

/**
 * Deals in ascending ID order after `opts.from`, up to `opts.maxRecords`. CONTACT_ID is the deal's
 * main contact; further contacts of a deal (crm.deal.contact.items.get) would cost one call per deal
 * and are not read.
 */
export async function listDeals(config: Bitrix24Config, opts: ListOptions): Promise<ProviderList<ProviderDeal>> {
  const endpoint = await endpointFor(config)
  return listAfter(endpoint, 'crm.deal.list', ['ID', 'CONTACT_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'STAGE_SEMANTIC_ID'], mapBitrixDeal, opts)
}

export async function testConnection(config: Bitrix24Config): Promise<{ ok: boolean; error?: string }> {
  try {
    const endpoint = await endpointFor(config)
    const data = await callApi(endpoint('profile'), undefined)
    if ((data.result as { ID?: unknown } | undefined)?.ID) {
      return { ok: true }
    }
    return { ok: false, error: 'Не удалось получить профиль пользователя' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
