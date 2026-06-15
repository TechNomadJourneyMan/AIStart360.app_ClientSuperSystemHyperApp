export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createClient as createSr } from '@supabase/supabase-js'

/**
 * GET /api/v1/action-plan[?userId=<id>]
 *
 * The executable Action Plan (Карта роста) — relational action_items with
 * status/owner/deadline. On first read for a user it lazily materializes tasks
 * from their current GRI 90-day plan (gri_assessments.action_plan_90d) + TOP-5
 * limits. Owner reads own; staff (expert/admin) may pass ?userId to read a client.
 * Writes via service role so RLS edge cases never break generation.
 */

const STAFF = new Set(['expert', 'admin', 'super_admin'])
const PERIODS = ['1-30', '31-60', '61-90'] as const

function sr() {
  return createSr(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  let targetId = user.id
  const param = req.nextUrl.searchParams.get('userId')
  if (param && param !== user.id) {
    const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!STAFF.has((prof?.role as string) ?? '')) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    targetId = param
  }

  const admin = sr()
  const fetchItems = async () =>
    (await admin.from('action_items').select('*').eq('user_id', targetId).order('priority', { ascending: true }).order('created_at', { ascending: true })).data ?? []

  let items = await fetchItems()

  if (items.length === 0) {
    const { data: gri } = await admin
      .from('gri_assessments')
      .select('id, action_plan_90d, top_5_limits')
      .eq('user_id', targetId)
      .eq('is_current', true)
      .maybeSingle()

    const plan = gri?.action_plan_90d as Record<string, unknown> | null
    const top5 = Array.isArray(gri?.top_5_limits) ? (gri!.top_5_limits as Array<{ block?: string }>) : []
    const rows: Record<string, unknown>[] = []
    if (plan && typeof plan === 'object') {
      let i = 0
      for (let p = 0; p < PERIODS.length; p++) {
        const period = PERIODS[p]
        const tasks = Array.isArray(plan[period]) ? (plan[period] as unknown[]) : []
        for (const t of tasks) {
          const title = typeof t === 'string' ? t : ((t as { title?: string })?.title ?? String(t))
          if (!title.trim()) continue
          rows.push({
            user_id: targetId,
            gri_assessment_id: gri?.id ?? null,
            period,
            title: title.trim(),
            status: 'open',
            linked_block: top5.length ? (top5[i % top5.length]?.block ?? null) : null,
            priority: p + 1,
          })
          i++
        }
      }
    }
    if (rows.length) {
      await admin.from('action_items').insert(rows)
      items = await fetchItems()
    }
  }

  return NextResponse.json({ ok: true, data: items })
}
