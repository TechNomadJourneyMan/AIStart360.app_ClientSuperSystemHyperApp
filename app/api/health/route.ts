import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMissingServerEnv } from '@/lib/env'

interface ServiceResult {
  name: string
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
  uptime: string
}

async function measureDb(): Promise<ServiceResult> {
  const t = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    const ms = Date.now() - t
    return {
      name: 'Data Pipeline',
      // A completed query proves the database is reachable. Cold starts and
      // cross-region pooler latency may be slow, but must not be reported as
      // an outage; reserve "offline" for connection/query failures.
      status: ms < 3000 ? 'online' : 'degraded',
      latencyMs: ms,
      uptime: 'live probe',
    }
  } catch {
    return { name: 'Data Pipeline', status: 'offline', latencyMs: Date.now() - t, uptime: 'probe failed' }
  }
}

async function measureEndpoint(name: string, url: string): Promise<ServiceResult> {
  const t = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    const ms = Date.now() - t
    return {
      name,
      // These probes intentionally include authenticated endpoints. A 401/403
      // still proves the service is up; only 5xx is an availability failure.
      status: res.status < 500 ? 'online' : 'offline',
      latencyMs: ms,
      uptime: 'live probe',
    }
  } catch {
    return { name, status: 'degraded', latencyMs: Date.now() - t, uptime: 'probe failed' }
  }
}

export async function GET(request: Request) {
  const base = new URL(request.url).origin

  const [db, apiGw, notifications] = await Promise.all([
    measureDb(),
    measureEndpoint('API Gateway', `${base}/api/auth/session`),
    measureEndpoint('Notifications', `${base}/api/notifications`),
  ])

  // GRI Engine and Report Service share the same DB connection. Their
  // availability therefore follows the real DB probe instead of a synthetic
  // latency multiplier that could turn a successful cold query into "offline".
  const griEngine: ServiceResult = {
    name: 'GRI Engine',
    status: db.status,
    latencyMs: db.latencyMs,
    uptime: 'live probe',
  }
  const reportService: ServiceResult = {
    name: 'Report Service',
    status: db.status,
    latencyMs: db.latencyMs,
    uptime: 'live probe',
  }

  // Honest configuration check: report missing critical env (Supabase/DB keys)
  // instead of falsely showing "all systems operational" on a misconfigured deploy.
  const missingEnv = getMissingServerEnv()
  const configResult: ServiceResult = {
    name: 'Configuration',
    status: missingEnv.length === 0 ? 'online' : 'offline',
    latencyMs: 0,
    uptime: missingEnv.length === 0 ? '100%' : '0%',
  }

  const services: ServiceResult[] = [apiGw, griEngine, db, reportService, notifications, configResult]
  const degradedCount = services.filter(s => s.status !== 'online').length

  return NextResponse.json({
    services,
    allOnline: degradedCount === 0,
    degradedCount,
    missingEnv,
    summary: degradedCount === 0
      ? 'Все сервисы работают'
      : missingEnv.length > 0
        ? `Не заданы переменные окружения: ${missingEnv.join(', ')}`
        : `${degradedCount} сервис${degradedCount === 1 ? '' : 'а'} с замедлением`,
    timestamp: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
