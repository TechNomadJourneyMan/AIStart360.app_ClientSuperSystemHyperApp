export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { authorizeMyHonorAccount } from '@/lib/integrations/myhonor/access'
import {
  crawlMyHonorPublicCatalog,
  MYHONOR_ROUTE_DEFAULT_LIMIT,
  MYHONOR_ROUTE_MAX_LIMIT,
  MYHONOR_SITEMAP_MAX_URLS,
} from '@/lib/integrations/ecommerce/myhonor-public'
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
  const access = await authorizeMyHonorAccount(supabase, request?.nextUrl.searchParams.get('company_id'))
  if (!access.ok) return json({ ok: false, error: access.error }, access.error.status)
  if (await isRateLimitedKey(`${access.userId}:${access.company.id}`, 'myhonor:catalog-preview', {
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
