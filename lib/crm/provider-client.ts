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

/**
 * The CRM account a connection reads — crm_clients.external_source of its clients (ids are unique
 * only inside one account):
 *   amoCRM:   'amocrm:<account id>' (GET /api/v4/account) — stable when the account's address
 *             changes (a renamed subdomain, amocrm.com → kommo.com);
 *   Bitrix24: 'bitrix24:<portal host>' — no portal id is read: `profile` describes the webhook's
 *             user, not the portal, and the portal's stable member_id is handed to OAuth
 *             applications, which the product owner ruled out. Limitation: a RENAMED portal reads as
 *             a new account — its contacts link again by phone to unlinked clients, and those whose
 *             phone is held by a client of the old address are counted as phone conflicts.
 * `legacySources` are earlier identities of the same account whose clients the sync moves over.
 */
export interface ProviderAccount {
  provider: CrmProvider
  externalSource: string
  legacySources: string[]
  host: string
  webhookUrl: string | null
  /** amoCRM: the account currency (deal amounts carry none). */
  currency: string | null
}

export async function identifyProvider(
  provider: CrmProvider,
  baseUrl: string,
  token: string,
  opts: Pick<ListOptions, 'abortAt' | 'now'> & { resolve?: Resolver } = {},
): Promise<ProviderAccount> {
  const g = await guardCrmEndpoint(provider, baseUrl, token, opts.resolve)
  if (!g.ok) throw new Error(g.error)
  const host = g.host.toLowerCase()
  if (provider === 'bitrix24') {
    return { provider, externalSource: `bitrix24:${host}`, legacySources: [], host, webhookUrl: g.webhookUrl, currency: null }
  }
  // Also proves the token: a refused token fails here, before any listing.
  const account = await amocrm.fetchAccount({ domain: host, accessToken: token, resolve: opts.resolve }, opts)
  // L1 (wave 3): never the host instead — an identity that flips between runs would link the same
  // contacts twice (clients without a phone would be added again).
  if (!account.id) throw new Error('amoCRM не сообщила номер аккаунта — синхронизация остановлена, чтобы не перепутать клиентов. Попробуйте позже.')
  return {
    provider,
    externalSource: `amocrm:${account.id}`,
    // Before wave 2 amoCRM clients were keyed by the host.
    legacySources: [`amocrm:${host}`],
    host,
    webhookUrl: null,
    currency: account.currency,
  }
}

export interface ProviderSnapshot {
  contacts: ProviderList<ProviderContact>
  /** null when the deals could not be read at all (`dealsError` says why); the contacts still sync. */
  deals: ProviderList<ProviderDeal> | null
  dealsError: string | null
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Contacts and deals, in parallel, each from its own stored position. Throws when the first page of
 * contacts fails.
 */
export async function fetchProviderSnapshot(
  account: ProviderAccount,
  token: string,
  opts: Omit<ListOptions, 'from'> & { resolve?: Resolver; contactsFrom: string | null; dealsFrom: string | null },
): Promise<ProviderSnapshot> {
  const { contactsFrom, dealsFrom, resolve, ...list } = opts
  let contacts: PromiseSettledResult<ProviderList<ProviderContact>>
  let deals: PromiseSettledResult<ProviderList<ProviderDeal>>
  if (account.provider === 'bitrix24') {
    const cfg = b24Config(account.host, token, account.webhookUrl, resolve)
    ;[contacts, deals] = await Promise.allSettled([
      bitrix24.listContacts(cfg, { ...list, from: contactsFrom }),
      bitrix24.listDeals(cfg, { ...list, from: dealsFrom }),
    ])
  } else {
    const cfg = { domain: account.host, accessToken: token, resolve }
    ;[contacts, deals] = await Promise.allSettled([
      amocrm.listContacts(cfg, { ...list, from: contactsFrom }),
      amocrm.listDeals(cfg, { ...list, from: dealsFrom, currency: account.currency }),
    ])
  }
  if (contacts.status === 'rejected') throw contacts.reason
  return {
    contacts: contacts.value,
    deals: deals.status === 'fulfilled' ? deals.value : null,
    dealsError: deals.status === 'rejected' ? messageOf(deals.reason) : null,
  }
}
