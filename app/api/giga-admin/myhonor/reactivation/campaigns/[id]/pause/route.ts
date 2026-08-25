export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { transitionMyHonorReactivationCampaign } from '@/lib/integrations/myhonor/reactivation/repository'

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
    const result = await transitionMyHonorReactivationCampaign({
      campaignId: params.id,
      action: 'pause',
      actorId: actor.id,
      sendEnabled: false,
    })
    if (!result.changed) {
      return json({
        ok: false,
        error: {
          code: result.reason || 'campaign_state_conflict',
          message: 'Campaign could not be paused in its current state',
        },
      }, 409)
    }
    await logAudit({
      entityType: 'system',
      entityId: `myhonor-reactivation:${params.id}`,
      action: 'myhonor.reactivation_campaign_paused',
      performedBy: actor.id,
      diff: {
        after: { state: result.state },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return json({ ok: true, campaign: { id: params.id, state: result.state } })
  } catch {
    return json({
      ok: false,
      error: {
        code: 'campaign_pause_failed',
        message: 'Campaign could not be paused',
      },
    }, 503)
  }
}
