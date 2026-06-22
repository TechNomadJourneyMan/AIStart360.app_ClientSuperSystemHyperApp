export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { answerUserQuestion } from '@/lib/assistant/answer'
import { createExpertCase } from '@/lib/assistant/escalation/adapter'
import { localeFromRequestCookie } from '@/lib/i18n/locale'

/**
 * POST /api/v1/assistant/ask
 * Body: { question: string }
 *
 * Free-text Q&A for the assistant panel. Answers the user's question about THEIR
 * business over the curated AssistantContext snapshot for the CURRENT
 * authenticated user (cookie session — never a user_id param, IDOR-safe per
 * point-b/route.ts). Anti-hallucination is enforced inside answerUserQuestion():
 * it answers ONLY from the snapshot and self-reports when it can't.
 *
 * Expert fallback: if the model returns null (no key / failure), or refuses
 * (!can_answer), or asks for a human (needs_expert), or is unsure
 * (confidence==='low') — we open an ExpertCase (trigger 'user_requested_help')
 * carrying the user's question, and respond { escalated: true }. Otherwise we
 * return the grounded answer { escalated: false }.
 *
 * Response: { ok, escalated, answer }.
 */

const bodySchema = z.object({
  question: z.string().trim().min(1, 'Empty question').max(1000, 'Question too long'),
})

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
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
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid question' },
      { status: 400 },
    )
  }
  const question = parsed.data.question

  try {
    const locale = localeFromRequestCookie(req)
    const ctx = await buildAssistantContext(user.id, sb)
    const result = await answerUserQuestion(ctx, question, locale)

    // Escalate when the model can't/shouldn't answer from the data.
    const mustEscalate =
      result == null ||
      !result.can_answer ||
      result.needs_expert ||
      result.confidence === 'low'

    if (mustEscalate) {
      await createExpertCase(ctx, {
        triggerType: 'user_requested_help',
        userMessage: question,
        assistantRecommendation: result?.answer || undefined,
      })
      return NextResponse.json({
        ok: true,
        escalated: true,
        answer: result?.answer ?? null,
      })
    }

    return NextResponse.json({
      ok: true,
      escalated: false,
      answer: result.answer,
    })
  } catch (error) {
    console.error('[assistant/ask] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
