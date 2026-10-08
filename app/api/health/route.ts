import { NextResponse } from 'next/server'
import { checkPlatformHealth } from '@/lib/health/platform'

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
 */
interface ServiceResult {
  name: string
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
  uptime: string
}

const NOT_MEASURED = 'не измеряется'

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
  const services = [db, config]
  const degradedCount = services.filter((s) => s.status !== 'online').length
  const dbOk = db.status !== 'offline'
  const configOk = missing === 0
  const ok = dbOk && configOk

  return NextResponse.json({
    ok,
    checks: { db: dbOk ? 'ok' : 'fail', config: configOk ? 'ok' : 'fail' },
    services,
    allOnline: degradedCount === 0,
    degradedCount,
    missingEnvCount: missing,
    summary: degradedCount === 0
      ? 'Все проверки пройдены'
      : missing > 0
        ? 'Конфигурация сервера неполная — подробности в GIGA → Система'
        : 'База данных отвечает медленно или недоступна',
    timestamp: new Date().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
