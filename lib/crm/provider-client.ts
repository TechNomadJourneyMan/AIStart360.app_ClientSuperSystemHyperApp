/**
 * lib/crm/provider-client.ts — серверный диспетчер к готовым CRM-клиентам
 * (Bitrix24/AmoCRM). Изолирует ветвление по провайдеру и сборку config из
 * хранимых base_url + access_token. Только сеть; чистый маппинг — в provider-sync.
 */

import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'
import { guardCrmEndpoint, type Resolver } from '@/lib/crm/endpoint-guard'
import type { CrmProvider, CrmContact, CrmDeal } from '@/lib/crm/types'

/**
 * Bitrix24: проверенный webhook-URL → webhook-режим; иначе OAuth (domain+token).
 * Хост всегда берётся из guardCrmEndpoint (allowlist + только публичные адреса).
 */
function b24Config(host: string, token: string, webhookUrl: string | null) {
  return { domain: host, accessToken: token, webhookUrl: webhookUrl ?? undefined }
}

export async function testProvider(
  provider: CrmProvider,
  baseUrl: string,
  token: string,
  resolve?: Resolver,
): Promise<{ ok: boolean; error?: string }> {
  const g = await guardCrmEndpoint(provider, baseUrl, token, resolve)
  if (!g.ok) return { ok: false, error: g.error }
  return provider === 'bitrix24'
    ? bitrix24.testConnection(b24Config(g.host, token, g.webhookUrl))
    : amocrm.testConnection({ domain: g.host, accessToken: token })
}

export async function fetchProviderRecords(
  provider: CrmProvider,
  baseUrl: string,
  token: string,
  limit = 200,
  resolve?: Resolver,
): Promise<{ contacts: CrmContact[]; deals: CrmDeal[] }> {
  const g = await guardCrmEndpoint(provider, baseUrl, token, resolve)
  if (!g.ok) throw new Error(g.error)
  if (provider === 'bitrix24') {
    const cfg = b24Config(g.host, token, g.webhookUrl)
    const [contacts, deals] = await Promise.all([
      bitrix24.fetchContacts(cfg, limit),
      bitrix24.fetchDeals(cfg, limit),
    ])
    return { contacts, deals }
  }
  const cfg = { domain: g.host, accessToken: token }
  const [contacts, deals] = await Promise.all([
    amocrm.fetchContacts(cfg, limit),
    amocrm.fetchDeals(cfg, limit),
  ])
  return { contacts, deals }
}
