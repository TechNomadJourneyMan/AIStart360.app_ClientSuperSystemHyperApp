export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'

/**
 * Клиенты эксперта (модуль «Эксперты»).
 *
 * GET    /api/giga-admin/experts/:userId/clients                 — закреплённые клиенты
 * POST   /api/giga-admin/experts/:userId/clients { userIds[] }   — назначить (≤ 200)
 * DELETE /api/giga-admin/experts/:userId/clients { userIds[] }   — снять назначение
 *
 * Пишет `user_assignments` (один ответственный на клиента: назначение
 * эксперту снимает прежнего ответственного). Каждое изменение — отдельная
 * запись журнала на клиента, чтобы в его истории было видно, кто и когда
 * передал его другому человеку.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX = 200
const bodySchema = z.object({ userIds: z.array(z.string().uuid()).min(1, 'Никто не выбран').max(MAX, `Не больше ${MAX} за раз`) })

async function guardExpert(req: NextRequest, userId: string) {
  const guard = await requireGiga(req, 'experts.manage')
  if (guard.response) return { response: guard.response }
  if (!UUID_RE.test(userId)) return { response: NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 }) }
  const { data: staff } = await createServiceClient().from('staff_roles').select('user_id').eq('user_id', userId).maybeSingle()
  if (!staff) return { response: NextResponse.json({ ok: false, error: 'Это не сотрудник' }, { status: 404 }) }
  return { actor: guard.actor }
}

export async function GET(req: NextRequest, { params }: { params: { userId: string } }) {
  const g = await guardExpert(req, params.userId)
  if (g.response) return g.response

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('user_assignments')
    .select('user_id, assigned_at')
    .eq('assignee_id', params.userId)
    .order('assigned_at', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ ok: true, data: [], unavailable: true })

  const rows = (data ?? []) as Array<{ user_id: string; assigned_at: string }>
  const ids = rows.map((r) => r.user_id)
  const [{ data: people }, { data: companies }] = ids.length
    ? await Promise.all([
        sb.from('profiles').select('id, full_name, email, organization, status').in('id', ids),
        sb.from('companies').select('user_id, name').in('user_id', ids),
      ])
    : [{ data: [] }, { data: [] }]
  const personBy = new Map(((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null; organization: string | null; status: string | null }>).map((p) => [p.id, p]))
  const companyBy = new Map(((companies ?? []) as Array<{ user_id: string; name: string | null }>).map((c) => [c.user_id, c.name]))

  return NextResponse.json({
    ok: true,
    data: rows.map((r) => {
      const p = personBy.get(r.user_id)
      return {
        id: r.user_id,
        name: companyBy.get(r.user_id) || p?.organization || p?.full_name || p?.email || r.user_id,
        email: p?.email ?? null,
        status: p?.status ?? null,
        assignedAt: r.assigned_at,
      }
    }),
  })
}

export async function POST(req: NextRequest, { params }: { params: { userId: string } }) {
  const g = await guardExpert(req, params.userId)
  if (g.response) return g.response
  const actor = g.actor
  const denied = await forbidTarget(actor, params.userId)
  if (denied) return denied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  if (await isRateLimitedKey(actor.id, 'experts-assign', { max: 30, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много операций. Попробуйте позже.' }, { status: 429 })
  }

  const sb = createServiceClient()
  const ids = Array.from(new Set(parsed.data.userIds)).filter((id) => id !== params.userId)
  const [{ data: existing }, { data: found }] = await Promise.all([
    sb.from('user_assignments').select('user_id, assignee_id').in('user_id', ids),
    sb.from('profiles').select('id').in('id', ids),
  ])
  const known = new Set(((found ?? []) as Array<{ id: string }>).map((p) => p.id))
  const prevBy = new Map(((existing ?? []) as Array<{ user_id: string; assignee_id: string | null }>).map((r) => [r.user_id, r.assignee_id]))
  const target = ids.filter((id) => known.has(id) && prevBy.get(id) !== params.userId)

  if (target.length) {
    const now = new Date().toISOString()
    const { error } = await sb.from('user_assignments').upsert(
      target.map((id) => ({ user_id: id, assignee_id: params.userId, assigned_by: actor.id, assigned_at: now, updated_at: now })),
      { onConflict: 'user_id' },
    )
    if (error) return NextResponse.json({ ok: false, error: 'Не удалось назначить клиентов' }, { status: 500 })
    await Promise.all(target.map((id) => recordAdminAction(actor, {
      action: 'user.assigned', entityType: 'user', entityId: id, targetUserId: id,
      oldValue: { assignee_id: prevBy.get(id) ?? null }, newValue: { assignee_id: params.userId },
      metadata: { via: 'experts', expertId: params.userId },
    }, req)))
  }

  return NextResponse.json({
    ok: true,
    assigned: target.length,
    skipped: ids.length - target.length,
    notFound: ids.filter((id) => !known.has(id)),
  })
}

export async function DELETE(req: NextRequest, { params }: { params: { userId: string } }) {
  const g = await guardExpert(req, params.userId)
  if (g.response) return g.response
  const actor = g.actor
  const denied = await forbidTarget(actor, params.userId)
  if (denied) return denied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })

  const { data, error } = await createServiceClient()
    .from('user_assignments')
    .update({ assignee_id: null, assigned_by: actor.id, updated_at: new Date().toISOString() })
    .eq('assignee_id', params.userId)
    .in('user_id', Array.from(new Set(parsed.data.userIds)))
    .select('user_id')
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось снять назначение' }, { status: 500 })

  const removed = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  await Promise.all(removed.map((id) => recordAdminAction(actor, {
    action: 'user.unassigned', entityType: 'user', entityId: id, targetUserId: id,
    oldValue: { assignee_id: params.userId }, newValue: { assignee_id: null },
    metadata: { via: 'experts', expertId: params.userId },
  }, req)))

  return NextResponse.json({ ok: true, removed: removed.length })
}
