/**
 * lib/agents/approvals.ts — human decisions on actions an agent may not take alone.
 *
 * Approve → the task goes back to the queue; when the agent re-runs and asks
 * for exactly the same action (same payload hash), the runtime lets it through
 * once and marks the approval executed. Reject → the task is cancelled.
 * Callers (admin API, Telegram webhook) authorise the human and write the
 * audit log; this module only applies the decision atomically.
 */
import { prisma } from '@/lib/db'
import { kickTask } from './queue'

export type ApprovalDecision = 'approve' | 'reject'

export interface DecideResult {
  ok: boolean
  /** not_found: no such approval; not_pending: already decided or expired. */
  reason?: 'not_found' | 'not_pending'
  status?: 'approved' | 'rejected'
  taskId?: string
  agentKey?: string
  summary?: string
}

/**
 * Apply a human decision. Approval and task change in one transaction, with
 * the task row locked first (the runner's agent_finish_task and cancelTask
 * lock it too), so the outcome is never split:
 *   task awaiting_approval → approve re-queues it, reject cancels it;
 *   task still running     → the decision is recorded; the runner applies it
 *                            the moment it parks the task
 *                            (store.applyEarlyApprovalDecision);
 *   task finished / cancelled → nothing to decide: not_pending, no change.
 */
export async function decideApproval(args: {
  approvalId: string
  decision: ApprovalDecision
  actorId: string
  via: 'admin' | 'telegram'
  reason?: string | null
}): Promise<DecideResult> {
  const status = args.decision === 'approve' ? 'approved' : 'rejected'
  const ref = await prisma.$queryRaw<Array<{ task_id: string }>>`
    SELECT task_id FROM public.agent_approvals WHERE id = ${args.approvalId}::uuid`
  if (!ref[0]) return { ok: false, reason: 'not_found' }
  const taskId = ref[0].task_id

  const outcome = await prisma.$transaction(async (tx) => {
    const [task] = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM public.agent_tasks WHERE id = ${taskId}::uuid FOR UPDATE`
    if (!task || (task.status !== 'awaiting_approval' && task.status !== 'running')) return null
    const rows = await tx.$queryRaw<Array<{ agent_key: string; summary: string }>>`
      UPDATE public.agent_approvals
      SET status = ${status}, decided_by = ${args.actorId}, decided_via = ${args.via},
          decision_reason = ${args.reason?.slice(0, 500) ?? null}, decided_at = now()
      WHERE id = ${args.approvalId}::uuid AND status = 'pending' AND expires_at > now()
      RETURNING agent_key, summary`
    if (!rows[0]) return null
    let requeued = false
    if (task.status === 'awaiting_approval' && status === 'approved') {
      await tx.$executeRaw`
        UPDATE public.agent_tasks
        SET status = 'queued', run_after = now(), trigger = 'approval',
            max_attempts = least(10, greatest(max_attempts, attempts + 1))
        WHERE id = ${taskId}::uuid`
      requeued = true
    } else if (task.status === 'awaiting_approval') {
      await tx.$executeRaw`
        UPDATE public.agent_tasks
        SET status = 'cancelled', finished_at = now(), last_error_code = 'APPROVAL_REJECTED',
            cancelled_by = ${args.actorId}
        WHERE id = ${taskId}::uuid`
    }
    return { row: rows[0], requeued }
  })
  if (!outcome) return { ok: false, reason: 'not_pending' }
  if (outcome.requeued) kickTask(taskId)
  return { ok: true, status, taskId, agentKey: outcome.row.agent_key, summary: outcome.row.summary }
}
