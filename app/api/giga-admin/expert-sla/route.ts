export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { actorClientScope } from '@/lib/admin/actor-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { decorate, inView, isSlaView, loadSlaTasks, summarize, type SlaVisibility } from '@/lib/expert-sla/store'
import { isExpertSlaSource } from '@/lib/expert-sla/policy'

/**
 * GET /api/giga-admin/expert-sla?view=open|attention|breached|queue|mine|closed[&source=plan_prep|…]
 *
 * «SLA экспертов» (R2-B): задачи экспертов с часами реакции (24 ч) и ответа
 * (48 ч). Видимость — скоуп сотрудника (как RLS миграции 146): 'all' — все;
 * «только назначенные» — задачи своих клиентов.
 * Право — clients.review (Super Admin, Admin, SuperExpert).
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  const actor = guard.actor
  const view = req.nextUrl.searchParams.get('view') ?? 'attention'
  if (!isSlaView(view)) return NextResponse.json({ ok: false, error: 'Неверный фильтр' }, { status: 400 })
  // 152: one source only (e.g. «Ждут план» in «Точка Б — очередь»: source=plan_prep).
  const source = req.nextUrl.searchParams.get('source')
  if (source !== null && !isExpertSlaSource(source)) return NextResponse.json({ ok: false, error: 'Неверный источник' }, { status: 400 })
  const bySource = <T extends { source: string }>(rows: T[]): T[] => (source ? rows.filter((r) => r.source === source) : rows)

  const scope = await actorClientScope(actor)
  // Client scope only (RLS 146): a task «assigned to me» of a client outside the scope is not shown.
  const visibility: SlaVisibility = scope.scope === 'all' ? { all: true } : { clientIds: scope.clientIds }
  const sb = createServiceClient()
  const now = new Date()
  try {
    const open = bySource(await loadSlaTasks(sb, visibility))
    const rows = view === 'closed' ? bySource(await loadSlaTasks(sb, visibility, { closed: true })) : open.filter((r) => inView(view, r, actor.id, now))
    return NextResponse.json({
      ok: true,
      data: await decorate(sb, rows.slice(0, 300), now),
      total: rows.length,
      summary: summarize(open, actor.id, now),
      scope: scope.scope,
    })
  } catch (err) {
    console.warn('[giga-admin/expert-sla]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Очередь недоступна — применена ли миграция 145?' }, { status: 503 })
  }
}
