export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  getMyHonorReactivationCampaignDefinition,
  transitionMyHonorReactivationCampaign,
} from '@/lib/integrations/myhonor/reactivation/repository'
import { getMyHonorReactivationConfiguration } from '@/lib/integrations/myhonor/reactivation/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const bodySchema = z.object({
  approval_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmation: z.literal('APPROVE_MYHONOR_CAMPAIGN'),
}).strict()

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
  if (!(req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))) {
    return json({
      ok: false,
      error: { code: 'unsupported_media_type', message: 'Content-Type must be application/json' },
    }, 415)
  }
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return json({
      ok: false,
      error: { code: 'payload_too_large', message: 'Request body is too large' },
    }, 413)
  }
  let parsed
  try {
    parsed = bodySchema.safeParse(await req.json())
  } catch {
    return json({
      ok: false,
      error: { code: 'invalid_json', message: 'Request body is not valid JSON' },
    }, 400)
  }
  if (!parsed.success) {
    return json({
      ok: false,
      error: {
        code: 'explicit_approval_required',
        message: 'Explicit approval and the exact preview snapshot are required',
      },
    }, 422)
  }

  try {
    const configuration = getMyHonorReactivationConfiguration()
    const definition = await getMyHonorReactivationCampaignDefinition({
      campaignId: params.id,
      configuration,
    })
    const templateContractHash = definition?.template_contract_hash
    if (
      typeof templateContractHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(templateContractHash)
    ) {
      return json({
        ok: false,
        error: {
          code: 'campaign_template_contract_missing',
          message: 'The reviewed template contract is missing; generate a new preview',
        },
      }, 409)
    }
    const result = await transitionMyHonorReactivationCampaign({
      campaignId: params.id,
      action: 'approve',
      actorId: actor.id,
      sendEnabled: false,
      approvalSnapshotHash: parsed.data.approval_snapshot_hash,
      templateContractHash,
    })
    if (!result.changed) {
      return json({
        ok: false,
        error: {
          code: result.reason || 'campaign_state_conflict',
          message: 'Campaign could not be approved in its current state',
        },
      }, 409)
    }
    await logAudit({
      entityType: 'system',
      entityId: `myhonor-reactivation:${params.id}`,
      action: 'myhonor.reactivation_campaign_approved',
      performedBy: actor.id,
      diff: {
        after: {
          state: result.state,
          approval_snapshot_hash: parsed.data.approval_snapshot_hash,
        },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return json({ ok: true, campaign: { id: params.id, state: result.state } })
  } catch {
    return json({
      ok: false,
      error: {
        code: 'campaign_approval_failed',
        message: 'Campaign could not be approved',
      },
    }, 503)
  }
}
