import { NextResponse, type NextRequest } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { drainQueue } from '@/lib/agents/queue'
import { enqueueScheduledAgents } from '@/lib/functions/agents'
import { redispatchPending } from '@/lib/events/platform'
import { pruneRateLimits } from '@/lib/rate-limit'
import { drainWhatsAppOutbox } from '@/lib/whatsapp/outbox'

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
    // WhatsApp notifications outbox (migration 104): retries and missed inline sends;
    // bounded (50 rows, 30 s) and before the long agent drain.
    const whatsapp = await drainWhatsAppOutbox({ limit: 50, budgetMs: 30_000 }).catch((err: unknown) => {
      console.error('[cron/agents] whatsapp drain failed', err instanceof Error ? err.message.split('\n')[0] : 'error')
      return null
    })
    const drained = await drainQueue({ budgetMs: 240_000 })
    const rateLimitsPruned = await pruneRateLimits() // expired rate_limit_hits rows (migration 100); never throws
    return NextResponse.json({
      ok: true,
      scheduled,
      redispatched,
      reaped: drained.reaped,
      approvalsExpired: drained.approvalsExpired,
      sessionsFailed: drained.sessionsFailed,
      rateLimitsPruned,
      whatsapp,
      executed: drained.executed.map((r) => ({ taskId: r.taskId, status: r.finalStatus, errorCode: r.errorCode })),
    })
  } catch (err) {
    console.error('[cron/agents] failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Сбой обслуживания очереди агентов' }, { status: 500 })
  }
}
