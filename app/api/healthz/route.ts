import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/healthz — process liveness for the deploy health check (Railway).
 *
 * Deliberately independent of the database, Supabase and server configuration:
 * when the database stalls, /api/health answers 503 and a platform probe that
 * pointed at it would restart a perfectly healthy server in a loop. This route
 * only proves the process is up and serving requests; readiness of the
 * dependencies stays with /api/health. Middleware lets every /api/* path
 * through without auth, so no credentials are needed.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, uptimeS: Math.round(process.uptime()) },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
