export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  crawlMyHonorPublicCatalog,
  MYHONOR_ROUTE_DEFAULT_LIMIT,
  MYHONOR_ROUTE_MAX_LIMIT,
  MYHONOR_SITEMAP_MAX_URLS,
} from '@/lib/integrations/ecommerce/myhonor-public'
import { getMyHonorAnalyticsConfiguration } from '@/lib/integrations/myhonor/order-analytics'
import { isRateLimitedKey } from '@/lib/rate-limit'

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
} as const

function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...RESPONSE_HEADERS, ...headers },
  })
}

function boundedInteger(
  raw: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (raw === null) return fallback
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return null
  }
  return value
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
  const configuration = getMyHonorAnalyticsConfiguration()
  if (!configuration.ready || configuration.userId !== user.id) {
    return json({
      ok: false,
      error: {
        code: 'integration_not_bound',
        message: 'This account is not bound to the MyHonor integration',
      },
    }, 403)
  }
  if (await isRateLimitedKey(user.id, 'myhonor:catalog-preview', {
    max: 2,
    windowMs: 15 * 60_000,
  })) {
    return json({
      ok: false,
      error: {
        code: 'rate_limited',
        message: 'Catalog preview limit reached; retry later',
      },
    }, 429, { 'Retry-After': '900' })
  }

  const limit = boundedInteger(
    request.nextUrl.searchParams.get('limit'),
    MYHONOR_ROUTE_DEFAULT_LIMIT,
    1,
    MYHONOR_ROUTE_MAX_LIMIT,
  )
  const offset = boundedInteger(
    request.nextUrl.searchParams.get('offset'),
    0,
    0,
    MYHONOR_SITEMAP_MAX_URLS - 1,
  )
  if (limit === null || offset === null) {
    return json({
      ok: false,
      error: {
        code: 'invalid_pagination',
        message: `limit must be 1-${MYHONOR_ROUTE_MAX_LIMIT}; offset must be 0-${MYHONOR_SITEMAP_MAX_URLS - 1}`,
      },
    }, 400)
  }

  const snapshot = await crawlMyHonorPublicCatalog({ limit, offset })
  if (snapshot.status === 'failed') {
    return json({
      ok: false,
      data: snapshot,
      error: {
        code: 'catalog_sync_failed',
        message: 'No verified MyHonor products could be read',
        retryable: snapshot.issues.some((issue) => issue.retryable),
      },
    }, 502, snapshot.issues.some((issue) => issue.retryable)
      ? { 'Retry-After': '15' }
      : {})
  }

  return json({
    ok: true,
    data: snapshot,
  })
}
