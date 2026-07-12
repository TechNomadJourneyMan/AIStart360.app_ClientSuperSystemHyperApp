/**
 * POST /api/journey/chat
 *
 * One chat turn of the Journey experience. Client sends the running
 * message history + current journey state snapshot; server calls the
 * AI brain (lib/journey/ai.ts) and returns the envelope: reply text +
 * widget spawns + point A/B patches + milestones.
 *
 * Stateless by design for the lab phase — the client owns the state.
 * Persistence (Prisma JourneyState + Supabase Realtime) lands next.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runJourneyTurn } from '@/lib/journey/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const bodySchema = z.object({
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(8000),
  })).min(1).max(60),
  state: z.object({
    companyName: z.string().max(200).optional().default(''),
    industry: z.string().max(200).optional().default(''),
    pointA: z.array(z.any()).max(16).optional().default([]),
    pointB: z.array(z.any()).max(16).optional().default([]),
    milestones: z.array(z.any()).max(20).optional().default([]),
    widgets: z.array(z.any()).max(40).optional().default([]),
  }),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }

  const result = await runJourneyTurn({
    history: parsed.data.history,
    state: parsed.data.state as Parameters<typeof runJourneyTurn>[0]['state'],
  })

  if ('error' in result) {
    const status = result.error === 'no_api_key' ? 503 : 502
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }

  return NextResponse.json({ ok: true, data: result })
}
