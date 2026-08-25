export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { start } from 'workflow/api'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  getMyHonorReactivationCampaignDefinition,
  transitionMyHonorReactivationCampaign,
} from '@/lib/integrations/myhonor/reactivation/repository'
import { verifyMyHonorReactivationTemplate } from '@/lib/integrations/myhonor/reactivation/template-preflight'
import {
  getMyHonorReactivationConfiguration,
  MYHONOR_REACTIVATION_SEGMENTS,
  type MyHonorReactivationSegment,
} from '@/lib/integrations/myhonor/reactivation/types'
import { dispatchMyHonorReactivationCampaignWorkflow } from '@/workflows/dispatch-myhonor-reactivation-campaign'
import { processMyHonorReactivationRecipientWorkflow } from '@/workflows/process-myhonor-reactivation-recipient'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const bodySchema = z.object({
  approval_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmation: z.literal('LAUNCH_MYHONOR_CAMPAIGN'),
}).strict()

function json(body: unknown, status = 200, headers: HeadersInit = {}): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

function campaignSegment(value: unknown): MyHonorReactivationSegment | null {
  return typeof value === 'string'
    && (MYHONOR_REACTIVATION_SEGMENTS as readonly string[]).includes(value)
    ? value as MyHonorReactivationSegment
    : null
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
        code: 'explicit_launch_required',
        message: 'Explicit launch and the approved preview snapshot are required',
      },
    }, 422)
  }

  const configuration = getMyHonorReactivationConfiguration()
  let campaignDefinition: Record<string, unknown> | null
  try {
    campaignDefinition = await getMyHonorReactivationCampaignDefinition({
      campaignId: params.id,
      configuration,
    })
  } catch {
    return json({
      ok: false,
      error: {
        code: 'campaign_lookup_failed',
        message: 'Campaign readiness could not be verified',
      },
    }, 503, { 'Retry-After': '5' })
  }
  if (!campaignDefinition) {
    return json({
      ok: false,
      error: { code: 'campaign_not_found', message: 'Campaign was not found' },
    }, 404)
  }
  const campaignRecord = campaignDefinition
  const dryRun = campaignRecord.dry_run === true || campaignRecord.dryRun === true
  if (dryRun) {
    return json({
      ok: false,
      error: {
        code: 'dry_run_campaign_cannot_launch',
        message: 'Dry-run campaigns are materialized only through the preview endpoint',
      },
    }, 409)
  }
  if (!configuration.sendReady) {
    return json({
      ok: false,
      error: {
        code: 'live_send_not_ready',
        message: 'Live sending is disabled or incompletely configured',
        details: { missing: configuration.missingForSend },
      },
    }, 409)
  }
  const segment = campaignSegment(campaignRecord?.segment)
  const templateName = typeof campaignRecord.template_name === 'string'
    ? campaignRecord.template_name
    : null
  const templateLanguage = typeof campaignRecord.template_language === 'string'
    ? campaignRecord.template_language
    : null
  const templateContractHash = typeof campaignRecord.template_contract_hash === 'string'
    && /^[a-f0-9]{64}$/.test(campaignRecord.template_contract_hash)
    ? campaignRecord.template_contract_hash
    : null
  if (!segment || !templateName || !templateLanguage || !templateContractHash) {
    return json({
      ok: false,
      error: {
        code: 'campaign_template_unknown',
        message: 'The campaign template contract could not be resolved',
      },
    }, 409)
  }
  if (
    configuration.templates[segment] !== templateName
    || configuration.templateLanguage !== templateLanguage
  ) {
    return json({
      ok: false,
      error: {
        code: 'campaign_template_configuration_changed',
        message: 'Template configuration changed after preview; create a new campaign',
      },
    }, 409)
  }

  const templatePreflight = await verifyMyHonorReactivationTemplate({
    segment,
    templateName,
    languageCode: templateLanguage,
  })
  if (!templatePreflight.ok) {
    return json({
      ok: false,
      error: {
        code: `template_preflight_${templatePreflight.code}`,
        message: templatePreflight.message,
        retryable: templatePreflight.retryable,
        details: { provider_status: templatePreflight.status },
      },
    }, templatePreflight.retryable ? 503 : 409, templatePreflight.retryable
      ? { 'Retry-After': '30' }
      : {})
  }
  if (templatePreflight.contractHash !== templateContractHash) {
    return json({
      ok: false,
      error: {
        code: 'template_contract_changed_after_approval',
        message: 'The Meta template no longer matches the reviewed campaign snapshot',
      },
    }, 409)
  }
  let transition
  try {
    transition = await transitionMyHonorReactivationCampaign({
      campaignId: params.id,
      action: 'launch',
      actorId: actor.id,
      sendEnabled: configuration.sendReady,
      approvalSnapshotHash: parsed.data.approval_snapshot_hash,
      templateContractHash,
    })
  } catch {
    return json({
      ok: false,
      error: {
        code: 'campaign_launch_failed',
        message: 'Campaign could not be launched',
      },
    }, 503, { 'Retry-After': '5' })
  }

  const idempotentDispatchRetry = !transition.changed
    && transition.state === 'running'
    && transition.reason === 'already_in_state'
  if (!transition.changed && !idempotentDispatchRetry) {
    const dryRunReason = transition.reason.includes('dry_run')
    const configurationReason = transition.reason === 'global_send_disabled'
    return json({
      ok: false,
      error: {
        code: dryRunReason
          ? 'dry_run_campaign_cannot_launch'
          : transition.reason || 'campaign_state_conflict',
        message: dryRunReason
          ? 'Dry-run campaigns are materialized only through the preview endpoint'
          : configurationReason
          ? 'Live sending is disabled or incompletely configured; use dry-run'
          : 'Campaign could not be launched in its current state',
        ...(configurationReason
          ? { details: { missing: configuration.missingForSend } }
          : {}),
      },
    }, 409)
  }

  const recipientJobs = [...new Map(
    transition.recipientJobs.map((job) => [job.recipientId, job]),
  ).values()]

  let dispatcherRunId: string
  try {
    const dispatcher = await start(
      dispatchMyHonorReactivationCampaignWorkflow,
      [{
        campaign_id: params.id,
        already_dispatched_recipient_ids: recipientJobs.map((job) => job.recipientId),
      }],
    )
    dispatcherRunId = dispatcher.runId
  } catch {
    await logAudit({
      entityType: 'system',
      entityId: `myhonor-reactivation:${params.id}`,
      action: 'myhonor.reactivation_dispatcher_start_failed',
      performedBy: actor.id,
      diff: {
        after: {
          state: transition.state,
          idempotent_dispatch_retry: idempotentDispatchRetry,
        },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return json({
      ok: false,
      campaign: { id: params.id, state: transition.state },
      error: {
        code: 'campaign_dispatcher_unavailable',
        message: 'Campaign is persisted but its durable dispatcher could not be started',
        retryable: true,
      },
    }, 503, { 'Retry-After': '5' })
  }

  const starts = await Promise.allSettled(
    recipientJobs.map((job) => start(
      processMyHonorReactivationRecipientWorkflow,
      [{ recipient_id: job.recipientId, not_before: job.runAt }],
    )),
  )
  const scheduled = starts.filter((result) => result.status === 'fulfilled').length
  const dispatchFailed = starts.length - scheduled

  await logAudit({
    entityType: 'system',
    entityId: `myhonor-reactivation:${params.id}`,
    action: 'myhonor.reactivation_campaign_launched',
    performedBy: actor.id,
    diff: {
      after: {
        state: transition.state,
        approval_snapshot_hash: parsed.data.approval_snapshot_hash,
        recipient_count: recipientJobs.length,
        workflow_scheduled: scheduled,
        workflow_dispatch_failed: dispatchFailed,
        dispatcher_started: true,
        dispatcher_run_id: dispatcherRunId,
        idempotent_dispatch_retry: idempotentDispatchRetry,
        template_preflight: {
          name: templatePreflight.templateName,
          language: templatePreflight.languageCode,
          status: templatePreflight.status,
          category: templatePreflight.category,
          contract_hash: templatePreflight.contractHash,
        },
      },
      actorKind: actor.kind,
    },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return json({
    ok: true,
    campaign: { id: params.id, state: transition.state },
    dispatcher: { started: true, run_id: dispatcherRunId },
    dispatch: {
      requested: recipientJobs.length,
      scheduled,
      failed: dispatchFailed,
      recovery_by_dispatcher: dispatchFailed > 0,
      idempotent_retry: idempotentDispatchRetry,
    },
  }, 202)
}
