export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { converseWithGree, HISTORY_LIMITS } from '@/lib/assistant/gree-chat'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * POST /api/v1/assistant/converse — a multi-turn chat turn with «Гри».
 *
 * Body: { message, history?: [{role:'user'|'assistant', content}], screen? }.
 * The history is CLIENT-side session memory only (nothing persists server-side);
 * the server re-sanitizes it (PII mask + budget trim) before it may touch a
 * prompt. Facts come exclusively from the caller's own curated snapshot —
 * identity from the cookie session, never from the body (IDOR-safe).
 *
 * Response: { ok, answer, needs_expert, on_topic }. A null model result maps
 * to { answer: null, needs_expert: true } so the UI offers the human expert
 * instead of inventing anything.
 */

const bodySchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(HISTORY_LIMITS.maxTurnChars),
      }),
    )
    .max(HISTORY_LIMITS.maxTurns)
    .optional()
    .default([]),
  screen: z.string().trim().max(64).optional(),
})

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (await isRateLimited(req, 'assistant:converse', { max: 10, windowMs: 60_000 })) {
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
    return NextResponse.json(
      { ok: false, error: 'invalid_input', details: parsed.error.issues[0]?.message },
      { status: 422 },
    )
  }
  const { message, history, screen } = parsed.data

  try {
    const locale = localeFromRequestCookie(req)
    const ctx = await buildAssistantContext(user.id, sb)
    const started = Date.now()
    const turn = await converseWithGree(ctx, history, message, locale)

    // Audit without texts (Langfuse holds the trace).
    try {
      await sb.from('assistant_events').insert({
        user_id: user.id,
        type: 'answer_received',
        screen: screen ?? null,
        ref_id: 'gree_chat',
        meta: {
          latency_ms: Date.now() - started,
          insufficient: !turn,
          escalated: turn?.needs_expert ?? true,
          mode: 'free',
        },
      })
    } catch (logErr) {
      console.error('[assistant/converse] event insert failed (non-fatal):', logErr)
    }

    if (!turn) {
      return NextResponse.json({ ok: true, answer: null, needs_expert: true, on_topic: true })
    }
    return NextResponse.json({
      ok: true,
      answer: turn.answer,
      needs_expert: turn.needs_expert,
      on_topic: turn.on_topic,
    })
  } catch (error) {
    console.error('[assistant/converse] error:', error)
    return NextResponse.json({ ok: false, error: 'ai_unavailable' }, { status: 502 })
  }
}
