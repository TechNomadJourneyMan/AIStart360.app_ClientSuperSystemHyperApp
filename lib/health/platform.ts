/**
 * lib/health/platform.ts — the platform liveness checks shared by the public
 * GET /api/health and the staff /intelligence page: a database round-trip and
 * completeness of the critical server environment. Only what is measured is
 * reported; names of missing variables are not exposed here.
 */
import { prisma } from '@/lib/db'
import { getMissingServerEnv } from '@/lib/env'

export type CheckStatus = 'online' | 'degraded' | 'offline'

export interface PlatformHealth {
  db: { status: CheckStatus; latencyMs: number }
  /** Number of missing critical server env vars (names are not exposed). */
  missingEnv: number
  allOnline: boolean
}

/** Database latency bands: < 150 ms online, < 400 ms degraded, otherwise offline. */
export function dbStatusFor(ok: boolean, latencyMs: number): CheckStatus {
  if (!ok) return 'offline'
  return latencyMs < 150 ? 'online' : latencyMs < 400 ? 'degraded' : 'offline'
}

export async function checkPlatformHealth(): Promise<PlatformHealth> {
  const t = Date.now()
  let ok = true
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (err) {
    console.error('[health] database check failed:', err instanceof Error ? err.message : err)
    ok = false
  }
  const latencyMs = Date.now() - t
  const db = { status: dbStatusFor(ok, latencyMs), latencyMs }
  const missingEnv = getMissingServerEnv().length
  return { db, missingEnv, allOnline: db.status === 'online' && missingEnv === 0 }
}
