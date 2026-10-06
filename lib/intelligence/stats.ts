/**
 * lib/intelligence/stats.ts — the stat tiles of /intelligence («Аналитический
 * центр», staff only: ADMIN_PATHS in middleware.ts).
 *
 * Platform-wide counts, as the page has always shown them (audit events were
 * already counted across all tenants), read on the server's direct Postgres
 * connection like the rest of the page:
 *   • audit events — public.audit_logs;
 *   • clients — public.profiles with role 'client': the product's clients.
 *     The Prisma `clients` table counted before belongs to the NextAuth-era
 *     CRM (/api/clients, written only through NextAuth sessions) and is not
 *     filled by the current registration / approval flow;
 *   • AI insights — active model hypotheses of the diagnostic pipeline:
 *     public.diagnostic_findings with provenance_type 'AI_HYPOTHESIS' and
 *     status 'active' (migration 085, written by the `diagnostic` agent through
 *     lib/diagnostics/findings-store.ts), and how many still await a staff
 *     review (reviewed_at IS NULL);
 *   • system status — the same two checks as GET /api/health: a database
 *     round-trip and completeness of the critical server environment.
 *
 * Every tile loads on its own; a failed read is reported as failed (and
 * logged), never as 0.
 */
import { prisma } from '@/lib/db'
import { getMissingServerEnv } from '@/lib/env'

export type Stat<T> = { ok: true; value: T } | { ok: false }

export interface AiInsightsCount {
  total: number
  awaitingReview: number
}

export type CheckStatus = 'online' | 'degraded' | 'offline'

export interface PlatformHealth {
  db: { status: CheckStatus; latencyMs: number }
  /** Number of missing critical server env vars (names are not exposed). */
  missingEnv: number
  allOnline: boolean
}

export interface IntelligenceStats {
  auditEvents: Stat<number>
  clients: Stat<number>
  aiInsights: Stat<AiInsightsCount>
  health: PlatformHealth
}

async function stat<T>(label: string, read: () => Promise<T>): Promise<Stat<T>> {
  try {
    return { ok: true, value: await read() }
  } catch (err) {
    console.error(`[intelligence] ${label} failed:`, err)
    return { ok: false }
  }
}

/** Same thresholds as GET /api/health (< 150 ms online, < 400 ms degraded). */
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
    console.error('[intelligence] database check failed:', err)
    ok = false
  }
  const latencyMs = Date.now() - t
  const db = { status: dbStatusFor(ok, latencyMs), latencyMs }
  const missingEnv = getMissingServerEnv().length
  return { db, missingEnv, allOnline: db.status === 'online' && missingEnv === 0 }
}

export async function getIntelligenceStats(): Promise<IntelligenceStats> {
  const [auditEvents, clients, aiInsights, health] = await Promise.all([
    stat('audit events', () => prisma.auditLog.count()),
    stat('clients', async () => {
      const rows = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM public.profiles WHERE role = 'client'`
      return Number(rows[0]?.n ?? 0)
    }),
    stat('AI insights', async () => {
      const rows = await prisma.$queryRaw<Array<{ total: number; awaiting_review: number }>>`
        SELECT count(*)::int AS total,
               (count(*) FILTER (WHERE reviewed_at IS NULL))::int AS awaiting_review
        FROM public.diagnostic_findings
        WHERE provenance_type = 'AI_HYPOTHESIS' AND status = 'active'`
      return { total: Number(rows[0]?.total ?? 0), awaitingReview: Number(rows[0]?.awaiting_review ?? 0) }
    }),
    checkPlatformHealth(),
  ])
  return { auditEvents, clients, aiInsights, health }
}
