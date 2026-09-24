import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMissingServerEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — public liveness probe.
 *
 * Only ok / fail per check. It deliberately does NOT list which env vars are
 * missing and does NOT report made-up uptime figures (audit S20). Detailed
 * diagnostics live in the staff-only /api/giga-admin/system/health.
 */
async function dbOk(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

export async function GET() {
  const db = await dbOk()
  const config = getMissingServerEnv().length === 0
  const ok = db && config

  return NextResponse.json(
    { ok, checks: { db: db ? 'ok' : 'fail', config: config ? 'ok' : 'fail' }, timestamp: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
