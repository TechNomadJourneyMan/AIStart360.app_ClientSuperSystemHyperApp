import type { CrmDeal, CrmContact, CrmSyncResult } from './types'

/**
 * AmoCRM API v4 client
 * Docs: https://www.amocrm.ru/developers/content/crm_platform/api-reference
 *
 * Auth: Long-lived API token (Settings → Integrations → API keys)
 * or OAuth 2.0 access token
 */

interface AmoCrmConfig {
  domain: string       // e.g. "mycompany.amocrm.ru"
  accessToken: string  // API key or OAuth access token
}

async function callApi(config: AmoCrmConfig, path: string, params?: Record<string, unknown>) {
  const url = `https://${config.domain}/api/v4/${path}`
  const res = await fetch(url, {
    method: params ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: params ? JSON.stringify(params) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AmoCRM API error (${res.status}): ${text}`)
  }

  return res.json()
}

export async function testConnection(config: AmoCrmConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await callApi(config, 'account')
    if (data.id) {
      return { ok: true }
    }
    return { ok: false, error: 'Не удалось получить данные аккаунта' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function fetchDeals(config: AmoCrmConfig, limit = 50): Promise<CrmDeal[]> {
  const data = await callApi(config, `leads?limit=${limit}&order[updated_at]=desc&with=contacts`)

  const deals: CrmDeal[] = (data._embedded?.leads || []).map((d: Record<string, unknown>) => ({
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
  }))

  return deals
}

export async function fetchContacts(config: AmoCrmConfig, limit = 50): Promise<CrmContact[]> {
  const data = await callApi(config, `contacts?limit=${limit}&order[created_at]=desc`)

  const contacts: CrmContact[] = (data._embedded?.contacts || []).map((c: Record<string, unknown>) => {
    const fields = (c.custom_fields_values as Array<{ field_code: string; values: Array<{ value: string }> }>) || []
    const emailField = fields.find(f => f.field_code === 'EMAIL')
    const phoneField = fields.find(f => f.field_code === 'PHONE')

    return {
      id: String(c.id),
      name: String(c.name || 'Без имени'),
      email: emailField?.values?.[0]?.value,
      phone: phoneField?.values?.[0]?.value,
      company: String((c.company as Record<string, unknown>)?.name || ''),
      createdAt: new Date(Number(c.created_at) * 1000).toISOString(),
    }
  })

  return contacts
}

export async function syncAll(config: AmoCrmConfig): Promise<CrmSyncResult> {
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
