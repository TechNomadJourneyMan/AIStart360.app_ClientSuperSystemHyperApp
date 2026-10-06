import { NextResponse, type NextRequest } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { drainQueue } from '@/lib/agents/queue'
import { enqueueScheduledAgents } from '@/lib/functions/agents'
import { redispatchPending } from '@/lib/events/platform'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/agents — agent queue maintenance for any scheduler
 * (the Inngest cron `agents-maintenance` does the same every minute).
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'CRON_SECRET не настроен' : 'Unauthorized' }, { status: auth.status })
  }
  try {
    const scheduled = await enqueueScheduledAgents(new Date())
    const redispatched = await redispatchPending()
    const drained = await drainQueue({ budgetMs: 240_000 })
    return NextResponse.json({
      ok: true,
      scheduled,
      redispatched,
      reaped: drained.reaped,
      approvalsExpired: drained.approvalsExpired,
      executed: drained.executed.map((r) => ({ taskId: r.taskId, status: r.finalStatus, errorCode: r.errorCode })),
    })
  } catch (err) {
    console.error('[cron/agents] failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Сбой обслуживания очереди агентов' }, { status: 500 })
  }
}
