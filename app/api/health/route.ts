import { NextResponse } from 'next/server'
import { checkReadiness, type ReadinessCheck } from '@/lib/health/platform'
import { isPersistentServer } from '@/lib/runtime/platform'
import { servesWeb } from '@/lib/runtime/role'
import { getWorkflowQueueStatus, type WorkflowQueueState } from '@/lib/runtime/workflow-queue-status'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — public liveness check.
 *
 * Only what is actually measured is reported: database round-trip and whether
 * the server configuration is complete. Uptime is not tracked here, so it is
 * reported as «не измеряется» rather than a made-up percentage, and names of
 * missing environment variables are not disclosed publicly (audit S20; staff
 * see them in GIGA → Настройки → Система, /api/giga-admin/system/health).
 * Responds 503 when a check fails, so uptime probes can rely on the status.
 *
 * On a persistent server (PERSISTENT_SERVER=1, Railway) the Workflow queue is a third entry: it
 * starts in the background and retries while its database is down (lib/runtime/server-start.ts).
 * A queue that has failed to start, or is not set up at all, fails the check; the error text stays
 * in the server log. On Vercel the output is unchanged.
 *
 * The agents service (PORTAL_ROLE=agents) is a persistent server that does not start the Workflow
 * queue on purpose, so it has no queue entry: its check passes when the database and the
 * configuration do.
 *
 * Readiness (R4-A1, lib/health/platform.ts checkReadiness): on a persistent server two more entries
 * when they apply — «Фоновые задачи (Inngest)» (the heartbeat of our Inngest) and «Задачи по
 * расписанию» (the in-process cron of this role is calling); a failed one fails the check (503),
 * one without evidence yet is «degraded» and does not. The configuration also counts the variables
 * that tie the services together (by number). The result is cached for 15 s and every check is
 * bounded, so the probe stays cheap; the agents service reads it every 3 minutes
 * (lib/ops/crosswatch.ts). Railway's deploy check is /api/healthz, which touches none of this.
 */
interface ServiceResult {
  name: string
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
  uptime: string
}

const NOT_MEASURED = 'не измеряется'

const QUEUE_STATUS: Record<WorkflowQueueState, ServiceResult['status']> = {
  running: 'online',
  starting: 'degraded',
  retrying: 'offline',
  off: 'offline',
}

const JOURNAL_STATUS: Record<Exclude<ReadinessCheck, 'off'>, ServiceResult['status']> = {
  ok: 'online',
  unknown: 'degraded',
  fail: 'offline',
}

export async function GET() {
  const health = await checkReadiness()
  // A slow answer (≥ 400 ms, a queue for the Prisma pool included) is «degraded»; only an error or no
  // answer within 3 s is «offline» and fails the check — the agents service reads this every 3 minutes.
  const dbStatus: ServiceResult['status'] = !health.db.reachable ? 'offline' : health.db.status === 'online' ? 'online' : 'degraded'
  const db: ServiceResult = { name: 'База данных', status: dbStatus, latencyMs: health.db.latencyMs, uptime: NOT_MEASURED }
  const missing = health.missingEnv
  const config: ServiceResult = {
    name: 'Конфигурация сервера',
    status: missing === 0 ? 'online' : 'offline',
    latencyMs: 0,
    uptime: NOT_MEASURED,
  }
  const queue: ServiceResult | null = isPersistentServer() && servesWeb()
    ? { name: 'Очередь Workflow', status: QUEUE_STATUS[getWorkflowQueueStatus().state], latencyMs: 0, uptime: NOT_MEASURED }
    : null
  const inngest: ServiceResult | null = health.inngest !== 'off'
    ? { name: 'Фоновые задачи (Inngest)', status: JOURNAL_STATUS[health.inngest], latencyMs: 0, uptime: NOT_MEASURED }
    : null
  const jobs: ServiceResult | null = health.jobs !== 'off'
    ? { name: 'Задачи по расписанию', status: JOURNAL_STATUS[health.jobs], latencyMs: 0, uptime: NOT_MEASURED }
    : null
  const services = [db, config, queue, inngest, jobs].filter((s): s is ServiceResult => s !== null)
  const degradedCount = services.filter((s) => s.status !== 'online').length
  const dbOk = db.status !== 'offline'
  const configOk = missing === 0
  const queueOk = queue ? queue.status !== 'offline' : true
  const inngestOk = health.inngest !== 'fail'
  const jobsOk = health.jobs !== 'fail'
  const ok = dbOk && configOk && queueOk && inngestOk && jobsOk

  return NextResponse.json({
    ok,
    checks: {
      db: dbOk ? 'ok' : 'fail',
      config: configOk ? 'ok' : 'fail',
      ...(queue ? { queue: queueOk ? 'ok' : 'fail' } : {}),
      ...(inngest ? { inngest: health.inngest } : {}),
      ...(jobs ? { jobs: health.jobs } : {}),
    },
    services,
    allOnline: degradedCount === 0,
    degradedCount,
    missingEnvCount: missing,
    summary: degradedCount === 0
      ? 'Все проверки пройдены'
      : missing > 0
        ? 'Конфигурация сервера неполная — подробности в GIGA → Система'
        : db.status !== 'online'
          ? 'База данных отвечает медленно или недоступна'
          : queue && queue.status !== 'online'
            ? 'Очередь Workflow не запущена или ещё запускается — подробности в логах сервера'
            : health.inngest === 'fail'
              ? 'Фоновые задачи (Inngest) давно не запускались — подробности в GIGA → Система'
              : health.jobs === 'fail'
                ? 'Задачи по расписанию давно не запускались — подробности в GIGA → Система'
                : 'Проверки фоновых задач ещё собирают данные',
    timestamp: new Date().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
