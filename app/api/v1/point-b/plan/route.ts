export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { gateFeature } from '@/lib/access/gate'
import { loadClientPlanView, NO_CLIENT_PLAN } from '@/lib/point-b/plan/client-view'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/v1/point-b/plan — the plan workflow as the OWNER sees it:
 *   { ok, data: { status: 'none' | 'preparing' | 'published',
 *                 version: { number, approvedAt, expertNotes, authorName, goals } | null,
 *                 goalReviews: [{ id, metricKey, metricLabel, status, from, to, reason, createdAt }] } }
 * The user comes from the session only. Only the APPROVED version is returned — never a draft or a
 * version waiting for approval. A user without a company, goals or plan gets `none` (not an error).
 * Pro feature: a free client gets 402 while the access gates are on (staff are exempt).
 */
export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade

  try {
    return NextResponse.json({ ok: true, data: await loadClientPlanView(createServiceClient(), user.id) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The plan tables are not there yet (migration 125 not applied): an empty state, like «no plan».
    if (/\((42P01|PGRST205)\)/.test(message)) return NextResponse.json({ ok: true, data: NO_CLIENT_PLAN })
    console.error('[v1/point-b/plan]', message)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить план Точки Б' }, { status: 500 })
  }
}
