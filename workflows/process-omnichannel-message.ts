import { getWorkflowMetadata, sleep } from 'workflow'
import { processOmnichannelMessageDirect } from '@/lib/functions/process-omnichannel-message'
import { isHistoricalCatchUpMessage } from '@/lib/omnichannel/delayed-reply-policy'
import type { OmnichannelMessageReceivedEventData } from '@/lib/omnichannel/events'
import { getMessageContext } from '@/lib/omnichannel/repository'

const MAX_REPLY_DELAY_SECONDS = 86_400

interface OmnichannelReplyDelayPlan {
  deadline: string | null
  delaySeconds: number
}

function parsedTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function boundedReplyDelaySeconds(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(
    MAX_REPLY_DELAY_SECONDS,
    Math.max(0, Math.trunc(value)),
  )
}

/**
 * Resolves the quiet-window deadline in a durable step. The database read and
 * Date.now() fallback are persisted in the workflow event log, so replaying a
 * run cannot move the deadline or extend the customer's wait.
 */
async function resolveOmnichannelReplyDelayStep(
  data: OmnichannelMessageReceivedEventData,
): Promise<OmnichannelReplyDelayPlan> {
  'use step'

  if (data.force_draft === true || data.delay_already_applied === true) {
    return { deadline: null, delaySeconds: 0 }
  }

  const context = await getMessageContext(data.message_id)
  if (!context || isHistoricalCatchUpMessage(context.message)) {
    return { deadline: null, delaySeconds: 0 }
  }

  const delaySeconds = boundedReplyDelaySeconds(
    context.settings.replyDelaySeconds,
  )
  if (delaySeconds === 0) {
    return { deadline: null, delaySeconds: 0 }
  }

  const ingestedAtMs = parsedTime(context.message.metadata.ingestedAt)
  const anchorMs = ingestedAtMs ?? Date.now()
  return {
    deadline: new Date(anchorMs + delaySeconds * 1_000).toISOString(),
    delaySeconds,
  }
}

/**
 * Durable Meta Cloud API processor. Workflow sleep records a timer instead of
 * holding a Vercel Function open. The direct processor then re-loads the
 * conversation and keeps the final supersession/send claims close to delivery.
 */
export async function processOmnichannelMessageWorkflow(
  data: OmnichannelMessageReceivedEventData,
): Promise<unknown> {
  'use workflow'

  const delay = await resolveOmnichannelReplyDelayStep(data)
  if (delay.deadline !== null) {
    const deadline = new Date(delay.deadline)
    if (deadline.getTime() > Date.now()) {
      await sleep(deadline)
    }
  }

  return processOmnichannelMessageStep({
    ...data,
    delay_already_applied: true,
  })
}

async function processOmnichannelMessageStep(
  data: OmnichannelMessageReceivedEventData,
): Promise<unknown> {
  'use step'

  const { workflowRunId } = getWorkflowMetadata()
  return processOmnichannelMessageDirect({
    ...data,
    processing_owner: `workflow:${workflowRunId}`,
  })
}

// Retrying is safe: the processor's database claims prevent duplicate sends
// and explicitly escalate an interrupted/ambiguous provider delivery.
resolveOmnichannelReplyDelayStep.maxRetries = 3
processOmnichannelMessageStep.maxRetries = 3
