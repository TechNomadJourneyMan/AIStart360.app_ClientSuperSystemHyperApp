export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { guardClientAccess } from '@/lib/admin/client-scope'

/**
 * PATCH  /api/giga-admin/users/:id/notes/:noteId { body?, pinned? }
 * DELETE /api/giga-admin/users/:id/notes/:noteId
 *
 * Чужую заметку правит и удаляет только тот, кто вправе управлять
 * пользователями: иначе неудобную запись коллеги можно было бы тихо стереть.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const patchSchema = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  pinned: z.boolean().optional(),
})

async function loadNote(noteId: string, userId: string) {
  const { data } = await createServiceClient()
    .from('user_notes').select('id, author_id').eq('id', noteId).eq('user_id', userId).maybeSingle()
  return data as { id: string; author_id: string } | null
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.noteId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || (parsed.data.body === undefined && parsed.data.pinned === undefined)) {
    return NextResponse.json({ ok: false, error: 'Нечего изменять' }, { status: 400 })
  }

  const note = await loadNote(params.noteId, params.id)
  if (!note) return NextResponse.json({ ok: false, error: 'Заметка не найдена' }, { status: 404 })
  if (note.author_id !== guard.actor.id && !guard.actor.permissions.includes('users.manage')) {
    return NextResponse.json({ ok: false, error: 'Чужую заметку изменить нельзя' }, { status: 403 })
  }

  const { data, error } = await createServiceClient()
    .from('user_notes')
    .update({
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.noteId)
    .select('id, body, pinned, author_id, author_email, author_role, created_at, updated_at')
    .single()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось изменить заметку' }, { status: 500 })
  return NextResponse.json({ ok: true, data })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.noteId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }
  const note = await loadNote(params.noteId, params.id)
  if (!note) return NextResponse.json({ ok: false, error: 'Заметка не найдена' }, { status: 404 })
  if (note.author_id !== guard.actor.id && !guard.actor.permissions.includes('users.manage')) {
    return NextResponse.json({ ok: false, error: 'Чужую заметку удалить нельзя' }, { status: 403 })
  }

  await recordAdminAction(guard.actor, {
    action: 'user.note_deleted', entityType: 'user', entityId: params.id, targetUserId: params.id,
    metadata: { noteId: params.noteId },
  }, req, { required: true })

  const { error } = await createServiceClient().from('user_notes').delete().eq('id', params.noteId)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось удалить заметку' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
