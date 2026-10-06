export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { platformHealthSnapshot } from '@/lib/agents/definitions/monitoring'
import { envChecks } from '@/lib/admin/system-health'

/**
 * GET /api/giga-admin/system/health — configuration and data-layer status.
 * Env values are never returned — only whether each is configured.
 */
const TABLES = [
  'profiles', 'survey_answers', 'gri_assessments', 'user_events', 'admin_audit_log',
  'staff_roles', 'impersonation_sessions', 'survey_answer_history', 'cms_pages',
  'platform_sections', 'system_settings', 'documents',
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

  // CRM connections: health without exposing tokens (counts only).
  let crm: { active: number; errors: number; plaintextTokens: number; lastSyncAt: string | null } | null = null
  try {
    const { data } = await sb.from('crm_provider_connections').select('is_active, last_sync_status, last_sync_at, access_token')
    const rows = (data ?? []) as Array<{ is_active: boolean; last_sync_status: string | null; last_sync_at: string | null; access_token: string }>
    crm = {
      active: rows.filter((r) => r.is_active).length,
      errors: rows.filter((r) => r.is_active && r.last_sync_status === 'error').length,
      plaintextTokens: rows.filter((r) => !String(r.access_token).startsWith('v1:')).length,
      lastSyncAt: rows.map((r) => r.last_sync_at).filter(Boolean).sort().pop() ?? null,
    }
  } catch {
    crm = null
  }

  // Agent runtime / queue / documents / AI spend (same checks the monitoring agent runs).
  let agents: Awaited<ReturnType<typeof platformHealthSnapshot>> | null = null
  try {
    agents = await platformHealthSnapshot()
  } catch {
    agents = null // migrations 086–087 not applied yet
  }

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    db: { ok: tables.every((t) => t.ok), ms: dbMs },
    env,
    tables,
    buckets,
    integrations: { crm },
    agents,
  })
}
