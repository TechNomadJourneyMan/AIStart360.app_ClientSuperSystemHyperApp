export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * POST /api/v1/assistant/events — mascot interaction events (ТЗ §15.4).
 *
 * Body: { events: [{ type, screen?, refId?, meta? }] } (≤20 per call).
 * Types are a closed vocabulary and meta is a strict numeric/flag whitelist —
 * free text is rejected at the schema so message contents can never leak into
 * the audit table. Inserts run under the session client (RLS owner-only).
 */

const eventTypeSchema = z.enum([
  'mascot_shown',
  'hint_shown',
  'hint_clicked',
  'hint_dismissed',
  'chat_opened',
  'message_sent',
  'answer_received',
  'mascot_minimized',
  'mascot_restored',
])

const metaSchema = z
  .object({
    latency_ms: z.number().int().min(0).max(600_000).optional(),
    insufficient: z.boolean().optional(),
    escalated: z.boolean().optional(),
    mode: z.enum(['script', 'free']).optional(),
    dismiss: z.enum(['close', 'mute_type']).optional(),
    source: z.enum(['avatar', 'bubble', 'badge', 'menu']).optional(),
  })
  .strict()

const bodySchema = z.object({
  events: z
    .array(
      z.object({
        type: eventTypeSchema,
        screen: z.string().trim().max(64).optional(),
        refId: z.string().trim().max(64).optional(),
        meta: metaSchema.optional(),
      }),
    )
    .min(1)
    .max(20),
})

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (await isRateLimited(req, 'assistant:events', { max: 30, windowMs: 60_000 })) {
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
    const rows = parsed.data.events.map((e) => ({
      user_id: user.id,
      type: e.type,
      screen: e.screen ?? null,
      ref_id: e.refId ?? null,
      meta: e.meta ?? {},
    }))
    const { error } = await sb.from('assistant_events').insert(rows)
    if (error) throw error
    return NextResponse.json({ ok: true, count: rows.length })
  } catch (error) {
    console.error('[assistant/events] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
