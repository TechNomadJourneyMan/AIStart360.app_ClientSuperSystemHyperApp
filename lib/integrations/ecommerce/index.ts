// Adapter registry for e-commerce integrations.
// Each adapter is a stub today — real API wiring lands behind the
// EcommerceAdapter<Creds> interface in types.ts as we ship them.

import type { EcommerceAdapter } from './types'

const STUB_MSG = 'integration not configured yet — see lib/integrations/ecommerce/types.ts'

function stub(id: string, label: string): EcommerceAdapter<Record<string, string>> {
  return {
    id,
    label,
    async fetch() {
      throw new Error(`${id}: ${STUB_MSG}`)
    },
  }
}

export const ECOMMERCE_ADAPTERS: ReadonlyArray<EcommerceAdapter<Record<string, string>>> = [
  // ── Platforms (catalog + orders) ──────────────────────────────────────
  stub('shopify',     'Shopify Admin API'),
  stub('bitrix-shop', '1C-Bitrix e-shop module'),
  stub('insales',     'InSales API'),
  stub('tilda',       'Tilda Webhooks + Storage'),
  stub('opencart',    'OpenCart REST'),

  // ── Marketplaces ─────────────────────────────────────────────────────
  stub('wildberries', 'Wildberries Seller API'),
  stub('ozon',        'Ozon Performance API'),
  stub('kaspi',       'Kaspi Магазин API'),
  stub('uzum',        'Uzum Market Seller API'),
  stub('trendyol',    'Trendyol Seller API'),

  // ── Analytics ────────────────────────────────────────────────────────
  stub('ga4',           'Google Analytics 4 Data API'),
  stub('yandex-metrika', 'Yandex.Metrika Reports API'),
  stub('posthog',        'PostHog event stream'),

  // ── Advertising ──────────────────────────────────────────────────────
  stub('meta-ads',    'Meta Marketing API'),
  stub('yandex-direct', 'Yandex.Direct API'),
  stub('tiktok-ads',  'TikTok Marketing API'),
  stub('google-ads',  'Google Ads API'),

  // ── Communications / retention ───────────────────────────────────────
  stub('mindbox',     'Mindbox CDP'),
  stub('sendpulse',   'Sendpulse API'),
]

export type { EcommerceAdapter, EcommerceData, EcommercePartialData } from './types'
