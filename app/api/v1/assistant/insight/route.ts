export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { buildScreenInsight } from '@/lib/assistant/mascot/insight'
import { readMascotSettings } from '@/lib/assistant/mascot/settings-server'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * POST /api/v1/assistant/insight — one AI insight for the current screen.
 *
 * The only LLM call the proactive mascot makes (bubble catalog stays
 * deterministic). Guarded accordingly: 6/hour rate limit, disabled when the
 * user switched AI insights off, and the answer passes the output filter
 * inside buildScreenInsight. Body: { screen }. Returns { ok, insight | null }.
 */

const bodySchema = z.object({ screen: z.string().trim().min(1).max(64) })

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (await isRateLimited(req, 'assistant:insight', { max: 6, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 422 })
  }

  try {
    const settings = await readMascotSettings(sb, user.id)
    if (!settings.behavior.aiInsights) {
      return NextResponse.json({ ok: false, error: 'insights_disabled' }, { status: 403 })
    }

    const locale = localeFromRequestCookie(req)
    const ctx = await buildAssistantContext(user.id, sb)
    const started = Date.now()
    const insight = await buildScreenInsight(ctx, parsed.data.screen, locale, settings.character)

    // Audit (non-fatal, no texts — Langfuse holds the trace).
    try {
      await sb.from('assistant_events').insert({
        user_id: user.id,
        type: 'answer_received',
        screen: parsed.data.screen,
        ref_id: 'ai_insight',
        meta: { latency_ms: Date.now() - started, insufficient: !insight, mode: 'free' },
      })
    } catch (logErr) {
      console.error('[assistant/insight] event insert failed (non-fatal):', logErr)
    }

    if (!insight) {
      return NextResponse.json({ ok: true, insight: null })
    }
    return NextResponse.json({ ok: true, insight: insight.text })
  } catch (error) {
    console.error('[assistant/insight] error:', error)
    return NextResponse.json({ ok: false, error: 'ai_unavailable' }, { status: 502 })
  }
}
