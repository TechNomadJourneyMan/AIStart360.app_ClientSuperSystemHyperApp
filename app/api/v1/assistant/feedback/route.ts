export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { maskPii } from '@/lib/assistant/mascot/sanitize'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * POST /api/v1/assistant/feedback — rate an assistant answer or a hint.
 *
 * Body: { target: 'message'|'hint', targetId: string, rating: 'up'|'down',
 *         comment?: string ≤500 }.
 *
 * Lands in assistant_events (type='feedback'). The optional comment is the one
 * deliberate exception to the «no free text in events» rule — it is explicit
 * product feedback volunteered by the user; it is PII-masked before insert.
 */

const bodySchema = z.object({
  target: z.enum(['message', 'hint']),
  targetId: z.string().trim().min(1).max(64),
  rating: z.enum(['up', 'down']),
  comment: z.string().trim().max(500).optional(),
})

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (await isRateLimited(req, 'assistant:feedback', { max: 10, windowMs: 60_000 })) {
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
  const { target, targetId, rating, comment } = parsed.data

  try {
    const { error } = await sb.from('assistant_events').insert({
      user_id: user.id,
      type: 'feedback',
      ref_id: targetId,
      meta: {
        target,
        rating,
        ...(comment ? { comment: maskPii(comment) } : {}),
      },
    })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[assistant/feedback] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
