/**
 * lib/crm/provider-client.ts — серверный диспетчер к готовым CRM-клиентам
 * (Bitrix24/AmoCRM). Изолирует ветвление по провайдеру и сборку config из
 * хранимых base_url + access_token. Только сеть; чистый маппинг — в provider-sync.
 */

import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'
import type { CrmProvider, CrmContact, CrmDeal } from '@/lib/crm/types'

/** Bitrix24: полный webhook-URL как токен → webhook-режим; иначе OAuth (domain+token). */
function b24Config(baseUrl: string, token: string) {
  return {
    domain: baseUrl,
    accessToken: token,
    webhookUrl: /^https?:\/\//.test(token) ? token : undefined,
  }
}

export function testProvider(
  provider: CrmProvider,
  baseUrl: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  return provider === 'bitrix24'
    ? bitrix24.testConnection(b24Config(baseUrl, token))
    : amocrm.testConnection({ domain: baseUrl, accessToken: token })
}

export async function fetchProviderRecords(
  provider: CrmProvider,
  baseUrl: string,
  token: string,
  limit = 200,
): Promise<{ contacts: CrmContact[]; deals: CrmDeal[] }> {
  if (provider === 'bitrix24') {
    const cfg = b24Config(baseUrl, token)
    const [contacts, deals] = await Promise.all([
      bitrix24.fetchContacts(cfg, limit),
      bitrix24.fetchDeals(cfg, limit),
    ])
    return { contacts, deals }
  }
  const cfg = { domain: baseUrl, accessToken: token }
  const [contacts, deals] = await Promise.all([
    amocrm.fetchContacts(cfg, limit),
    amocrm.fetchDeals(cfg, limit),
  ])
  return { contacts, deals }
}
