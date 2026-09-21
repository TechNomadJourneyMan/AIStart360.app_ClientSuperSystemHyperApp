export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET  /api/giga-admin/users/:id/notes — заметки сотрудников о клиенте.
 * POST /api/giga-admin/users/:id/notes { body, pinned? } — добавить заметку.
 *
 * Зачем: то, что выяснили на созвоне, раньше жило в голове или в чужом чате.
 * Заметка подписана автором и временем; закреплённые всплывают наверх.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({
  body: z.string().trim().min(1, 'Заметка пустая').max(4000),
  pinned: z.boolean().optional(),
})

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const { data, error } = await createServiceClient()
    .from('user_notes')
    .select('id, body, pinned, author_id, author_email, author_role, created_at, updated_at')
    .eq('user_id', params.id)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    console.warn('[giga-admin/users/notes]', error.message)
    return NextResponse.json({ ok: true, data: [], unavailable: true })
  }
  return NextResponse.json({ ok: true, data: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверная заметка' }, { status: 400 })
  }

  const { data, error } = await createServiceClient()
    .from('user_notes')
    .insert({
      user_id: params.id,
      author_id: guard.actor.id,
      author_email: guard.actor.email ?? null,
      author_role: guard.actor.role,
      body: parsed.data.body,
      pinned: parsed.data.pinned ?? false,
    })
    .select('id, body, pinned, author_id, author_email, author_role, created_at, updated_at')
    .single()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить заметку' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'user.note_added', entityType: 'user', entityId: params.id, targetUserId: params.id,
    metadata: { noteId: (data as { id: string }).id },
  }, req)

  return NextResponse.json({ ok: true, data })
}
