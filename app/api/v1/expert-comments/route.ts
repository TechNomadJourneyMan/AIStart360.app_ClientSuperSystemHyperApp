export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import type { ExpertComment } from '@/lib/expert-blocks'

/**
 * GET /api/v1/expert-comments — комментарии экспертов ТЕКУЩЕМУ клиенту
 * (только свои, id берётся из сессии; чужой id передать нельзя).
 *
 * Раньше клиент читал их через /api/expert/comments?clientId=self — вместе со
 * старым порталом эксперта этот маршрут удалён. Эксперты пишут комментарии из
 * User 360 (/api/giga-admin/users/:id/comments).
 *
 * Чтение — через service role: RLS-политики expert_comments исторически
 * ссылаются на profiles и ловили рекурсию (миграции 006/007).
 */
export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('expert_comments')
    .select('id, client_id, author_id, author_title, block_key, text, created_at, updated_at')
    .eq('client_id', user.id)
    .eq('status', 'published') // черновики разбора (087) клиенту не показываем
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: 'failed to load comments' }, { status: 500 })

  const rows = (data ?? []) as Array<{
    id: string; client_id: string; author_id: string; author_title: string | null; block_key: string | null
    text: string; created_at: string; updated_at: string
  }>
  const authorIds = Array.from(new Set(rows.map((r) => r.author_id)))
  const { data: authors } = authorIds.length
    ? await admin.from('profiles').select('id, full_name, avatar_url').in('id', authorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; avatar_url: string | null }> }
  const byId = new Map((authors ?? []).map((a) => [a.id, a]))

  const out: ExpertComment[] = rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    authorId: r.author_id,
    authorName: byId.get(r.author_id)?.full_name ?? null,
    authorTitle: r.author_title,
    authorAvatarUrl: byId.get(r.author_id)?.avatar_url ?? null,
    // Роль автора клиенту не раскрываем: для него это всегда «эксперт».
    authorRole: 'expert',
    blockKey: r.block_key,
    text: r.text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
  return NextResponse.json({ data: out })
}
