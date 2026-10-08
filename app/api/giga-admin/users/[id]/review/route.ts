export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { reviewBlockLabel } from '@/lib/expert-review/blocks'
import {
  REVIEW_COLUMNS,
  UUID_RE,
  authorNames,
  ensureDraftReview,
  findDraftReview,
  listDraftComments,
  type ReviewRow,
} from '@/lib/expert-review/server'

/**
 * GET  /api/giga-admin/users/:id/review — текущий черновик разбора клиента,
 *      его черновые комментарии по блокам и история опубликованных разборов.
 * POST /api/giga-admin/users/:id/review { title?, summary? } — создать черновик
 *      (если его нет) и/или сохранить заголовок и вступление.
 *
 * Черновик клиент не видит: он уходит клиенту только через
 * POST /review/publish — одним письмом и одним уведомлением.
 */

const bodySchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().max(5000).nullable().optional(),
})

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const sb = createServiceClient()
  try {
    const [draft, comments, publishedRes] = await Promise.all([
      findDraftReview(sb, params.id),
      listDraftComments(sb, params.id),
      sb
        .from('expert_reviews')
        .select(REVIEW_COLUMNS)
        .eq('user_id', params.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(50),
    ])
    const published = (publishedRes.data as ReviewRow[] | null) ?? []

    const counts = new Map<string, number>()
    if (published.length) {
      const { data: rows } = await sb
        .from('expert_comments')
        .select('review_id')
        .eq('client_id', params.id)
        .eq('status', 'published')
        .in('review_id', published.map((r) => r.id))
      for (const r of (rows as Array<{ review_id: string | null }> | null) ?? []) {
        if (r.review_id) counts.set(r.review_id, (counts.get(r.review_id) ?? 0) + 1)
      }
    }

    const names = await authorNames(sb, [...comments.map((c) => c.author_id), ...published.map((r) => r.author_id)])
    return NextResponse.json({
      ok: true,
      data: {
        draft,
        comments: comments.map((c) => ({
          ...c,
          author_name: names.get(c.author_id) ?? null,
          block_label: reviewBlockLabel(c.block_key),
        })),
        published: published.map((r) => ({
          ...r,
          author_name: r.author_id ? names.get(r.author_id) ?? null : null,
          comments_count: counts.get(r.id) ?? 0,
        })),
      },
    })
  } catch (e) {
    console.warn('[giga-admin/review] GET', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: true, data: { draft: null, comments: [], published: [] }, unavailable: true })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) ?? {})
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }

  const sb = createServiceClient()
  let review: ReviewRow
  try {
    review = await ensureDraftReview(sb, params.id, guard.actor.id)
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось создать черновик разбора' }, { status: 500 })
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.title !== undefined) patch.title = parsed.data.title || null
  if (parsed.data.summary !== undefined) patch.summary = parsed.data.summary || null
  if (Object.keys(patch).length) {
    const { data, error } = await sb
      .from('expert_reviews')
      .update(patch)
      .eq('id', review.id)
      .eq('status', 'draft')
      .select(REVIEW_COLUMNS)
      .maybeSingle()
    if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось сохранить черновик' }, { status: 500 })
    await recordAdminAction(guard.actor, {
      action: 'expert.review_draft_saved', entityType: 'expert_review', entityId: review.id, targetUserId: params.id,
      oldValue: { title: review.title, summary: review.summary }, newValue: patch,
    }, req)
    review = data as ReviewRow
  }

  return NextResponse.json({ ok: true, data: review })
}
