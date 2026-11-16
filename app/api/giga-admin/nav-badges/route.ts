export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { hasPermission } from '@/lib/admin/rbac'
import { actorClientScope } from '@/lib/admin/actor-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { loadOpenPaidRequests, requestSlaHours, summarizeRequestSla } from '@/lib/access/request-notices'
import { visibleTo, type SlaVisibility } from '@/lib/expert-sla/store'
import type { WorkBadges } from '@/lib/admin/nav'

/**
 * GET /api/giga-admin/nav-badges → { ok, accessRequests?, planWaiting? }
 *
 * Счётчики меню ГИГА (R4, решения PO 2026-11-16):
 *   accessRequests — открытые заявки на оплату и сколько из них ждут дольше
 *                    срока ответа (request_sla_hours, 4 ч): бейдж «Заявки»
 *                    (users.view; это очередь приёма — видна целиком, как в списке);
 *   planWaiting    — клиенты ждут план Точки Б (открытые задачи plan_prep) в
 *                    скоупе сотрудника: бейдж у «Точка Б — на одобрении»
 *                    (clients.review, как GET /api/giga-admin/expert-sla).
 * Счётчик, на который нет права, не отдаётся. Ошибка базы — счётчика нет
 * (бейдж прячется), а не красный экран: меню не должно падать.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'dashboard.view')
  if (guard.response) return guard.response
  const actor = guard.actor
  const sb = createServiceClient()
  const now = new Date()
  const out: WorkBadges = {}

  if (hasPermission(actor.role, 'users.view')) {
    try {
      const [rows, slaHours] = await Promise.all([loadOpenPaidRequests(sb), requestSlaHours()])
      const s = summarizeRequestSla(rows, slaHours, now)
      out.accessRequests = { open: s.open, overdue: s.overdue, slaHours }
    } catch (err) {
      console.warn('[giga-admin/nav-badges] requests:', err instanceof Error ? err.message : err)
    }
  }

  if (hasPermission(actor.role, 'clients.review')) {
    try {
      const scope = await actorClientScope(actor)
      const visibility: SlaVisibility = scope.scope === 'all' ? { all: true } : { clientIds: scope.clientIds }
      const { data, error } = await sb
        .from('expert_sla_tasks')
        .select('client_id, assignee_id, answer_due_at')
        .eq('source', 'plan_prep')
        .is('closed_at', null)
        .limit(2000)
      if (error) throw new Error(String(error.message ?? 'expert_sla_tasks').slice(0, 160))
      const prep = ((data ?? []) as Array<{ client_id: string; assignee_id: string | null; answer_due_at: string | null }>)
        .filter((t) => visibleTo(visibility, t))
      out.planWaiting = {
        open: prep.length,
        overdue: prep.filter((t) => !!t.answer_due_at && Date.parse(t.answer_due_at) < now.getTime()).length,
      }
    } catch (err) {
      console.warn('[giga-admin/nav-badges] plan_prep:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, ...out })
}
