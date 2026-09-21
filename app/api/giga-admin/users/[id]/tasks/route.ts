export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET  /api/giga-admin/users/:id/tasks — задачи по клиенту.
 * POST /api/giga-admin/users/:id/tasks { title, dueAt?, assigneeId? }
 *
 * Минимальный набор: что сделать, к какому сроку и кто. Без статусов-колонок
 * и вложенных подзадач — в CRM для двух человек это лишний вес.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({
  title: z.string().trim().min(1, 'Опишите задачу').max(300),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
})

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('staff_tasks')
    .select('id, title, due_at, status, assignee_id, created_by, created_at, done_at')
    .eq('user_id', params.id)
    .order('status', { ascending: true })
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(200)
  if (error) {
    console.warn('[giga-admin/users/tasks]', error.message)
    return NextResponse.json({ ok: true, data: [], unavailable: true })
  }

  const ids = Array.from(new Set((data ?? []).map((t) => t.assignee_id).filter((x): x is string => !!x)))
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  return NextResponse.json({
    ok: true,
    data: (data ?? []).map((t) => ({ ...t, assignee: t.assignee_id ? byId.get(t.assignee_id) ?? null : null })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверная задача' }, { status: 400 })
  }

  const { data, error } = await createServiceClient()
    .from('staff_tasks')
    .insert({
      user_id: params.id,
      title: parsed.data.title,
      due_at: parsed.data.dueAt ?? null,
      // Без явного исполнителя задача остаётся за тем, кто её завёл, —
      // задача без владельца не делается никогда.
      assignee_id: parsed.data.assigneeId ?? (UUID_RE.test(guard.actor.id) ? guard.actor.id : null),
      created_by: guard.actor.id,
    })
    .select('id, title, due_at, status, assignee_id, created_by, created_at, done_at')
    .single()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось создать задачу' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'user.task_created', entityType: 'user', entityId: params.id, targetUserId: params.id,
    metadata: { taskId: (data as { id: string }).id, title: parsed.data.title },
  }, req)

  return NextResponse.json({ ok: true, data })
}
