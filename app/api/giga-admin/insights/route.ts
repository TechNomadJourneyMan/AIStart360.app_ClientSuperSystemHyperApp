export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getGigaActor } from '@/lib/admin/giga-actor'

/**
 * GET /api/giga-admin/insights?scope=pending|all&limit=200
 *
 * Moderation queue for client-facing AI insights (R2, ТЗ §5.5). Default scope
 * 'pending' returns rows awaiting review (visible_to_user = false, not
 * rejected), newest first, enriched with the owner's email/name so the
 * reviewer sees whose feed the insight belongs to.
 */
export async function GET(req: NextRequest) {
  if (!(await getGigaActor(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'pending'
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '200')
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 500) : 200

  try {
    const svc = createServiceClient()

    let query = svc
      .from('point_a_insights')
      .select(
        'id, user_id, company_id, type, category, question_text, author_name, ' +
          'answer_text, answer_author_name, answer_author_role, answered_at, ' +
          'status, source_meta, visible_to_user, published_at, published_by, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(limit)

    if (scope === 'pending') {
      query = query.eq('visible_to_user', false).neq('status', 'rejected')
    }

    const { data, error } = await query
    // supabase-js cannot statically type a concatenated select string.
    const items = (data ?? []) as unknown as Array<Record<string, unknown> & { user_id: string }>
    if (error) {
      // Column missing → migration 060 not applied; honest marker for the UI.
      if (/visible_to_user/.test(error.message)) {
        return NextResponse.json({ ok: false, error: 'migration_060_required' }, { status: 503 })
      }
      console.error('[giga-admin/insights] list failed:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    // Enrich with owner identity (one query, merged in memory).
    const userIds = Array.from(new Set(items.map((i) => i.user_id)))
    let profilesById = new Map<string, { email: string | null; full_name: string | null }>()
    if (userIds.length > 0) {
      const { data: profiles } = await svc
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds)
      profilesById = new Map(
        (profiles ?? []).map((p) => [
          p.id as string,
          { email: (p.email as string) ?? null, full_name: (p.full_name as string) ?? null },
        ])
      )
    }

    const enriched = items.map((i) => ({
      ...i,
      user: profilesById.get(i.user_id) ?? { email: null, full_name: null },
    }))

    return NextResponse.json({ ok: true, items: enriched, scope })
  } catch (e) {
    console.error('[giga-admin/insights] error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
