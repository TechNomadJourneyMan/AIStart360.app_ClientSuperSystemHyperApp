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

export async function decideApproval(args: {
  approvalId: string
  decision: ApprovalDecision
  actorId: string
  via: 'admin' | 'telegram'
  reason?: string | null
}): Promise<DecideResult> {
  const status = args.decision === 'approve' ? 'approved' : 'rejected'
  const rows = await prisma.$queryRaw<Array<{ task_id: string; agent_key: string; summary: string }>>`
    UPDATE public.agent_approvals
    SET status = ${status}, decided_by = ${args.actorId}, decided_via = ${args.via},
        decision_reason = ${args.reason?.slice(0, 500) ?? null}, decided_at = now()
    WHERE id = ${args.approvalId}::uuid AND status = 'pending' AND expires_at > now()
    RETURNING task_id, agent_key, summary`
  const row = rows[0]
  if (!row) {
    const exists = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM public.agent_approvals WHERE id = ${args.approvalId}::uuid`
    return { ok: false, reason: exists[0] ? 'not_pending' : 'not_found' }
  }

  if (status === 'approved') {
    await prisma.$executeRaw`
      UPDATE public.agent_tasks
      SET status = 'queued', run_after = now(), trigger = 'approval',
          max_attempts = greatest(max_attempts, attempts + 1)
      WHERE id = ${row.task_id}::uuid AND status = 'awaiting_approval'`
    kickTask(row.task_id)
  } else {
    await prisma.$executeRaw`
      UPDATE public.agent_tasks
      SET status = 'cancelled', finished_at = now(), last_error_code = 'APPROVAL_REJECTED',
          cancelled_by = ${args.actorId}
      WHERE id = ${row.task_id}::uuid AND status = 'awaiting_approval'`
  }
  return { ok: true, status, taskId: row.task_id, agentKey: row.agent_key, summary: row.summary }
}
