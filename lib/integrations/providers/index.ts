/**
 * Live adapters by provider key. A provider without an entry is 'file' in the
 * registry (exports only) — a test keeps the two in sync.
 */
import type { ProviderKey } from '../registry'
import { ga4Adapter } from './ga4'
import { kaspiAdapter } from './kaspi'
import { moyskladAdapter } from './moysklad'
import { shopifyAdapter } from './shopify'
import type { ProviderAdapter } from './types'
import { wildberriesAdapter } from './wildberries'
import { yandexMetrikaAdapter } from './yandex-metrika'

export const LIVE_ADAPTERS: Partial<Record<ProviderKey, ProviderAdapter>> = {
  moysklad: moyskladAdapter,
  kaspi: kaspiAdapter,
  wildberries: wildberriesAdapter,
  ga4: ga4Adapter,
  yandex_metrika: yandexMetrikaAdapter,
  shopify: shopifyAdapter,
}

export function adapterFor(key: ProviderKey): ProviderAdapter | null {
  return LIVE_ADAPTERS[key] ?? null
}

export type { ProviderAdapter, AdapterContext, SyncResult, TestResult } from './types'
