export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { generatePointAInsights } from '@/lib/insights/ai-generator'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { getInsightModerationEnabled } from '@/lib/settings/system-settings'

// ---------------------------------------------------------------------------
// POST /api/v1/point-a/insights/ai-generate
//
// Invokes the AI generator over the caller's Point A snapshot, inserts 3-6
// rows into public.point_a_insights, and returns them.
// ---------------------------------------------------------------------------

async function resolveCompanyId(
  sb: ReturnType<typeof createServerClient>,
  userId: string
): Promise<string | null> {
  const { data } = await sb
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export async function POST() {
  if (!hasOpenRouterKey()) {
    return NextResponse.json(
      { ok: false, error: 'AI key not configured' },
      { status: 503 }
    )
  }

  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // Throttle this paid AI generation per user (audit 2026-07-02).
  if (await isRateLimitedKey(userId, 'point-a-insights-ai', { max: 6, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
  }

  const result = await generatePointAInsights(sb, userId)
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 502 }
    )
  }

  const companyId = await resolveCompanyId(sb, userId)

  // R2 (ТЗ §4.7): when the insight_moderation toggle is on (default), freshly
  // generated AI insights are NOT shown to the client — they enter the giga
  // panel review queue (visible_to_user = false) and appear in the feed only
  // after an expert publishes them. RLS (migration 060) hides unpublished rows
  // from the owner, so this flag is enforced at the database, not just here.
  const moderationOn = await getInsightModerationEnabled()

  // Map each AI item into a row. We treat predicted_answer as the AI's draft
  // answer (status = pending_confirmation so the client can accept/reject).
  const rows = result.items.map((item) => ({
    user_id: userId,
    company_id: companyId,
    type: 'ai',
    category: item.category,
    question_text: item.question_text,
    author_name: 'ИИ · аналитик',
    answer_text: item.predicted_answer,
    answer_author_name: 'ИИ · предположение',
    answer_author_role: 'ai',
    answered_at: new Date().toISOString(),
    status: 'pending_confirmation',
    visible_to_user: !moderationOn,
    source_meta: {
      model: result.meta.model,
      prompt_version: result.meta.prompt_version,
      confidence: item.confidence ?? null,
    },
  }))

  if (moderationOn) {
    // Plain insert, no RETURNING: the owner's SELECT policy (migration 060)
    // hides unpublished rows, so a returning select would come back empty and
    // returning the drafts in the response would leak them past the gate.
    const { error: insertErr } = await sb.from('point_a_insights').insert(rows)
    if (insertErr) {
      return NextResponse.json(
        { ok: false, error: 'Failed to persist generated insights' },
        { status: 500 }
      )
    }
    return NextResponse.json({
      ok: true,
      data: {
        items: [],
        meta: result.meta,
        generated: rows.length,
        pending_moderation: rows.length,
      },
    })
  }

  const { data: inserted, error: insertErr } = await sb
    .from('point_a_insights')
    .insert(rows)
    .select(
      'id, user_id, company_id, type, category, question_text, author_name, ' +
        'answer_text, answer_author_name, answer_author_role, answered_at, ' +
        'status, source_meta, created_at, updated_at'
    )

  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: 'Failed to persist generated insights' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: {
      items: inserted ?? [],
      meta: result.meta,
      generated: inserted?.length ?? 0,
      pending_moderation: 0,
    },
  })
}
