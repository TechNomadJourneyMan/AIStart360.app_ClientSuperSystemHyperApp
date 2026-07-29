export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  crawlMyHonorPublicCatalog,
  MYHONOR_ROUTE_DEFAULT_LIMIT,
  MYHONOR_ROUTE_MAX_LIMIT,
  type MyHonorCatalogSnapshot,
} from '@/lib/integrations/ecommerce/myhonor-public'
import {
  beginMyHonorCatalogSweep,
  failMyHonorCatalogSweep,
  getMyHonorCatalogSweep,
  persistMyHonorCatalogProducts,
  recordMyHonorCatalogSweepPage,
  type CatalogSweepProgress,
} from '@/lib/integrations/myhonor/catalog-repository'
import { getMyHonorAnalyticsConfiguration } from '@/lib/integrations/myhonor/order-analytics'
import { isRateLimitedKey } from '@/lib/rate-limit'

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
} as const

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
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
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null
}

function safeSnapshot(snapshot: MyHonorCatalogSnapshot) {
  const { manifestProductIds: _privateManifest, ...safe } = snapshot
  return safe
}

function snapshotFailureCode(
  snapshot: MyHonorCatalogSnapshot,
): string | null {
  if (snapshot.sitemapTruncated) return 'sitemap_truncated'
  if (snapshot.status === 'failed') return 'catalog_snapshot_failed'
  if (snapshot.status === 'partial') return 'catalog_snapshot_partial'
  const expectedAttempted = Math.min(
    snapshot.requestedLimit,
    Math.max(0, snapshot.discoveredProductCount - snapshot.offset),
  )
  if (
    snapshot.discoveredProductCount !== snapshot.manifestProductIds.length
    || snapshot.attemptedProductCount !== expectedAttempted
    || snapshot.succeededProductCount !== snapshot.attemptedProductCount
    || snapshot.products.length !== snapshot.attemptedProductCount
  ) {
    return 'catalog_snapshot_incomplete'
  }
  return null
}

function persistence(
  sweep: CatalogSweepProgress,
  stored?: { upsertedCount: number; latestSyncedAt: string | null },
) {
  return {
    status: sweep.status,
    sweepId: sweep.sweepId,
    sweepStatus: sweep.status,
    generation: sweep.generation,
    manifestHash: sweep.manifestHash,
    expectedProductCount: sweep.expectedProductCount,
    seenProductCount: sweep.seenProductCount,
    nextOffset: sweep.status === 'in_progress' ? sweep.nextOffset : null,
    catalogComplete: sweep.status === 'completed',
    activeProductCount:
      sweep.status === 'completed' ? sweep.activeProductCount : null,
    tombstonedProductCount:
      sweep.status === 'completed' ? sweep.tombstonedProductCount : null,
    failureCode: sweep.failureCode,
    upsertedProductCount: stored?.upsertedCount ?? 0,
    latestSyncedAt: stored?.latestSyncedAt ?? null,
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return json({
      ok: false,
      error: { code: 'unauthorized', message: 'Authentication is required' },
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
  if (await isRateLimitedKey(user.id, 'myhonor:catalog-import', {
    max: 30,
    windowMs: 30 * 60_000,
  })) {
    return json({
      ok: false,
      error: {
        code: 'rate_limited',
        message: 'Catalog import limit reached; retry later',
      },
    }, 429)
  }

  if (
    request.nextUrl.searchParams.has('offset')
    || request.nextUrl.searchParams.has('sweep_started_at')
  ) {
    return json({
      ok: false,
      error: {
        code: 'server_owned_cursor',
        message: 'Catalog sweep pagination is controlled by the server',
      },
    }, 400)
  }

  const requestedLimit = boundedInteger(
    request.nextUrl.searchParams.get('limit'),
    MYHONOR_ROUTE_DEFAULT_LIMIT,
    1,
    MYHONOR_ROUTE_MAX_LIMIT,
  )
  const requestedSweepId = request.nextUrl.searchParams.get('sweep_id')
  if (
    requestedLimit === null
    || (requestedSweepId !== null && !UUID_PATTERN.test(requestedSweepId))
  ) {
    return json({
      ok: false,
      error: {
        code: 'invalid_catalog_sweep',
        message:
          `limit must be 1-${MYHONOR_ROUTE_MAX_LIMIT} and sweep_id must be a UUID`,
      },
    }, 400)
  }

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (
    companyError
    || !company?.id
    || String(company.id) !== configuration.companyId
  ) {
    return json({
      ok: false,
      error: {
        code: 'company_binding_mismatch',
        message: 'The configured MyHonor company binding is invalid',
      },
    }, 409)
  }

  const binding = {
    userId: user.id,
    companyId: String(company.id),
  }
  let sweep: CatalogSweepProgress | null = null

  try {
    sweep = await getMyHonorCatalogSweep({
      binding,
      sweepId: requestedSweepId,
    })
    if (requestedSweepId && !sweep) {
      return json({
        ok: false,
        error: {
          code: 'catalog_sweep_not_found',
          message: 'This catalog sweep does not exist for the current account',
        },
      }, 404)
    }
    if (sweep && sweep.status !== 'in_progress') {
      const complete = sweep.status === 'completed'
      return json({
        ok: complete,
        data: { persistence: persistence(sweep) },
        ...(complete ? {} : {
          error: {
            code: 'catalog_sweep_not_active',
            message: 'This catalog sweep is no longer active',
            retryable: false,
          },
        }),
      }, complete ? 200 : 409)
    }

    const pageSize = sweep?.pageSize ?? requestedLimit
    const offset = sweep?.nextOffset ?? 0
    const snapshot = await crawlMyHonorPublicCatalog({
      limit: pageSize,
      offset,
    })

    if (!sweep) {
      sweep = await beginMyHonorCatalogSweep({
        binding,
        manifestHash: snapshot.manifestHash,
        manifestProductIds: snapshot.manifestProductIds,
        pageSize,
      })
    }

    let failureCode = snapshotFailureCode(snapshot)
    if (
      failureCode === null
      && (
        snapshot.manifestHash !== sweep.manifestHash
        || snapshot.discoveredProductCount !== sweep.expectedProductCount
      )
    ) {
      failureCode = 'manifest_changed'
    }

    if (failureCode !== null) {
      sweep = await failMyHonorCatalogSweep({
        binding,
        sweepId: sweep.sweepId,
        failureCode,
      })
      return json({
        ok: false,
        data: {
          ...safeSnapshot(snapshot),
          persistence: persistence(sweep),
        },
        error: {
          code: 'catalog_sync_failed',
          message:
            'The complete MyHonor catalog could not be verified; nothing was finalized',
          retryable: snapshot.issues.some((issue) => issue.retryable),
        },
      }, 502)
    }

    const stored = await persistMyHonorCatalogProducts({
      binding,
      products: snapshot.products,
      sweepStartedAt: sweep.startedAt,
    })
    if (stored.upsertedCount !== snapshot.products.length) {
      throw new Error('catalog page persistence count mismatch')
    }

    const recorded = await recordMyHonorCatalogSweepPage({
      binding,
      sweepId: sweep.sweepId,
      manifestHash: snapshot.manifestHash,
      offset: sweep.nextOffset,
      productExternalIds: snapshot.products.map(
        (product) => product.externalId,
      ),
    })
    sweep = recorded

    if (
      !recorded.accepted
      && recorded.reason !== 'offset_mismatch'
      && recorded.status !== 'completed'
    ) {
      return json({
        ok: false,
        data: {
          ...safeSnapshot(snapshot),
          persistence: persistence(recorded, stored),
        },
        error: {
          code: 'catalog_sweep_rejected',
          message: 'The catalog page did not match the active server sweep',
          retryable: false,
        },
      }, 409)
    }

    return json({
      ok: true,
      data: {
        ...safeSnapshot(snapshot),
        persistence: persistence(recorded, stored),
      },
    })
  } catch {
    if (sweep?.status === 'in_progress') {
      try {
        sweep = await failMyHonorCatalogSweep({
          binding,
          sweepId: sweep.sweepId,
          failureCode: 'catalog_store_unavailable',
        })
      } catch {
        // The response stays conservative when durable failure recording is
        // itself unavailable; it never claims the sweep completed.
      }
    }
    return json({
      ok: false,
      data: sweep ? { persistence: persistence(sweep) } : undefined,
      error: {
        code: 'catalog_store_unavailable',
        message: 'Verified products could not be persisted',
        retryable: true,
      },
    }, 503)
  }
}
