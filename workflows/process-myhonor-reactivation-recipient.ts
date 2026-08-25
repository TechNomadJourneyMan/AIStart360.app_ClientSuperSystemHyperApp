import { getWorkflowMetadata, sleep } from 'workflow'
import {
  processMyHonorReactivationRecipientDirect,
  type ProcessMyHonorReactivationRecipientResult,
} from '@/lib/integrations/myhonor/reactivation/process-recipient'

export interface MyHonorReactivationRecipientWorkflowInput {
  recipient_id: string
  not_before: string
}

async function processMyHonorReactivationRecipientStep(
  input: MyHonorReactivationRecipientWorkflowInput,
): Promise<ProcessMyHonorReactivationRecipientResult> {
  'use step'

  const { workflowRunId } = getWorkflowMetadata()
  return processMyHonorReactivationRecipientDirect({
    recipientId: input.recipient_id,
    ownerToken: `workflow:${workflowRunId}`,
  })
}

// A step retry is safe because the repository owns the lease/authorize/finish
// fence. Once a provider call becomes ambiguous, the recipient is moved to
// delivery_unknown and is never issued to Meta again automatically.
processMyHonorReactivationRecipientStep.maxRetries = 1

export async function processMyHonorReactivationRecipientWorkflow(
  input: MyHonorReactivationRecipientWorkflowInput,
): Promise<ProcessMyHonorReactivationRecipientResult> {
  'use workflow'

  const notBefore = new Date(input.not_before)
  if (!Number.isFinite(notBefore.getTime())) {
    throw new Error('not_before must be a valid timestamp')
  }
  if (notBefore.getTime() > Date.now()) await sleep(notBefore)

  let result = await processMyHonorReactivationRecipientStep(input)
  for (let attempt = 1; attempt < 5 && result.action === 'retry'; attempt += 1) {
    const retryAt = new Date(result.runAt)
    if (retryAt.getTime() > Date.now()) await sleep(retryAt)
    result = await processMyHonorReactivationRecipientStep(input)
  }
  return result
}
