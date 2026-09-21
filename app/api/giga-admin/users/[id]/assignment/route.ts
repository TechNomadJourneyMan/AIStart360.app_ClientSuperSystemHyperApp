export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET / PUT /api/giga-admin/users/:id/assignment { assigneeId: uuid | null }
 *
 * Кто ведёт клиента. Без этого в CRM невозможно ответить на простой вопрос
 * «чей это клиент», и напоминания шлют по второму разу разные люди.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({ assigneeId: z.string().uuid().nullable() })

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('user_assignments')
    .select('assignee_id, assigned_by, assigned_at, updated_at')
    .eq('user_id', params.id)
    .maybeSingle()
  if (error) {
    console.warn('[giga-admin/users/assignment]', error.message)
    return NextResponse.json({ ok: true, data: null, unavailable: true })
  }
  if (!data?.assignee_id) return NextResponse.json({ ok: true, data: null })

  const { data: person } = await sb.from('profiles').select('id, full_name, email').eq('id', data.assignee_id).maybeSingle()
  return NextResponse.json({ ok: true, data: { ...data, person: person ?? null } })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный ответственный' }, { status: 400 })
  const assigneeId = parsed.data.assigneeId

  const sb = createServiceClient()
  if (assigneeId) {
    // Ответственным может быть только сотрудник: иначе клиента «назначат» на
    // другого клиента, и задача уйдёт в никуда.
    const { data: staff } = await sb.from('staff_roles').select('user_id').eq('user_id', assigneeId).maybeSingle()
    if (!staff) return NextResponse.json({ ok: false, error: 'Ответственным может быть только сотрудник' }, { status: 400 })
  }

  const { data: before } = await sb.from('user_assignments').select('assignee_id').eq('user_id', params.id).maybeSingle()

  const now = new Date().toISOString()
  const { error } = await sb.from('user_assignments').upsert({
    user_id: params.id,
    assignee_id: assigneeId,
    assigned_by: guard.actor.id,
    assigned_at: now,
    updated_at: now,
  }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось назначить' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: assigneeId ? 'user.assigned' : 'user.unassigned',
    entityType: 'user', entityId: params.id, targetUserId: params.id,
    oldValue: { assignee_id: (before as { assignee_id?: string } | null)?.assignee_id ?? null },
    newValue: { assignee_id: assigneeId },
  }, req)

  return NextResponse.json({ ok: true })
}
