export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyUser } from '@/lib/notifications'
import { MAX_TARGET_ID_LENGTH } from '@/lib/comment-targets'

/**
 * GET  /api/giga-admin/users/:id/comments — комментарии экспертов клиенту
 *      (`expert_comments`, миграция 005), с авторами.
 * POST /api/giga-admin/users/:id/comments { text, targetId? } — новый
 *      комментарий к блоку (targetId) или в общую ленту (право clients.review).
 *
 * Комментарий — ПУБЛИЧНЫЙ: клиент видит его в кабинете и получает уведомление.
 * Внутренние заметки персонала — вкладка «Заметки» (user_notes).
 * Черновики и пакетная публикация появятся отдельно (пакет 1b) — тело запроса
 * валидируется схемой, в которую легко добавить поле `status`.
 */

const commentSelect = 'id, client_id, author_id, author_title, block_key, text, created_at, updated_at'

const bodySchema = z.object({
  text: z.string().trim().min(1, 'Комментарий пустой').max(5000, 'Не больше 5000 символов'),
  targetId: z.string().trim().max(MAX_TARGET_ID_LENGTH).nullable().optional(),
})

interface Row {
  id: string; client_id: string; author_id: string; author_title: string | null; block_key: string | null
  text: string; created_at: string; updated_at: string
}

async function withAuthors(sb: ReturnType<typeof createServiceClient>, rows: Row[]) {
  const ids = Array.from(new Set(rows.map((r) => r.author_id)))
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    authorName: byId.get(r.author_id)?.full_name || byId.get(r.author_id)?.email || null,
    authorTitle: r.author_title,
    targetId: r.block_key,
    text: r.text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('expert_comments')
    .select(commentSelect)
    .eq('client_id', params.id)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить комментарии' }, { status: 500 })
  return NextResponse.json({ ok: true, data: await withAuthors(sb, (data ?? []) as Row[]) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive', 'clients.review'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id, { clientOnly: true })
  if (scopeDenied) return scopeDenied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный комментарий' }, { status: 400 })
  const targetId = parsed.data.targetId || null

  const sb = createServiceClient()
  const { data: me } = await sb.from('profiles').select('full_name, expert_title').eq('id', guard.actor.id).maybeSingle()
  const author = me as { full_name?: string | null; expert_title?: string | null } | null

  const { data, error } = await sb
    .from('expert_comments')
    .insert({
      client_id: params.id,
      author_id: guard.actor.id,
      author_title: author?.expert_title ?? null,
      block_key: targetId,
      text: parsed.data.text,
    })
    .select(commentSelect)
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось сохранить комментарий' }, { status: 500 })
  const row = data as Row

  await recordAdminAction(guard.actor, {
    action: 'expert.comment_added',
    entityType: 'user', entityId: params.id, targetUserId: params.id,
    metadata: { commentId: row.id, block_key: targetId, preview: parsed.data.text.slice(0, 120) },
  }, req)

  notifyUser(params.id, 'expert_comment', {
    expertName: author?.full_name || 'Эксперт',
    expertTitle: author?.expert_title ?? null,
    blockKey: targetId,
    preview: parsed.data.text,
  }).catch((e) => console.error('[giga-admin/users/comments] notifyUser failed:', e))

  return NextResponse.json({ ok: true, data: (await withAuthors(sb, [row]))[0] })
}
