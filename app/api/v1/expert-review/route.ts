export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { reviewBlockLabel, reviewBlockOrder } from '@/lib/expert-review/blocks'
import { authorNames } from '@/lib/expert-review/server'

/**
 * GET /api/v1/expert-review — разбор эксперта для ТЕКУЩЕГО клиента.
 *
 * Клиент берётся только из сессии (никаких user_id в запросе). Отдаются
 * исключительно ОПУБЛИКОВАННЫЕ разборы и комментарии: черновики эксперта
 * клиенту не видны — фильтр здесь и RLS-политика в миграции 087.
 * Имя автора — ФИО или «Эксперт AIStart360», никогда не email.
 */

interface PublicComment {
  id: string
  author_id: string
  author_title: string | null
  block_key: string | null
  text: string
  review_id: string | null
  published_at: string | null
  created_at: string
}

interface PublicReview {
  id: string
  author_id: string | null
  title: string | null
  summary: string | null
  published_at: string | null
}

export async function GET() {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const [reviewsRes, commentsRes] = await Promise.all([
    sb
      .from('expert_reviews')
      .select('id, author_id, title, summary, published_at')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50),
    sb
      .from('expert_comments')
      .select('id, author_id, author_title, block_key, text, review_id, published_at, created_at')
      .eq('client_id', user.id)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(300),
  ])
  if (commentsRes.error) {
    console.warn('[v1/expert-review]', commentsRes.error.message)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить разбор' }, { status: 500 })
  }

  // Таблицы разборов может ещё не быть (миграция 087) — комментарии всё равно показываем.
  const reviews = (reviewsRes.error ? [] : (reviewsRes.data as PublicReview[] | null) ?? [])
  const comments = (commentsRes.data as PublicComment[] | null) ?? []
  const names = await authorNames(sb, [...comments.map((c) => c.author_id), ...reviews.map((r) => r.author_id)])

  const byBlock = new Map<string, { key: string; label: string; order: number; comments: unknown[] }>()
  for (const c of comments) {
    const key = c.block_key ?? 'general'
    const label = reviewBlockLabel(c.block_key)
    const group = byBlock.get(label) ?? { key, label, order: reviewBlockOrder(c.block_key), comments: [] }
    group.comments.push({
      id: c.id,
      text: c.text,
      author_name: names.get(c.author_id) ?? null,
      author_title: c.author_title,
      review_id: c.review_id,
      date: c.published_at ?? c.created_at,
    })
    byBlock.set(label, group)
  }

  return NextResponse.json({
    ok: true,
    data: {
      reviews: reviews.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        published_at: r.published_at,
        author_name: r.author_id ? names.get(r.author_id) ?? null : null,
        comments_count: comments.filter((c) => c.review_id === r.id).length,
      })),
      blocks: Array.from(byBlock.values())
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ru'))
        .map(({ key, label, comments }) => ({ key, label, comments })),
      total: comments.length,
    },
  })
}
