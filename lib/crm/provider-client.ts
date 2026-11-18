/**
 * lib/crm/provider-client.ts — серверный диспетчер к CRM-клиентам (Bitrix24/AmoCRM). Изолирует
 * ветвление по провайдеру и сборку config из хранимых base_url + access_token. Только сеть; что
 * писать в базу — lib/crm/provider-sync.ts, сама синхронизация — lib/crm/sync.ts.
 */

import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'
import { guardCrmEndpoint, type Resolver } from '@/lib/crm/endpoint-guard'
import type { CrmProvider } from '@/lib/crm/types'
import type { ListOptions, ProviderContact, ProviderDeal, ProviderList } from '@/lib/crm/sync-types'

/**
 * Bitrix24: проверенный webhook-URL → webhook-режим; иначе OAuth (domain+token).
 * Хост всегда берётся из guardCrmEndpoint (allowlist + только публичные адреса).
 */
function b24Config(host: string, token: string, webhookUrl: string | null, resolve?: Resolver) {
  return { domain: host, accessToken: token, webhookUrl: webhookUrl ?? undefined, resolve }
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
    ? bitrix24.testConnection(b24Config(g.host, token, g.webhookUrl, resolve))
    : amocrm.testConnection({ domain: g.host, accessToken: token, resolve })
}

/** crm_clients.external_source of a portal: '<provider>:<host>' (ids are unique only inside one portal). */
export function externalSourceOf(provider: CrmProvider, host: string): string {
  return `${provider}:${host.toLowerCase()}`
}

export interface ProviderSnapshot {
  externalSource: string
  contacts: ProviderList<ProviderContact>
  /** null when the deals could not be read at all (`dealsError` says why); the contacts still sync. */
  deals: ProviderList<ProviderDeal> | null
  dealsError: string | null
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Contacts and deals of the portal, read in parallel. Throws when the portal is refused by the
 * guard, the token does not work, or the first page of contacts fails.
 */
export async function fetchProviderSnapshot(
  provider: CrmProvider,
  baseUrl: string,
  token: string,
  opts: ListOptions & { resolve?: Resolver },
): Promise<ProviderSnapshot> {
  const g = await guardCrmEndpoint(provider, baseUrl, token, opts.resolve)
  if (!g.ok) throw new Error(g.error)
  const externalSource = externalSourceOf(provider, g.host)
  let contacts: PromiseSettledResult<ProviderList<ProviderContact>>
  let deals: PromiseSettledResult<ProviderList<ProviderDeal>>
  if (provider === 'bitrix24') {
    const cfg = b24Config(g.host, token, g.webhookUrl, opts.resolve)
    ;[contacts, deals] = await Promise.allSettled([bitrix24.listContacts(cfg, opts), bitrix24.listDeals(cfg, opts)])
  } else {
    const cfg = { domain: g.host, accessToken: token, resolve: opts.resolve }
    // Also proves the token: a refused token fails here, before any listing.
    const currency = await amocrm.fetchAccountCurrency(cfg, opts)
    ;[contacts, deals] = await Promise.allSettled([amocrm.listContacts(cfg, opts), amocrm.listDeals(cfg, { ...opts, currency })])
  }
  if (contacts.status === 'rejected') throw contacts.reason
  return {
    externalSource,
    contacts: contacts.value,
    deals: deals.status === 'fulfilled' ? deals.value : null,
    dealsError: deals.status === 'rejected' ? messageOf(deals.reason) : null,
  }
}
