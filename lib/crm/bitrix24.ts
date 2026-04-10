import type { CrmDeal, CrmContact, CrmSyncResult } from './types'

/**
 * Bitrix24 REST API client
 * Docs: https://dev.1c-bitrix.ru/rest_help/
 *
 * Supports two auth modes:
 *   1. Incoming webhook URL (simpler, no OAuth)
 *   2. OAuth access token (full API)
 */

interface Bitrix24Config {
  domain: string       // e.g. "mycompany.bitrix24.kz"
  accessToken: string  // OAuth token or webhook secret path
  webhookUrl?: string  // e.g. "https://mycompany.bitrix24.kz/rest/1/abc123/"
}

/** Strip protocol and trailing slashes from domain input */
function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

function buildUrl(config: Bitrix24Config, method: string): string {
  if (config.webhookUrl) {
    // Webhook mode: https://domain/rest/USER_ID/SECRET/method.json
    return `${config.webhookUrl.replace(/\/$/, '')}/${method}.json`
  }
  // OAuth mode — normalize domain to prevent https://https:// double prefix
  const domain = normalizeDomain(config.domain)
  return `https://${domain}/rest/${method}.json?auth=${config.accessToken}`
}

async function callApi(config: Bitrix24Config, method: string, params?: Record<string, unknown>) {
  const url = buildUrl(config, method)

  // 15-second timeout to avoid hanging
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Bitrix24 API (${res.status}): ${text.slice(0, 200)}`)
    }

    return res.json()
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

export async function testConnection(config: Bitrix24Config): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await callApi(config, 'profile')
    if (data.result?.ID) {
      return { ok: true }
    }
    return { ok: false, error: 'Не удалось получить профиль пользователя' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function fetchDeals(config: Bitrix24Config, limit = 50): Promise<CrmDeal[]> {
  const data = await callApi(config, 'crm.deal.list', {
    select: ['ID', 'TITLE', 'OPPORTUNITY', 'CURRENCY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID',
             'DATE_CREATE', 'DATE_MODIFY', 'BEGINDATE', 'CLOSEDATE', 'CONTACT_ID',
             'COMPANY_TITLE', 'COMMENTS', 'ASSIGNED_BY_ID', 'CATEGORY_ID'],
    order: { DATE_MODIFY: 'DESC' },
    start: 0,
  })

  const deals: CrmDeal[] = (data.result || []).slice(0, limit).map((d: Record<string, string>) => ({
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
  }))

  return deals
}

export async function fetchContacts(config: Bitrix24Config, limit = 50): Promise<CrmContact[]> {
  const data = await callApi(config, 'crm.contact.list', {
    select: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PHONE', 'COMPANY_TITLE', 'DATE_CREATE'],
    order: { DATE_CREATE: 'DESC' },
    start: 0,
  })

  const contacts: CrmContact[] = (data.result || []).slice(0, limit).map((c: Record<string, unknown>) => ({
    id: String(c.ID),
    name: [c.NAME, c.LAST_NAME].filter(Boolean).join(' ') || 'Без имени',
    email: Array.isArray(c.EMAIL) ? c.EMAIL[0]?.VALUE : undefined,
    phone: Array.isArray(c.PHONE) ? c.PHONE[0]?.VALUE : undefined,
    company: String(c.COMPANY_TITLE || ''),
    createdAt: String(c.DATE_CREATE),
  }))

  return contacts
}

export async function syncAll(config: Bitrix24Config): Promise<CrmSyncResult> {
  const errors: string[] = []
  let deals = 0
  let contacts = 0

  try {
    const fetchedDeals = await fetchDeals(config, 200)
    deals = fetchedDeals.length
  } catch (e) {
    errors.push(`Сделки: ${(e as Error).message}`)
  }

  try {
    const fetchedContacts = await fetchContacts(config, 200)
    contacts = fetchedContacts.length
  } catch (e) {
    errors.push(`Контакты: ${(e as Error).message}`)
  }

  return {
    success: errors.length === 0,
    deals,
    contacts,
    errors,
    syncedAt: new Date().toISOString(),
  }
}
