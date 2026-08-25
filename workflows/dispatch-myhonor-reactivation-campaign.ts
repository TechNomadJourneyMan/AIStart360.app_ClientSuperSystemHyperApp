import { getWorkflowMetadata, sleep } from 'workflow'
import { start } from 'workflow/api'
import {
  getMyHonorReactivationOverview,
  listReadyMyHonorReactivationRecipientJobs,
  transitionMyHonorReactivationCampaign,
  type MyHonorReactivationRecipientJob,
} from '@/lib/integrations/myhonor/reactivation/repository'
import { processMyHonorReactivationRecipientWorkflow } from '@/workflows/process-myhonor-reactivation-recipient'

export const MYHONOR_DISPATCH_BATCH_SIZE = 100
export const MYHONOR_DISPATCH_MAX_BATCHES = 100
export const MYHONOR_DISPATCH_MAX_RECIPIENTS = 10_000
export const MYHONOR_DISPATCH_MAX_IDLE_POLLS = 20
export const MYHONOR_DISPATCH_POLL_INTERVAL_MS = 5_000
export const MYHONOR_DISPATCH_RECOVERY_POLL_THRESHOLD = 3
export const MYHONOR_DISPATCH_MAX_WORKFLOWS_PER_RECIPIENT = 2

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface MyHonorReactivationCampaignDispatcherInput {
  campaign_id: string
  already_dispatched_recipient_ids?: string[]
}

export interface MyHonorReactivationCampaignDispatcherResult {
  campaign_id: string
  state: 'completed' | 'paused' | 'not_running' | 'rescheduled' | 'truncated'
  reason:
    | 'completed'
    | 'already_completed'
    | 'campaign_paused'
    | 'campaign_not_running'
    | 'batch_limit'
    | 'recipient_limit'
    | 'active_wait_limit'
    | 'queued_wait_limit'
    | 'completion_transition_rejected'
  batches_read: number
  recipient_workflows_started: number
  duplicate_candidates_skipped: number
  idle_polls: number
  truncated: boolean
}

interface CampaignRuntimeSnapshot {
  state: string
  queued: number
  leased: number
  authorized: number
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid dispatcher ${field}`)
  }
  return value as Record<string, unknown>
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid dispatcher ${field}`)
  }
  return value
}

function campaignSnapshot(value: Record<string, unknown>): CampaignRuntimeSnapshot {
  const campaign = record(value.campaign, 'campaign overview')
  const states = record(value.recipient_states, 'recipient states')
  if (typeof campaign.state !== 'string' || !campaign.state) {
    throw new Error('invalid dispatcher campaign state')
  }
  return {
    state: campaign.state,
    queued: nonNegativeInteger(states.queued, 'queued count'),
    leased: nonNegativeInteger(states.leased, 'leased count'),
    authorized: nonNegativeInteger(states.authorized, 'authorized count'),
  }
}

function validateInput(input: MyHonorReactivationCampaignDispatcherInput): string[] {
  if (!UUID.test(input.campaign_id)) throw new Error('campaign_id must be a UUID')
  const ids = input.already_dispatched_recipient_ids ?? []
  if (ids.length > MYHONOR_DISPATCH_BATCH_SIZE || ids.some((id) => !UUID.test(id))) {
    throw new Error('already_dispatched_recipient_ids are invalid')
  }
  return [...new Set(ids)]
}

function validateJob(job: MyHonorReactivationRecipientJob): void {
  if (!UUID.test(job.recipientId)) throw new Error('dispatcher received invalid recipient id')
  if (!Number.isFinite(new Date(job.runAt).getTime())) {
    throw new Error('dispatcher received invalid run_at')
  }
}

async function listReadyRecipientsStep(
  campaignId: string,
): Promise<MyHonorReactivationRecipientJob[]> {
  'use step'

  return listReadyMyHonorReactivationRecipientJobs({
    campaignId,
    limit: MYHONOR_DISPATCH_BATCH_SIZE,
  })
}
listReadyRecipientsStep.maxRetries = 3

async function loadCampaignOverviewStep(
  campaignId: string,
): Promise<Record<string, unknown>> {
  'use step'

  return getMyHonorReactivationOverview({ campaignId })
}
loadCampaignOverviewStep.maxRetries = 3

async function startRecipientWorkflowStep(
  job: MyHonorReactivationRecipientJob,
): Promise<string> {
  'use step'

  const run = await start(processMyHonorReactivationRecipientWorkflow, [{
    recipient_id: job.recipientId,
    not_before: job.runAt,
  }])
  return run.runId
}
startRecipientWorkflowStep.maxRetries = 3

async function completeCampaignStep(campaignId: string) {
  'use step'

  const { workflowRunId } = getWorkflowMetadata()
  return transitionMyHonorReactivationCampaign({
    campaignId,
    action: 'complete',
    actorId: `workflow:${workflowRunId}`,
  })
}
completeCampaignStep.maxRetries = 3

async function rescheduleCampaignDispatcherStep(
  campaignId: string,
): Promise<string> {
  'use step'

  const run = await start(dispatchMyHonorReactivationCampaignWorkflow, [{
    campaign_id: campaignId,
    already_dispatched_recipient_ids: [],
  }])
  return run.runId
}
rescheduleCampaignDispatcherStep.maxRetries = 3

function result(
  input: MyHonorReactivationCampaignDispatcherInput,
  state: MyHonorReactivationCampaignDispatcherResult['state'],
  reason: MyHonorReactivationCampaignDispatcherResult['reason'],
  metrics: {
    batchesRead: number
    workflowsStarted: number
    duplicatesSkipped: number
    idlePolls: number
  },
): MyHonorReactivationCampaignDispatcherResult {
  return {
    campaign_id: input.campaign_id,
    state,
    reason,
    batches_read: metrics.batchesRead,
    recipient_workflows_started: metrics.workflowsStarted,
    duplicate_candidates_skipped: metrics.duplicatesSkipped,
    idle_polls: metrics.idlePolls,
    truncated: state === 'truncated',
  }
}

/**
 * Durable campaign fan-out. It never calls Meta itself: every recipient stays
 * behind the database claim/authorize/finish fence in its child workflow.
 */
export async function dispatchMyHonorReactivationCampaignWorkflow(
  input: MyHonorReactivationCampaignDispatcherInput,
): Promise<MyHonorReactivationCampaignDispatcherResult> {
  'use workflow'

  const alreadyDispatched = validateInput(input)
  // A successful Workflow start is durable, so suppress immediate duplicates.
  // If the same database-owned ready record survives several bounded polls,
  // allow one recovery child; claim/authorize still fences the actual send.
  const startsPerRecipient = new Map<string, number>(
    alreadyDispatched.map((id) => [id, 1]),
  )
  const consecutiveReadyPolls = new Map<string, number>()
  let batchesRead = 0
  let workflowsStarted = 0
  let duplicatesSkipped = 0
  let idlePolls = 0

  for (let batch = 0; batch < MYHONOR_DISPATCH_MAX_BATCHES; batch += 1) {
    const rawJobs = await listReadyRecipientsStep(input.campaign_id)
    batchesRead += 1
    rawJobs.forEach(validateJob)
    const jobs = [...new Map(rawJobs.map((job) => [job.recipientId, job])).values()]
    duplicatesSkipped += rawJobs.length - jobs.length
    const readyIds = new Set(jobs.map((job) => job.recipientId))
    for (const recipientId of consecutiveReadyPolls.keys()) {
      if (!readyIds.has(recipientId)) consecutiveReadyPolls.delete(recipientId)
    }
    let deferredUntil: number | null = null
    const eligible = jobs.filter((job) => {
      const starts = startsPerRecipient.get(job.recipientId) ?? 0
      const runAt = new Date(job.runAt).getTime()
      if (starts > 0 && runAt > Date.now()) {
        consecutiveReadyPolls.set(job.recipientId, 0)
        deferredUntil = deferredUntil === null ? runAt : Math.min(deferredUntil, runAt)
        duplicatesSkipped += 1
        return false
      }
      const readyPolls = (consecutiveReadyPolls.get(job.recipientId) ?? 0) + 1
      consecutiveReadyPolls.set(job.recipientId, readyPolls)
      const firstStart = starts === 0
      const recoveryStart = starts < MYHONOR_DISPATCH_MAX_WORKFLOWS_PER_RECIPIENT
        && readyPolls >= MYHONOR_DISPATCH_RECOVERY_POLL_THRESHOLD
      if (!firstStart && !recoveryStart) {
        duplicatesSkipped += 1
        return false
      }
      return true
    })

    if (eligible.length > 0) {
      const capacity = MYHONOR_DISPATCH_MAX_RECIPIENTS - workflowsStarted
      const selected = eligible.slice(0, Math.max(0, capacity))
      if (selected.length === 0) {
        await rescheduleCampaignDispatcherStep(input.campaign_id)
        return result(input, 'rescheduled', 'recipient_limit', {
          batchesRead,
          workflowsStarted,
          duplicatesSkipped,
          idlePolls,
        })
      }
      const firstRunAt = Math.min(...selected.map((job) => new Date(job.runAt).getTime()))
      if (firstRunAt > Date.now()) await sleep(new Date(firstRunAt))
      for (const job of selected) {
        await startRecipientWorkflowStep(job)
        startsPerRecipient.set(
          job.recipientId,
          (startsPerRecipient.get(job.recipientId) ?? 0) + 1,
        )
        consecutiveReadyPolls.set(job.recipientId, 0)
        workflowsStarted += 1
      }
      if (selected.length < eligible.length || workflowsStarted >= MYHONOR_DISPATCH_MAX_RECIPIENTS) {
        await rescheduleCampaignDispatcherStep(input.campaign_id)
        return result(input, 'rescheduled', 'recipient_limit', {
          batchesRead,
          workflowsStarted,
          duplicatesSkipped,
          idlePolls,
        })
      }
      idlePolls = 0
      await sleep(new Date(Date.now() + MYHONOR_DISPATCH_POLL_INTERVAL_MS))
      continue
    }

    const snapshot = campaignSnapshot(
      await loadCampaignOverviewStep(input.campaign_id),
    )
    if (snapshot.state === 'paused') {
      return result(input, 'paused', 'campaign_paused', {
        batchesRead,
        workflowsStarted,
        duplicatesSkipped,
        idlePolls,
      })
    }
    if (snapshot.state === 'completed') {
      return result(input, 'completed', 'already_completed', {
        batchesRead,
        workflowsStarted,
        duplicatesSkipped,
        idlePolls,
      })
    }
    if (snapshot.state !== 'running') {
      return result(input, 'not_running', 'campaign_not_running', {
        batchesRead,
        workflowsStarted,
        duplicatesSkipped,
        idlePolls,
      })
    }

    const active = snapshot.leased + snapshot.authorized
    if (snapshot.queued === 0 && active === 0) {
      const completion = await completeCampaignStep(input.campaign_id)
      if (completion.state === 'completed') {
        return result(input, 'completed', completion.changed ? 'completed' : 'already_completed', {
          batchesRead,
          workflowsStarted,
          duplicatesSkipped,
          idlePolls,
        })
      }
      return result(input, 'truncated', 'completion_transition_rejected', {
        batchesRead,
        workflowsStarted,
        duplicatesSkipped,
        idlePolls,
      })
    }

    if (deferredUntil !== null && deferredUntil > Date.now()) {
      await sleep(new Date(deferredUntil))
      continue
    }

    idlePolls += 1
    if (idlePolls >= MYHONOR_DISPATCH_MAX_IDLE_POLLS) {
      await rescheduleCampaignDispatcherStep(input.campaign_id)
      return result(
        input,
        'rescheduled',
        active > 0 ? 'active_wait_limit' : 'queued_wait_limit',
        { batchesRead, workflowsStarted, duplicatesSkipped, idlePolls },
      )
    }
    await sleep(new Date(Date.now() + MYHONOR_DISPATCH_POLL_INTERVAL_MS))
  }

  await rescheduleCampaignDispatcherStep(input.campaign_id)
  return result(input, 'rescheduled', 'batch_limit', {
    batchesRead,
    workflowsStarted,
    duplicatesSkipped,
    idlePolls,
  })
}
