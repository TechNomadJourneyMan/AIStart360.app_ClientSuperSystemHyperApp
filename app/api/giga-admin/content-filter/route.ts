export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireGiga } from '@/lib/admin/giga-actor'
import { getSetting } from '@/lib/settings/store'
import { isMissingTable, migrationMissingResponse, MODERATION_EVENT_STATUSES, UUID_RE } from '@/lib/moderation/admin'
import type { ProfanityCategory } from '@/lib/moderation/profanity'

/**
 * GET /api/giga-admin/content-filter?status=open|reviewed|false_positive|all
 *     &category=mat|insult|spam|custom&user=<uuid>&page=
 *
 * Журнал фильтра контента (content_moderation_events) + счётчики по статусам
 * + состояние настройки content_filter_enabled. Право moderation.content.
 * Мат в журнале уже замаскирован (lib/moderation/guard.ts).
 */
const CATEGORIES: readonly ProfanityCategory[] = ['mat', 'insult', 'spam', 'custom']
const PAGE_SIZE = 25

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'moderation.content')
  if (guard.response) return guard.response

  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Math.min(1000, Number(sp.get('page')) || 1))
  const statusParam = sp.get('status') ?? 'open'
  const status = statusParam === 'all' || (MODERATION_EVENT_STATUSES as readonly string[]).includes(statusParam) ? statusParam : 'open'
  const categoryParam = sp.get('category')
  const category = categoryParam && (CATEGORIES as readonly string[]).includes(categoryParam) ? categoryParam : null
  const userParam = sp.get('user')
  const userId = userParam && UUID_RE.test(userParam) ? userParam : null

  let filterEnabled = true
  try {
    filterEnabled = await getSetting('content_filter_enabled', { fresh: true })
  } catch {
    // Настройки недоступны — фильтр по умолчанию включён (fail-safe guard.ts).
  }

  const sb = createServiceClient()
  let q = sb
    .from('content_moderation_events')
    .select('id, user_id, user_email, source, field, field_label, categories, terms, excerpt, action, status, reviewed_by, reviewed_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (status !== 'all') q = q.eq('status', status)
  if (category) q = q.contains('categories', [category])
  if (userId) q = q.eq('user_id', userId)

  const { data, count, error } = await q
  if (error) {
    if (isMissingTable(error)) return migrationMissingResponse()
    console.error('[giga-admin/content-filter] list failed:', error.message)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить журнал' }, { status: 500 })
  }

  // Счётчики по статусам (с учётом фильтра по пользователю, но не по статусу).
  const counts: Record<string, number> = { open: 0, reviewed: 0, false_positive: 0 }
  await Promise.all(MODERATION_EVENT_STATUSES.map(async (s) => {
    let cq = sb.from('content_moderation_events').select('id', { count: 'exact', head: true }).eq('status', s)
    if (userId) cq = cq.eq('user_id', userId)
    const { count: c } = await cq
    counts[s] = c ?? 0
  }))

  // Имена пользователей для таблицы (email в журнале есть всегда, имя — из профиля).
  const ids = Array.from(new Set((data ?? []).map((r) => r.user_id).filter((v): v is string => typeof v === 'string')))
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, full_name, status').in('id', ids)
    : { data: [] as Array<{ id: string; full_name: string | null; status: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id as string, p]))

  return NextResponse.json({
    ok: true,
    data: (data ?? []).map((r) => {
      const p = r.user_id ? byId.get(r.user_id) : undefined
      return { ...r, user_name: p?.full_name ?? null, user_status: p?.status ?? null }
    }),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    counts,
    filterEnabled,
  })
}
