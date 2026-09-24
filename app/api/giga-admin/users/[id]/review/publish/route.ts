export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { createNotification } from '@/lib/notifications/create'
import { sendExpertReviewPublishedEmail } from '@/lib/email/notify'
import { pluralComments } from '@/lib/email/templates'
import { reviewBlockLabel } from '@/lib/expert-review/blocks'
import { hasBlockingFlag } from '@/lib/expert-review/ai-draft'
import { REVIEW_COLUMNS, UUID_RE, displayNameOf, findDraftReview, listDraftComments } from '@/lib/expert-review/server'

/**
 * POST /api/giga-admin/users/:id/review/publish { expectedCount? }
 *
 * Публикует разбор ОДНИМ действием: все черновые комментарии клиента и сам
 * разбор становятся видны клиенту, клиент получает ОДНО письмо и ОДНО
 * уведомление в кабинете, в журнал пишется `expert.review_published`.
 *
 * `expectedCount` — сколько комментариев эксперт видел в диалоге
 * подтверждения. Если за это время черновик изменился (коллега добавил
 * комментарий, ИИ дописал черновик) — 409, чтобы клиенту не ушло то, чего
 * эксперт не читал.
 */

const bodySchema = z.object({ expectedCount: z.number().int().min(0).optional() })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) ?? {})
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверные данные' }, { status: 400 })

  const sb = createServiceClient()
  const draft = await findDraftReview(sb, params.id)
  if (!draft) return NextResponse.json({ ok: false, error: 'Черновика разбора нет' }, { status: 400 })

  const drafts = await listDraftComments(sb, params.id)
  if (!drafts.length) return NextResponse.json({ ok: false, error: 'В разборе нет комментариев' }, { status: 400 })
  if (parsed.data.expectedCount !== undefined && parsed.data.expectedCount !== drafts.length) {
    return NextResponse.json(
      { ok: false, error: 'Черновик изменился — обновите страницу и проверьте разбор ещё раз', count: drafts.length },
      { status: 409 },
    )
  }

  const flagged = drafts.filter((c) => hasBlockingFlag(c.ai_flags)).length
  if (flagged) {
    return NextResponse.json(
      { ok: false, error: `Поправьте ИИ-комментарии с ошибками проверки (${flagged}) — без правки их публиковать нельзя` },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()

  // 1. Захватываем разбор: второй параллельный вызов получит 0 строк → 409.
  const { data: claimed, error: claimErr } = await sb
    .from('expert_reviews')
    .update({ status: 'published', published_at: now })
    .eq('id', draft.id)
    .eq('status', 'draft')
    .select(REVIEW_COLUMNS)
    .maybeSingle()
  if (claimErr) return NextResponse.json({ ok: false, error: 'Не удалось опубликовать разбор' }, { status: 500 })
  if (!claimed) return NextResponse.json({ ok: false, error: 'Разбор уже опубликован' }, { status: 409 })

  // 2. Все черновые комментарии → опубликованы и привязаны к разбору.
  const ids = drafts.map((c) => c.id)
  const { data: updated, error: updErr } = await sb
    .from('expert_comments')
    .update({ status: 'published', published_at: now, review_id: draft.id })
    .eq('client_id', params.id)
    .eq('status', 'draft')
    .in('id', ids)
    .select('id')
  if (updErr) {
    // Возвращаем разбор в черновик — клиент не должен увидеть пустой разбор.
    await sb.from('expert_reviews').update({ status: 'draft', published_at: null }).eq('id', draft.id)
    return NextResponse.json({ ok: false, error: 'Не удалось опубликовать комментарии' }, { status: 500 })
  }
  const count = (updated as unknown[] | null)?.length ?? ids.length
  const blocks = Array.from(new Set(drafts.map((c) => reviewBlockLabel(c.block_key))))

  // 3. Одно письмо + одно уведомление клиенту.
  const [{ data: client }, expertName] = await Promise.all([
    sb.from('profiles').select('email, full_name').eq('id', params.id).maybeSingle(),
    displayNameOf(sb, guard.actor.id),
  ])
  const profile = client as { email?: string | null; full_name?: string | null } | null
  let email: { ok: boolean; skipped?: boolean; error?: string } = { ok: false, error: 'no_email' }
  if (profile?.email) {
    email = await sendExpertReviewPublishedEmail(profile.email, {
      name: profile.full_name ?? null,
      expertName,
      commentsCount: count,
      title: draft.title,
      publishedAt: now,
      userId: params.id,
      reviewId: draft.id,
    })
  }

  await createNotification({
    userId: params.id,
    title: 'Эксперт подготовил разбор',
    body: `${pluralComments(count)} по блокам: ${blocks.slice(0, 4).join(', ')}${blocks.length > 4 ? ' и др.' : ''}`,
    category: 'report',
    priority: 'high',
    link: '/client/home#expert',
    metadata: { reviewId: draft.id, commentsCount: count },
  })

  await recordAdminAction(guard.actor, {
    action: 'expert.review_published', entityType: 'expert_review', entityId: draft.id, targetUserId: params.id,
    newValue: { status: 'published', published_at: now },
    metadata: {
      comments: count,
      aiComments: drafts.filter((c) => c.source === 'ai').length,
      blocks,
      emailSent: email.ok && !email.skipped,
      emailError: email.ok ? null : email.error ?? null,
    },
  }, req)

  return NextResponse.json({
    ok: true,
    data: { reviewId: draft.id, published: count, publishedAt: now, email: { sent: email.ok && !email.skipped, error: email.ok ? null : email.error ?? null } },
  })
}
