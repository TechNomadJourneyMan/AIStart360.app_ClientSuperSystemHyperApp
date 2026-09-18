export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { getSetting } from '@/lib/settings/store'

/**
 * GET  — how many activity events are older than the retention period.
 * POST — delete them (audited first). Retention comes from settings only,
 * so the request cannot widen what gets deleted.
 */
async function cutoff(): Promise<{ days: number; before: string }> {
  const days = await getSetting('events_retention_days')
  return { days, before: new Date(Date.now() - days * 86_400_000).toISOString() }
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'settings.manage')
  if (guard.response) return guard.response
  const { days, before } = await cutoff()
  const sb = createServiceClient()
  const [{ count: old }, { count: total }] = await Promise.all([
    sb.from('user_events').select('id', { count: 'exact', head: true }).lt('created_at', before),
    sb.from('user_events').select('id', { count: 'exact', head: true }),
  ])
  return NextResponse.json({ ok: true, days, before, old: old ?? 0, total: total ?? 0 })
}

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'settings.manage')
  if (guard.response) return guard.response
  const { days, before } = await cutoff()
  const sb = createServiceClient()
  try {
    const { count } = await sb.from('user_events').select('id', { count: 'exact', head: true }).lt('created_at', before)
    await recordAdminAction(guard.actor, {
      action: 'system.events_purged',
      entityType: 'user_events',
      metadata: { retention_days: days, before, expected: count ?? 0 },
    }, req, { required: true })
    const { error } = await sb.from('user_events').delete().lt('created_at', before)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, deleted: count ?? 0, before })
  } catch (e) {
    console.error('[giga-admin/system/purge-events]', e)
    return NextResponse.json({ ok: false, error: 'Не удалось очистить события' }, { status: 500 })
  }
}
