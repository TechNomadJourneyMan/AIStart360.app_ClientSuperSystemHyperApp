export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { writeMascotSettings } from '@/lib/assistant/mascot/settings-server'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * POST /api/v1/assistant/hide — hide the mascot for a period (ТЗ §7 scenario 8).
 *
 * Body: { period: 'session' | '24h' | '7d' | 'forever' }.
 *   session → nothing persists server-side (the client hides until reload);
 *   24h/7d  → preferences.assistant.hiddenUntil = now + period;
 *   forever → preferences.assistant.mascotEnabled = false (re-enable in
 *             Settings › Ассистент).
 *
 * Always logs a mascot_hidden event (non-fatal). Returns { ok, hiddenUntil }.
 */

const bodySchema = z.object({ period: z.enum(['session', '24h', '7d', 'forever']) })

const PERIOD_MS: Record<'24h' | '7d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (await isRateLimited(req, 'assistant:hide', { max: 10, windowMs: 60_000 })) {
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
  const { period } = parsed.data

  try {
    let hiddenUntil: string | null = null
    if (period === '24h' || period === '7d') {
      hiddenUntil = new Date(Date.now() + PERIOD_MS[period]).toISOString()
      await writeMascotSettings(sb, user.id, { hiddenUntil })
    } else if (period === 'forever') {
      await writeMascotSettings(sb, user.id, { mascotEnabled: false, hiddenUntil: null })
    }
    // 'session' — client-side only; no server state.

    // Audit event (non-fatal — hiding must never fail on a logging hiccup).
    try {
      await sb.from('assistant_events').insert({
        user_id: user.id,
        type: 'mascot_hidden',
        meta: { period },
      })
    } catch (logErr) {
      console.error('[assistant/hide] event insert failed (non-fatal):', logErr)
    }

    return NextResponse.json({ ok: true, hiddenUntil })
  } catch (error) {
    console.error('[assistant/hide] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
