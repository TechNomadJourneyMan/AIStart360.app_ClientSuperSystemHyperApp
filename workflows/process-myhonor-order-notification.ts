import { getWorkflowMetadata, sleep } from 'workflow'
import {
  processMyHonorOrderNotificationDirect,
  type ProcessMyHonorOrderNotificationResult,
} from '@/lib/integrations/myhonor/process-order-notification'

export interface MyHonorOrderNotificationWorkflowInput {
  notification_id: string
}

async function processMyHonorOrderNotificationStep(
  input: MyHonorOrderNotificationWorkflowInput,
): Promise<ProcessMyHonorOrderNotificationResult> {
  'use step'

  const { workflowRunId } = getWorkflowMetadata()
  return processMyHonorOrderNotificationDirect({
    notificationId: input.notification_id,
    ownerToken: `workflow:${workflowRunId}`,
  })
}

// One replay is safe: a replayed lease remains pre-provider, while a replayed
// authorized send is atomically changed to delivery_unknown instead of being
// issued to Meta twice.
processMyHonorOrderNotificationStep.maxRetries = 1

export async function processMyHonorOrderNotificationWorkflow(
  input: MyHonorOrderNotificationWorkflowInput,
): Promise<ProcessMyHonorOrderNotificationResult> {
  'use workflow'

  let result = await processMyHonorOrderNotificationStep(input)
  for (let attempt = 1; attempt < 5 && result.action === 'retry'; attempt += 1) {
    const retryAt = new Date(result.runAt)
    if (retryAt.getTime() > Date.now()) await sleep(retryAt)
    result = await processMyHonorOrderNotificationStep(input)
  }
  return result
}
