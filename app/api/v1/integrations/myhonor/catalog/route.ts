export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  MYHONOR_CRAWL_CONCURRENCY,
  MYHONOR_FETCH_TIMEOUT_MS,
  MYHONOR_PUBLIC_ORIGIN,
  MYHONOR_ROBOTS_SCOPE,
  MYHONOR_ROUTE_DEFAULT_LIMIT,
  MYHONOR_ROUTE_MAX_LIMIT,
  MYHONOR_SITEMAP_MAX_BYTES,
  MYHONOR_SITEMAP_MAX_URLS,
  MYHONOR_SITEMAP_URL,
  MYHONOR_PRODUCT_MAX_BYTES,
} from '@/lib/integrations/ecommerce/myhonor-public'

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
} as const

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

export async function GET(): Promise<NextResponse> {
  const supabase = createServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return json({
      ok: false,
      error: {
        code: 'unauthorized',
        message: 'Authentication is required',
      },
    }, 401)
  }

  return json({
    ok: true,
    data: {
      integration: 'myhonor-public-catalog',
      status: 'ready',
      mode: 'live-bounded-snapshot',
      persistence: 'server-normalized',
      source: {
        origin: MYHONOR_PUBLIC_ORIGIN,
        sitemapUrl: MYHONOR_SITEMAP_URL,
        robotsAllowedPaths: MYHONOR_ROBOTS_SCOPE,
      },
      limits: {
        sitemapUrls: MYHONOR_SITEMAP_MAX_URLS,
        defaultProductsPerRequest: MYHONOR_ROUTE_DEFAULT_LIMIT,
        maxProductsPerRequest: MYHONOR_ROUTE_MAX_LIMIT,
        concurrency: MYHONOR_CRAWL_CONCURRENCY,
        timeoutMs: MYHONOR_FETCH_TIMEOUT_MS,
        sitemapBodyBytes: MYHONOR_SITEMAP_MAX_BYTES,
        productBodyBytes: MYHONOR_PRODUCT_MAX_BYTES,
      },
      syncEndpoint: '/api/v1/integrations/myhonor/catalog/sync',
      importEndpoint: '/api/v1/integrations/myhonor/catalog/import',
    },
  })
}
