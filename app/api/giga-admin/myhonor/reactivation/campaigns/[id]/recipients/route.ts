export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { listMyHonorReactivationRecipientPreviews } from '@/lib/integrations/myhonor/reactivation/repository'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function integerParameter(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!(await getGigaActor(req))) {
    return json({ ok: false, error: { code: 'forbidden', message: 'Forbidden' } }, 403)
  }
  if (!UUID.test(params.id)) {
    return json({
      ok: false,
      error: { code: 'invalid_campaign_id', message: 'Invalid campaign id' },
    }, 400)
  }

  const search = new URL(req.url).searchParams
  const snapshotHash = search.get('snapshot_hash')?.trim() ?? ''
  const limit = integerParameter(search.get('limit'), 50, 1, 100)
  const offset = integerParameter(search.get('offset'), 0, 0, 10_000)
  if (!HASH.test(snapshotHash) || limit === null || offset === null) {
    return json({
      ok: false,
      error: {
        code: 'invalid_preview_query',
        message: 'A valid snapshot_hash, limit and offset are required',
      },
    }, 400)
  }

  try {
    const items = await listMyHonorReactivationRecipientPreviews({
      campaignId: params.id,
      expectedSnapshotHash: snapshotHash,
      limit,
      offset,
    })
    return json({
      ok: true,
      snapshot_hash: snapshotHash,
      items,
      page: {
        offset,
        limit,
        next_offset: items.length === limit ? offset + items.length : null,
      },
    })
  } catch (error) {
    if (
      error instanceof Error
      && error.message === 'MyHonor recipient preview revision does not match'
    ) {
      return json({
        ok: false,
        error: {
          code: 'preview_revision_changed',
          message: 'The campaign preview changed; reload before approval',
        },
      }, 409)
    }
    return json({
      ok: false,
      error: {
        code: 'recipient_preview_unavailable',
        message: 'Recipient preview could not be loaded',
      },
    }, 503)
  }
}
