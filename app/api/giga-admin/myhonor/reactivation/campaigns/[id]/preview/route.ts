export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  listMyHonorReactivationRecipientPreviews,
  MyHonorReactivationAudienceTooLargeError,
  previewMyHonorReactivationCampaign,
} from '@/lib/integrations/myhonor/reactivation/repository'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const actor = await getGigaActor(req)
  if (!actor) {
    return json({ ok: false, error: { code: 'forbidden', message: 'Forbidden' } }, 403)
  }
  if (!UUID.test(params.id)) {
    return json({
      ok: false,
      error: { code: 'invalid_campaign_id', message: 'Invalid campaign id' },
    }, 400)
  }

  try {
    const result = await previewMyHonorReactivationCampaign({
      campaignId: params.id,
      actorId: actor.id,
    })
    const recipientPreview = await listMyHonorReactivationRecipientPreviews({
      campaignId: params.id,
      expectedSnapshotHash: result.approvalSnapshotHash,
      limit: 50,
    })
    await logAudit({
      entityType: 'system',
      entityId: `myhonor-reactivation:${params.id}`,
      action: 'myhonor.reactivation_campaign_previewed',
      performedBy: actor.id,
      diff: {
        after: {
          state: result.campaign.state,
          inserted_count: result.materialized.insertedCount,
          preview_count: result.materialized.previewCount,
          holdout_count: result.materialized.holdoutCount,
          excluded_count: result.materialized.excludedCount,
          approval_snapshot_hash: result.approvalSnapshotHash,
          template_contract_hash: result.templateContractHash,
        },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return json({
      ok: true,
      ...result,
      recipientPreview: {
        items: recipientPreview,
        shown: recipientPreview.length,
        total: result.materialized.insertedCount,
        nextOffset: recipientPreview.length < result.materialized.insertedCount
          ? recipientPreview.length
          : null,
      },
    })
  } catch (error) {
    if (error instanceof MyHonorReactivationAudienceTooLargeError) {
      return json({
        ok: false,
        error: {
          code: 'campaign_audience_too_large',
          message: 'Audience exceeds the safe preview limit; split the campaign',
          details: { total: error.total, safe_limit: error.loaded },
        },
      }, 409)
    }
    if (
      error instanceof Error
      && error.message === 'only draft campaigns can be previewed'
    ) {
      return json({
        ok: false,
        error: {
          code: 'campaign_state_conflict',
          message: 'Only a draft campaign can be previewed',
        },
      }, 409)
    }
    if (
      error instanceof Error
      && error.message === 'MyHonor reactivation campaign was not found'
    ) {
      return json({
        ok: false,
        error: { code: 'campaign_not_found', message: 'Campaign was not found' },
      }, 404)
    }
    return json({
      ok: false,
      error: {
        code: 'campaign_preview_failed',
        message: 'Campaign preview could not be generated',
      },
    }, 503)
  }
}
