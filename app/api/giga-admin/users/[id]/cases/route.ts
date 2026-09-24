export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyUser } from '@/lib/notifications'

/**
 * GET   /api/giga-admin/users/:id/cases — обращения клиента к эксперту
 *       (эскалации Smart Assistant, `expert_cases`, миграция 032).
 * PATCH /api/giga-admin/users/:id/cases { caseId, status?, priority?, expert_action_recommended? }
 *       — эксперт меняет статус / приоритет / рекомендацию (право clients.review).
 *
 * Читаем и пишем только существующие колонки; назначение ответственного и SLA
 * по кейсам — отдельная работа (очередь эскалаций), здесь их нет.
 */

const CASE_COLUMNS =
  'id, user_id, company_id, diagnostic_id, status, priority, trigger_type, title, summary, detected_issues, user_message, assistant_recommendation, expert_action_recommended, assigned_to, created_at, updated_at'

const patchSchema = z.object({
  caseId: z.string().uuid('Неверный кейс'),
  status: z.enum(['new', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  expert_action_recommended: z.string().trim().max(8000, 'Слишком длинный текст').nullable().optional(),
})

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const { data, error } = await createServiceClient()
    .from('expert_cases')
    .select(CASE_COLUMNS)
    .eq('user_id', params.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    console.warn('[giga-admin/users/cases]', error.message)
    return NextResponse.json({ ok: true, data: [], unavailable: true })
  }
  return NextResponse.json({ ok: true, data: data ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive', 'clients.review'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  const { caseId, ...fields } = parsed.data
  const patch: Record<string, unknown> = {}
  if (fields.status !== undefined) patch.status = fields.status
  if (fields.priority !== undefined) patch.priority = fields.priority
  if (fields.expert_action_recommended !== undefined) patch.expert_action_recommended = fields.expert_action_recommended || null
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'Нечего изменять' }, { status: 400 })

  const sb = createServiceClient()
  // id И user_id: кейс чужого клиента через подмену caseId не изменить.
  const { data: before } = await sb.from('expert_cases').select('status, priority, expert_action_recommended').eq('id', caseId).eq('user_id', params.id).maybeSingle()
  if (!before) return NextResponse.json({ ok: false, error: 'Кейс не найден' }, { status: 404 })

  const { data: updated, error } = await sb
    .from('expert_cases')
    .update(patch)
    .eq('id', caseId)
    .eq('user_id', params.id)
    .select(CASE_COLUMNS)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось обновить кейс' }, { status: 500 })
  if (!updated) return NextResponse.json({ ok: false, error: 'Кейс не найден' }, { status: 404 })

  await recordAdminAction(guard.actor, {
    action: 'expert.case_updated',
    entityType: 'expert_case', entityId: caseId, targetUserId: params.id,
    oldValue: before, newValue: patch,
  }, req)

  // Как и в старом портале: клиент узнаёт, что эксперт взял обращение в работу.
  const u = updated as { title?: string | null; status?: string | null; priority?: string | null }
  notifyUser(params.id, 'expert_case_updated', { caseId, title: u.title ?? null, status: u.status ?? null, priority: u.priority ?? null })
    .catch((e) => console.error('[giga-admin/users/cases] notifyUser failed:', e))

  return NextResponse.json({ ok: true, data: updated })
}
