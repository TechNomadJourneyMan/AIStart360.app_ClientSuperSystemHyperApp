export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { platformHealthSnapshot } from '@/lib/agents/definitions/monitoring'
import { classifyCheckError, crmHealthFrom, envChecks, type CheckFailure, type CrmHealth } from '@/lib/admin/system-health'

/**
 * GET /api/giga-admin/system/health — configuration and data-layer status.
 * Env values are never returned — only whether each is configured.
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

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    db: { ok: tables.every((t) => t.ok), ms: dbMs },
    env,
    tables,
    buckets,
    integrations: { crm, crmError },
    agents,
    agentsError,
  })
}
