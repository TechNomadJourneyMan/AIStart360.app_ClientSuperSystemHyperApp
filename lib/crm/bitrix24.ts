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
 * Paging (H2): a list method returns at most 50 records per call together with `total` and, while
 * more remain, `next` (the `start` of the following page). listContacts / listDeals follow `next`
 * until the end, the record cap of the run or its time budget, and say which one stopped them.
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
    return 'Bitrix24 ограничил частоту запросов — следующая синхронизация загрузит остальное'
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
 * Follows `next` from start 0. Records are de-duplicated by id (a record created while paging
 * shifts the offsets, so one can come twice); never more than `maxRecords` are returned. A failure
 * of the FIRST page is thrown; a failure of a later page ends the listing with what was read.
 */
async function pageList<T extends { id: string }>(
  endpoint: Endpoint,
  method: string,
  params: Record<string, unknown>,
  map: (row: Record<string, unknown>) => T | null,
  opts: ListOptions,
): Promise<ProviderList<T>> {
  const now = opts.now ?? Date.now
  const max = Math.max(1, Math.floor(opts.maxRecords))
  const items: T[] = []
  const seen = new Set<string>()
  let total: number | null = null
  let start = 0
  for (let page = 0; ; page++) {
    if (opts.fetchUntil !== undefined && now() >= opts.fetchUntil) {
      return { items, total, complete: false, stoppedBy: 'time' }
    }
    let data: Record<string, unknown>
    try {
      data = await callApi(endpoint(method), { ...params, start }, requestTimeoutMs(opts))
    } catch (e) {
      if (page === 0) throw e
      return { items, total, complete: false, stoppedBy: 'error', error: (e as Error).message }
    }
    const t = Number(data.total)
    if (data.total !== undefined && Number.isFinite(t) && t >= 0) total = t
    const rows = Array.isArray(data.result) ? (data.result as Record<string, unknown>[]) : []
    for (const row of rows) {
      const item = row && typeof row === 'object' ? map(row) : null
      if (item && !seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
      }
    }
    const next = typeof data.next === 'number' && data.next > start ? data.next : null
    if (items.length > max || (items.length === max && next !== null && rows.length > 0)) {
      return { items: items.slice(0, max), total, complete: false, stoppedBy: 'cap' }
    }
    if (next === null || rows.length === 0) return { items, total, complete: true, stoppedBy: null }
    start = next
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

/** Contacts, newest first (ID descending), up to `opts.maxRecords`. */
export async function listContacts(config: Bitrix24Config, opts: ListOptions): Promise<ProviderList<ProviderContact>> {
  const endpoint = await endpointFor(config)
  return pageList(endpoint, 'crm.contact.list', {
    select: ['ID', 'NAME', 'SECOND_NAME', 'LAST_NAME', 'PHONE', 'EMAIL'],
    order: { ID: 'DESC' },
  }, mapBitrixContact, opts)
}

/**
 * Deals, newest first (ID descending), up to `opts.maxRecords`. CONTACT_ID is the deal's main
 * contact; further contacts of a deal (crm.deal.contact.items.get) would cost one call per deal
 * and are not read.
 */
export async function listDeals(config: Bitrix24Config, opts: ListOptions): Promise<ProviderList<ProviderDeal>> {
  const endpoint = await endpointFor(config)
  return pageList(endpoint, 'crm.deal.list', {
    select: ['ID', 'CONTACT_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'STAGE_SEMANTIC_ID'],
    order: { ID: 'DESC' },
  }, mapBitrixDeal, opts)
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

/** Recent deals for the Pulse screens (app/api/pulse/*), paged up to `limit`. */
export async function fetchDeals(config: Bitrix24Config, limit = 50): Promise<CrmDeal[]> {
  const endpoint = await endpointFor(config)
  const list = await pageList<CrmDeal>(endpoint, 'crm.deal.list', {
    select: ['ID', 'TITLE', 'OPPORTUNITY', 'CURRENCY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID',
             'DATE_CREATE', 'DATE_MODIFY', 'BEGINDATE', 'CLOSEDATE', 'CONTACT_ID',
             'COMPANY_TITLE', 'COMMENTS', 'ASSIGNED_BY_ID', 'CATEGORY_ID'],
    order: { DATE_MODIFY: 'DESC' },
  }, (row) => {
    const d = row as Record<string, string>
    return {
      id: d.ID,
      title: d.TITLE || 'Без названия',
      amount: parseFloat(d.OPPORTUNITY) || 0,
      currency: d.CURRENCY_ID || 'KZT',
      stage: d.STAGE_ID || 'NEW',
      stageSemantic: d.STAGE_SEMANTIC_ID || '', // P=in progress, S=success, F=fail
      createdAt: d.DATE_CREATE,
      updatedAt: d.DATE_MODIFY,
      closeDate: d.CLOSEDATE || null,
      contactName: d.COMPANY_TITLE || undefined,
      comment: d.COMMENTS || undefined,
      assignedById: d.ASSIGNED_BY_ID || undefined,
      companyTitle: d.COMPANY_TITLE || undefined,
    }
  }, { maxRecords: limit })
  return list.items
}

export async function fetchContacts(config: Bitrix24Config, limit = 50): Promise<CrmContact[]> {
  const endpoint = await endpointFor(config)
  const list = await pageList<CrmContact>(endpoint, 'crm.contact.list', {
    select: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PHONE', 'DATE_CREATE'],
    order: { DATE_CREATE: 'DESC' },
  }, (c) => ({
    id: String(c.ID),
    name: [c.NAME, c.LAST_NAME].filter(Boolean).join(' ') || 'Без имени',
    email: multiValues(c.EMAIL)[0],
    phone: multiValues(c.PHONE)[0],
    company: '',
    createdAt: String(c.DATE_CREATE),
  }), { maxRecords: limit })
  return list.items
}
