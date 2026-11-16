export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSetting } from '@/lib/settings/store'
import { SOURCE_LABELS, clientPromiseText, isExpertSlaSource, isExpertWorkSource } from '@/lib/expert-sla/policy'
import { createServiceClient } from '@/lib/supabase-service'
import { authorNames } from '@/lib/expert-review/server'

/**
 * GET /api/v1/expert-sla — открытые задачи эксперта ПО САМОМУ клиенту (R2-B).
 *
 * Чтение — под сессией клиента: RLS миграции 145 отдаёт ему только его строки
 * (client_id = auth.uid()). Наружу — только вид работы, когда поступила и до
 * какого срока ответ; кто исполнитель и пороги эскалации клиенту не нужны.
 * `promise` — честный текст «Эксперт ответит в течение N часов», только когда
 * SLA включено, таблица задач читается (миграция есть) и у клиента есть
 * открытая работа ЭКСПЕРТА (не одобрение плана Admin-ом), срок ответа по
 * которой ещё не прошёл. Просроченной задаче нового обещания не даём.
 *
 * 152: подготовка плана Точки Б (plan_prep) — клиенту видно, КТО готовит план
 * (`assignee` — имя из профиля, никогда email; null — «Назначаем ответственного»)
 * и до какого срока. Имена других задач не отдаются.
 */
export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  let cfg: { enabled: boolean; answer_hours: number }
  try {
    cfg = await getSetting('expert_sla')
  } catch {
    return NextResponse.json({ ok: true, data: [], promise: null })
  }
  if (!cfg.enabled) return NextResponse.json({ ok: true, data: [], promise: null })

  const { data, error } = await sb
    .from('expert_sla_tasks')
    .select('id, source, received_at, answer_due_at, first_response_at, assignee_id')
    .eq('client_id', user.id)
    .is('closed_at', null)
    .order('received_at', { ascending: true })
    .limit(50)
  if (error) return NextResponse.json({ ok: true, data: [], promise: null, unavailable: true })

  const rows = ((data ?? []) as Array<{ id: string; source: string; received_at: string; answer_due_at: string; first_response_at: string | null; assignee_id?: string | null }>)
    .filter((r) => isExpertSlaSource(r.source))
  const now = Date.now()
  // The name of who prepares the plan (staff profiles are not readable by the client: the service role, own rows only).
  const planHolders = rows.filter((r) => r.source === 'plan_prep' && r.assignee_id).map((r) => r.assignee_id as string)
  const names = planHolders.length ? await authorNames(createServiceClient(), planHolders).catch(() => new Map<string, string>()) : new Map<string, string>()
  const promised = rows.some((r) => isExpertWorkSource(r.source) && new Date(r.answer_due_at).getTime() > now)
  return NextResponse.json({
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      source: r.source,
      label: SOURCE_LABELS[r.source as keyof typeof SOURCE_LABELS],
      receivedAt: r.received_at,
      answerDueAt: r.answer_due_at,
      inProgress: !!r.first_response_at,
      overdue: new Date(r.answer_due_at).getTime() <= now,
      ...(r.source === 'plan_prep' ? { assignee: (r.assignee_id && names.get(r.assignee_id)) || null } : {}),
    })),
    promise: promised ? clientPromiseText(cfg.answer_hours) : null,
  })
}
