import { NextResponse } from 'next/server'
import { checkPlatformHealth } from '@/lib/health/platform'
import { isPersistentServer } from '@/lib/runtime/platform'
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

export async function GET() {
  const health = await checkPlatformHealth()
  const db: ServiceResult = { name: 'База данных', status: health.db.status, latencyMs: health.db.latencyMs, uptime: NOT_MEASURED }
  const missing = health.missingEnv
  const config: ServiceResult = {
    name: 'Конфигурация сервера',
    status: missing === 0 ? 'online' : 'offline',
    latencyMs: 0,
    uptime: NOT_MEASURED,
  }
  const queue: ServiceResult | null = isPersistentServer()
    ? { name: 'Очередь Workflow', status: QUEUE_STATUS[getWorkflowQueueStatus().state], latencyMs: 0, uptime: NOT_MEASURED }
    : null
  const services = queue ? [db, config, queue] : [db, config]
  const degradedCount = services.filter((s) => s.status !== 'online').length
  const dbOk = db.status !== 'offline'
  const configOk = missing === 0
  const queueOk = queue ? queue.status !== 'offline' : true
  const ok = dbOk && configOk && queueOk

  return NextResponse.json({
    ok,
    checks: {
      db: dbOk ? 'ok' : 'fail',
      config: configOk ? 'ok' : 'fail',
      ...(queue ? { queue: queueOk ? 'ok' : 'fail' } : {}),
    },
    services,
    allOnline: degradedCount === 0,
    degradedCount,
    missingEnvCount: missing,
    summary: degradedCount === 0
      ? 'Все проверки пройдены'
      : missing > 0
        ? 'Конфигурация сервера неполная — подробности в GIGA → Система'
        : db.status !== 'online' || !queue
          ? 'База данных отвечает медленно или недоступна'
          : 'Очередь Workflow не запущена или ещё запускается — подробности в логах сервера',
    timestamp: new Date().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
