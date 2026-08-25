export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  createMyHonorReactivationCampaign,
  listMyHonorReactivationCampaigns,
} from '@/lib/integrations/myhonor/reactivation/repository'
import {
  getMyHonorReactivationConfiguration,
  myHonorCampaignDraftSchema,
} from '@/lib/integrations/myhonor/reactivation/types'

const MAX_BODY_BYTES = 16_384

function response(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function integerQuery(
  req: NextRequest,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  const raw = req.nextUrl.searchParams.get(name)
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await getGigaActor(req))) {
    return response({ ok: false, error: { code: 'forbidden', message: 'Forbidden' } }, 403)
  }
  const limit = integerQuery(req, 'limit', 50, 1, 100)
  const offset = integerQuery(req, 'offset', 0, 0, 100_000)
  if (limit === null || offset === null) {
    return response({
      ok: false,
      error: { code: 'invalid_pagination', message: 'Invalid limit or offset' },
    }, 400)
  }
  try {
    const items = await listMyHonorReactivationCampaigns({ limit, offset })
    return response({ ok: true, items, count: items.length, limit, offset })
  } catch {
    return response({
      ok: false,
      error: {
        code: 'reactivation_store_unavailable',
        message: 'Campaigns are temporarily unavailable',
      },
    }, 503)
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await getGigaActor(req)
  if (!actor) {
    return response({ ok: false, error: { code: 'forbidden', message: 'Forbidden' } }, 403)
  }
  const configuration = getMyHonorReactivationConfiguration()
  if (!configuration.ingestReady) {
    return response({
      ok: false,
      error: {
        code: 'reactivation_store_not_ready',
        message: 'Secure reactivation storage is not configured',
        details: { missing: configuration.missingForIngest },
      },
    }, 503)
  }
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    return response({
      ok: false,
      error: { code: 'unsupported_media_type', message: 'Content-Type must be application/json' },
    }, 415)
  }
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response({
      ok: false,
      error: { code: 'payload_too_large', message: 'Request body is too large' },
    }, 413)
  }

  let body: unknown
  try {
    const raw = await req.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return response({
        ok: false,
        error: { code: 'payload_too_large', message: 'Request body is too large' },
      }, 413)
    }
    body = JSON.parse(raw) as unknown
  } catch {
    return response({
      ok: false,
      error: { code: 'invalid_json', message: 'Request body is not valid JSON' },
    }, 400)
  }

  const parsed = myHonorCampaignDraftSchema.safeParse(body)
  if (!parsed.success) {
    return response({
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'Request body does not match the campaign contract',
        details: {
          fields: parsed.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    }, 422)
  }

  try {
    const campaign = await createMyHonorReactivationCampaign({
      draft: parsed.data,
      createdBy: actor.id,
    })
    await logAudit({
      entityType: 'system',
      entityId: `myhonor-reactivation:${campaign.id}`,
      action: 'myhonor.reactivation_campaign_created',
      performedBy: actor.id,
      diff: {
        after: {
          state: campaign.state,
          dry_run: campaign.dryRun,
          segment: parsed.data.segment,
        },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return response({ ok: true, campaign }, 201)
  } catch {
    return response({
      ok: false,
      error: {
        code: 'campaign_create_failed',
        message: 'Campaign could not be created',
      },
    }, 503)
  }
}
