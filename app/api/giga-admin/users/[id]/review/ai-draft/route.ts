export const dynamic = 'force-dynamic'
export const maxDuration = 90

import { NextRequest, NextResponse } from 'next/server'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { OPENROUTER_MODELS, chatWithOpenRouter, extractJson, hasOpenRouterKey } from '@/lib/ai/openrouter'
import { toStoredBlockKey } from '@/lib/expert-review/blocks'
import { COMMENT_COLUMNS, UUID_RE, ensureDraftReview } from '@/lib/expert-review/server'
import {
  REVIEW_AI_SYSTEM,
  buildReviewAiUser,
  buildReviewContext,
  parseAiDraft,
  validateDraftItems,
} from '@/lib/expert-review/ai-draft'
import type { SurveyStepRow } from '@/lib/survey/steps'

/**
 * POST /api/giga-admin/users/:id/review/ai-draft
 *
 * ИИ готовит ЧЕРНОВИК разбора по блокам из данных клиента: анкета, Точка А
 * (diagnostics), GRI (gri_assessments: индекс, блоки, топ-5 ограничений),
 * Точка Б. Каждый текст проходит lib/ai/validation; сохраняется как черновой
 * комментарий с source='ai'. НИКОГДА не публикуется автоматически — клиенту
 * разбор уходит только через POST /review/publish.
 *
 * Лимит — 5 генераций в час на сотрудника. Если данных нет — честно говорим,
 * чего не хватает, и модель не вызываем.
 */

const AI_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  if (!hasOpenRouterKey()) {
    return NextResponse.json({ ok: false, error: 'ИИ недоступен: не настроен ключ OpenRouter' }, { status: 503 })
  }
  if (await isRateLimitedKey(guard.actor.id, 'expert-review-ai-draft', AI_LIMIT)) {
    return NextResponse.json({ ok: false, error: 'Лимит: не больше 5 ИИ-черновиков в час. Попробуйте позже.' }, { status: 429 })
  }

  const sb = createServiceClient()
  const [survey, diag, gri] = await Promise.all([
    sb.from('survey_answers').select('question_key, step, answer').eq('user_id', params.id),
    sb.from('diagnostics').select('*').eq('user_id', params.id).eq('is_current', true).limit(1).maybeSingle(),
    sb
      .from('gri_assessments')
      .select('gri_index, section_avgs, top_5_limits, created_at')
      .eq('user_id', params.id)
      .eq('is_current', true)
      .limit(1)
      .maybeSingle(),
  ])
  const diagnostic = (diag.data as Record<string, unknown> | null) ?? null

  let pointB: Record<string, unknown> | null = null
  let expertPointB: Record<string, unknown> | null = null
  if (diagnostic?.id) {
    const [pb, ev] = await Promise.all([
      sb
        .from('point_b_analysis')
        .select('target_overall, target_health, target_stage')
        .eq('diagnostic_id', diagnostic.id as string)
        .eq('is_current', true)
        .limit(1)
        .maybeSingle(),
      sb
        .from('point_b_versions')
        .select('expert_notes')
        .eq('diagnostic_id', diagnostic.id as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    pointB = (pb.data as Record<string, unknown> | null) ?? null
    expertPointB = (ev.data as Record<string, unknown> | null) ?? null
  }

  const ctx = buildReviewContext({
    surveyRows: (survey.data as SurveyStepRow[] | null) ?? [],
    diagnostic,
    gri: (gri.data as Record<string, unknown> | null) ?? null,
    pointB,
    expertPointB,
  })
  if (!ctx.hasData) {
    return NextResponse.json(
      { ok: false, error: `Не из чего готовить разбор: ${ctx.missing.join('; ')}.`, missing: ctx.missing },
      { status: 422 },
    )
  }

  const model = OPENROUTER_MODELS.sonnet
  const raw = await chatWithOpenRouter({
    feature: 'expert_review_draft',
    system: REVIEW_AI_SYSTEM,
    user: buildReviewAiUser(ctx),
    model,
    jsonMode: true,
    temperature: 0.4,
    maxTokens: 3500,
    timeoutMs: 75_000,
    privacySensitive: true,
  })
  const items = parseAiDraft(raw ? extractJson(raw) : null)
  if (!items.length) {
    return NextResponse.json({ ok: false, error: 'ИИ не вернул черновик. Попробуйте ещё раз позже.' }, { status: 502 })
  }

  const { kept, dropped } = await validateDraftItems(items, ctx.numbers)
  if (!kept.length) {
    return NextResponse.json({ ok: false, error: 'Проверка отклонила все тексты ИИ — напишите разбор вручную.', dropped }, { status: 422 })
  }

  let reviewId: string
  try {
    reviewId = (await ensureDraftReview(sb, params.id, guard.actor.id)).id
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось создать черновик разбора' }, { status: 500 })
  }

  const { data: inserted, error } = await sb
    .from('expert_comments')
    .insert(
      kept.map((k) => ({
        client_id: params.id,
        author_id: guard.actor.id,
        block_key: toStoredBlockKey(k.block),
        text: k.text,
        status: 'draft',
        source: 'ai',
        ai_flags: k.flags,
        review_id: reviewId,
      })),
    )
    .select(COMMENT_COLUMNS)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить черновик ИИ' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'expert.review_ai_draft', entityType: 'expert_review', entityId: reviewId, targetUserId: params.id,
    metadata: {
      model,
      created: kept.length,
      flagged: kept.filter((k) => k.flags).length,
      dropped: dropped.length,
      missing: ctx.missing,
    },
  }, req)

  return NextResponse.json({
    ok: true,
    data: { reviewId, created: (inserted as unknown[] | null)?.length ?? kept.length, comments: inserted ?? [], dropped, missing: ctx.missing },
  })
}
