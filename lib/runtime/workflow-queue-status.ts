/**
 * lib/runtime/workflow-queue-status.ts — where the Workflow queue of a persistent server stands.
 *
 * lib/runtime/server-start.ts writes it while it starts the queue in the background (with retries);
 * /api/health reads it. They are compiled into separate module graphs (instrumentation.ts and the
 * route), so the value lives on globalThis under a Symbol.for key, like the set in lib/background.ts.
 * Nothing heavy is imported here: the health route must not pull pg or the Workflow world in.
 */

export type WorkflowQueueState = 'off' | 'starting' | 'running' | 'retrying'

export interface WorkflowQueueStatus {
  /** off: not started here; starting: first attempt; retrying: an attempt failed, more follow; running: started. */
  state: WorkflowQueueState
  /** Start attempts made so far, the one in flight included. */
  attempts: number
  /** The last failure, credentials masked. For logs and staff only: may name internal hosts. */
  lastError?: string
}

const STATUS_KEY = Symbol.for('aistart360.workflow.queue.status')

type Store = Record<symbol, WorkflowQueueStatus | undefined>

export function getWorkflowQueueStatus(): WorkflowQueueStatus {
  const status = (globalThis as Store)[STATUS_KEY]
  return status ? { ...status } : { state: 'off', attempts: 0 }
}

export function setWorkflowQueueStatus(status: WorkflowQueueStatus): void {
  ;(globalThis as Store)[STATUS_KEY] = { ...status }
}
