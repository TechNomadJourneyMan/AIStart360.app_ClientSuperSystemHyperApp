export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { platformHealthSnapshot } from '@/lib/agents/definitions/monitoring'
import { classifyCheckError, crmHealthFrom, envChecks, type CheckFailure, type CrmHealth } from '@/lib/admin/system-health'
import { opsOverview, type OpsOverview } from '@/lib/ops/job-watchdog'
import { schemaStatus, type SchemaStatus } from '@/lib/health/platform'

/**
 * GET /api/giga-admin/system/health — configuration and data-layer status.
 * Env values are never returned — only whether each is configured.
 * `ops` (R4-A1): every scheduled job with its last run and health from the journal of job outcomes
 * (migration 154, lib/ops/job-watchdog.ts), and where alarms can go («тревогам некуда приходить»).
 * `schema` (N5-1a, review of wave 1A): the newest migration this build ships, how many it checks
 * (every one from 140 on), which of them public.schema_migrations is missing, and the newest file
 * recorded there — the detail behind /api/health `schema: fail`.
 */
const TABLES = [
  'profiles', 'survey_answers', 'gri_assessments', 'user_events', 'admin_audit_log',
  'staff_roles', 'impersonation_sessions', 'survey_answer_history', 'cms_pages',
  'platform_sections', 'system_settings', 'documents', 'ai_usage',
]

const BUCKETS = ['cms-media', 'documents']

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'settings.manage')
  if (guard.response) return guard.response

  const env = envChecks()

  const sb = createServiceClient()
  const t0 = Date.now()
  const tables = await Promise.all(TABLES.map(async (name) => {
    const { count, error } = await sb.from(name).select('*', { count: 'estimated', head: true })
    return { name, ok: !error, rows: error ? null : count ?? 0, error: error?.message ?? null }
  }))
  const dbMs = Date.now() - t0

  let buckets: Array<{ name: string; ok: boolean }> = []
  try {
    const { data } = await sb.storage.listBuckets()
    const ids = new Set((data ?? []).map((b) => b.id))
    buckets = BUCKETS.map((name) => ({ name, ok: ids.has(name) }))
  } catch {
    buckets = BUCKETS.map((name) => ({ name, ok: false }))
  }

  // CRM connections: health without exposing tokens (counts only). A failed
  // read is reported as such (crm null + crmError), never as zero rows.
  let crm: CrmHealth | null = null
  let crmError: string | null = null
  try {
    const checked = crmHealthFrom(await sb.from('crm_provider_connections').select('is_active, last_sync_status, last_sync_at, access_token'))
    crm = checked.crm
    crmError = checked.error
  } catch (err) {
    crmError = err instanceof Error ? err.message : String(err)
  }
  if (crmError) console.error('[system/health] CRM connections check failed:', crmError)

  // Agent runtime / queue / documents / AI spend (same checks the monitoring agent runs).
  let agents: Awaited<ReturnType<typeof platformHealthSnapshot>> | null = null
  let agentsError: CheckFailure | null = null
  try {
    agents = await platformHealthSnapshot()
  } catch (err) {
    agentsError = classifyCheckError(err)
    console.error('[system/health] platform health snapshot failed:', agentsError.message)
  }

  // N5-1a: what the public /api/health only calls «schema behind» — the migrations of this build
  // missing from the journal and the newest one there. A failed read is said as such.
  let schema: SchemaStatus | null = null
  let schemaError: CheckFailure | null = null
  try {
    schema = await schemaStatus()
  } catch (err) {
    schemaError = classifyCheckError(err)
    console.error('[system/health] schema check failed:', schemaError.message)
  }

  // Scheduled jobs and alarm routes (R4-A1). A failed read is said as such, never as «all fine».
  let ops: OpsOverview | null = null
  let opsError: CheckFailure | null = null
  try {
    ops = await opsOverview()
  } catch (err) {
    opsError = classifyCheckError(err)
    console.error('[system/health] scheduled jobs overview failed:', opsError.message)
  }

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    // R4 (A4 follow-up): the portal runs on Railway — VERCEL_* are empty there. Railway sets RAILWAY_DEPLOYMENT_ID for
    // every deploy (`railway up` included) and RAILWAY_GIT_COMMIT_SHA only for deploys from GitHub (/api/healthz, runbook §8).
    runtime: {
      node: process.version,
      env: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7) || null,
      deployment: process.env.RAILWAY_DEPLOYMENT_ID?.slice(0, 8) || null,
    },
    db: { ok: tables.every((t) => t.ok), ms: dbMs },
    env,
    tables,
    buckets,
    integrations: { crm, crmError },
    agents,
    agentsError,
    schema,
    schemaError,
    ops,
    opsError,
  })
}
