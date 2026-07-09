export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/api-error'

/**
 * POST /api/v1/nba/event  { key, event } → { ok }
 *
 * Records an NBA interaction (shown/done/dismissed/why_opened/explained) for
 * cooldowns + activation metrics. A 'done' on a plan-task action also closes the
 * underlying action_items row so NBA and the 90-day plan stay in sync.
 * Cookie session only; user id from the session (IDOR-safe), RLS scopes writes.
 */
const schema = z.object({
  key: z.string().trim().min(1).max(120),
  event: z.enum(['shown', 'done', 'dismissed', 'why_opened', 'explained']),
})

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'nba-event', { max: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто. Попробуйте позже.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid event' }, { status: 400 })
  }
  const { key, event } = parsed.data

  const { error } = await sb.from('nba_log').insert({ user_id: user.id, action_key: key, event })
  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })

  // Completing a plan-task NBA closes the linked plan item too.
  if (event === 'done' && key.startsWith('plan_task:')) {
    const taskId = key.slice('plan_task:'.length)
    try {
      await sb
        .from('action_items')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('user_id', user.id)
    } catch { /* action_items may not have completed_at until migration 049 — status still set */ }
  }

  return NextResponse.json({ ok: true })
}
