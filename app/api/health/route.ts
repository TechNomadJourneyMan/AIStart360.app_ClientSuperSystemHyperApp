import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMissingServerEnv } from '@/lib/env'

/**
 * GET /api/health — public liveness check.
 *
 * Only what is actually measured is reported: database round-trip and whether
 * the server configuration is complete. Uptime is not tracked here, so it is
 * reported as «не измеряется» rather than a made-up percentage, and names of
 * missing environment variables are not disclosed publicly (staff see them in
 * GIGA → Настройки → Система, /api/giga-admin/system/health).
 */
interface ServiceResult {
  name: string
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
  uptime: string
}

const NOT_MEASURED = 'не измеряется'

async function measureDb(): Promise<ServiceResult> {
  const t = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    const ms = Date.now() - t
    return { name: 'База данных', status: ms < 150 ? 'online' : ms < 400 ? 'degraded' : 'offline', latencyMs: ms, uptime: NOT_MEASURED }
  } catch {
    return { name: 'База данных', status: 'offline', latencyMs: Date.now() - t, uptime: NOT_MEASURED }
  }
}

export async function GET() {
  const db = await measureDb()
  const missing = getMissingServerEnv().length
  const config: ServiceResult = {
    name: 'Конфигурация сервера',
    status: missing === 0 ? 'online' : 'offline',
    latencyMs: 0,
    uptime: NOT_MEASURED,
  }
  const services = [db, config]
  const degradedCount = services.filter((s) => s.status !== 'online').length

  return NextResponse.json({
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
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
