export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import {
  readMascotSettings,
  writeMascotSettings,
} from '@/lib/assistant/mascot/settings-server'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * GET  /api/v1/assistant/settings  — the caller's mascot settings.
 * PATCH /api/v1/assistant/settings — partial update (strict whitelist).
 *
 * Storage is profiles.preferences.assistant (migration-035 JSONB-bag
 * convention); sibling namespaces are never touched. Identity from the cookie
 * session only. Re-enabling the mascot clears any timed hide.
 */

const patchSchema = z
  .object({
    mascotEnabled: z.boolean().optional(),
    hintFrequency: z.enum(['normal', 'rare', 'off']).optional(),
    position: z.object({ corner: z.enum(['br', 'bl', 'tr', 'tl']) }).nullable().optional(),
    dismissedHints: z.array(z.string().max(64)).max(50).optional(),
    greeted: z.boolean().optional(),
    behavior: z
      .object({
        walking: z.boolean().optional(),
        sleep: z.boolean().optional(),
        aiInsights: z.boolean().optional(),
      })
      .strict()
      .optional(),
    character: z.enum(['cat', 'dog', 'capybara', 'owl']).optional(),
    tutorialDone: z.boolean().optional(),
  })
  .strict()

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (await isRateLimited(req, 'assistant:settings', { max: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  try {
    const settings = await readMascotSettings(sb, user.id)
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    console.error('[assistant/settings GET] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (await isRateLimited(req, 'assistant:settings:write', { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_input', details: parsed.error.issues[0]?.message },
      { status: 422 },
    )
  }

  try {
    const patch = { ...parsed.data }
    // Turning the mascot back on always clears a previous timed hide.
    if (patch.mascotEnabled === true) {
      ;(patch as Record<string, unknown>).hiddenUntil = null
    }
    const settings = await writeMascotSettings(sb, user.id, patch)
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    console.error('[assistant/settings PATCH] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
