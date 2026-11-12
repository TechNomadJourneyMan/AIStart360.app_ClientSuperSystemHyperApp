import { NextResponse, type NextRequest } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { drainQueue } from '@/lib/agents/queue'
import { enqueueScheduledAgents, scheduledAgentsOn } from '@/lib/functions/agents'
import { redispatchPending } from '@/lib/events/platform'
import { drainPointARecalc } from '@/lib/point-a/recalc-queue'
import { pruneRateLimits } from '@/lib/rate-limit'
import { portalRole, runsAgentWork } from '@/lib/runtime/role'
import { drainWhatsAppOutbox } from '@/lib/whatsapp/outbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface Budgets {
  whatsappMs: number
  pointAMs: number
  queueMs: number
}

/** A call now and then from any scheduler (one process for everything): as it always was. */
const FALLBACK_BUDGETS: Budgets = { whatsappMs: 30_000, pointAMs: 60_000, queueMs: 180_000 }
/**
 * The per-minute loop of the agents service: the budgets of `agentsMaintenance`
 * (lib/functions/agents.ts), ~45 s in total, because a run every minute must END within the minute.
 */
const LOOP_BUDGETS: Budgets = { whatsappMs: 10_000, pointAMs: 15_000, queueMs: 20_000 }

/**
 * A drain that has not come back for this long is given up on (a query on a dead connection may
 * never return) and the next call takes over; otherwise one hung call would stop the upkeep until
 * the process restarts. Twice `maxDuration`: no healthy call lasts that long, and if one did, two
 * drains at once are still safe - Postgres claims every task atomically.
 */
const STALE_DRAIN_MS = 10 * 60_000

/** The call that is draining now, if any: one drain at a time in a process. */
let current: { since: number } | null = null

/**
 * GET /api/cron/agents — maintenance of the agent queue. Requires `Authorization: Bearer $CRON_SECRET`.
 *
 * What a call does depends on the role of the process (PORTAL_ROLE, lib/runtime/role.ts):
 *   - 'all' (the default): a fallback for any scheduler next to the Inngest cron `agents-maintenance`
 *     (lib/functions/agents.ts). Every call does the full upkeep with the long budgets.
 *   - 'agents': the service has no Inngest and its in-process cron calls this route every minute
 *     (lib/cron/schedule.ts), so here the route IS that maintenance loop and keeps its rules: the
 *     quiet mode (with «Агенты по расписанию (24/7)» off the upkeep runs every 15 minutes only, the
 *     database is left alone in between), the short budgets, and the clock read once at the start.
 *     tests/unit/agents/maintenance-parity.test.ts compares the two call for call.
 *   - 'web': agent work does not run in this process; the call is answered and nothing is drained.
 *
 * One drain at a time in a process (the Inngest function has `concurrency: { limit: 1 }`): a call
 * that arrives while another is draining answers `skipped: 'busy'` at once.
 */
export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'CRON_SECRET не настроен' : 'Unauthorized' }, { status: auth.status })
  }
  const role = portalRole()
  if (!runsAgentWork(role)) {
    return NextResponse.json({ ok: true, skipped: 'not_agents_role' })
  }
  if (current) {
    if (Date.now() - current.since < STALE_DRAIN_MS) {
      return NextResponse.json({ ok: true, skipped: 'busy' })
    }
    console.error(`[cron/agents] the previous drain has not come back in ${STALE_DRAIN_MS / 60_000} min, starting another one`)
  }
  const mine = { since: Date.now() }
  current = mine
  try {
    const loop = role === 'agents'
    const budgets = loop ? LOOP_BUDGETS : FALLBACK_BUDGETS
    // Read once, before anything is awaited: the minute scheduled agents are matched against.
    const now = new Date()
    const around = await scheduledAgentsOn()
    if (loop && !around && now.getUTCMinutes() % 15 !== 0) {
      return NextResponse.json({ ok: true, skipped: 'quiet_mode' })
    }
    const scheduled = around ? await enqueueScheduledAgents(now) : []
    const redispatched = await redispatchPending()
    // WhatsApp notifications outbox (migration 104): retries and missed inline sends;
    // bounded (50 rows) and before the agent drain.
    const whatsapp = await drainWhatsAppOutbox({ limit: 50, budgetMs: budgets.whatsappMs }).catch((err: unknown) => {
      console.error('[cron/agents] whatsapp drain failed', err instanceof Error ? err.message.split('\n')[0] : 'error')
      return null
    })
    // Point A recalculations that are due (lib/point-a/recalc-queue.ts): the
    // path without Inngest; bounded, never fails the cron.
    const pointA = await drainPointARecalc({ budgetMs: budgets.pointAMs }).catch((err: unknown) => {
      console.error('[cron/agents] point A drain failed', err instanceof Error ? err.message.split('\n')[0] : 'error')
      return null
    })
    const drained = await drainQueue({ budgetMs: budgets.queueMs })
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
      pointA: pointA ? { done: pointA.done.length, failed: pointA.failed.length } : null,
      executed: drained.executed.map((r) => ({ taskId: r.taskId, status: r.finalStatus, errorCode: r.errorCode })),
    })
  } catch (err) {
    console.error('[cron/agents] failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Сбой обслуживания очереди агентов' }, { status: 500 })
  } finally {
    // Only our own mark: a drain that was given up on must not free the route under its replacement.
    if (current === mine) current = null
  }
}
