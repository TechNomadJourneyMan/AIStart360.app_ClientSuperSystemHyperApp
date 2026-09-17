export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { trackEventOnce } from '@/lib/events/track'
import { isRateLimitedKey } from '@/lib/rate-limit'

// Server-side draft of the full GRI test (migration 072). One row per user;
// RLS restricts every statement to the session user's own row.

const scoreMap = z.record(z.string().max(64), z.record(z.string().max(64), z.number().min(0).max(10)))
const draftSchema = z.object({
  onboarding: z.record(z.string().max(64), z.union([z.string().max(2000), z.number(), z.null()])).default({}),
  scores: scoreMap.default({}),
  completedSections: z.record(z.string().max(64), z.boolean()).default({}),
})

async function sessionUserId(sb: ReturnType<typeof createServerClient>): Promise<string | null> {
  const { data, error } = await sb.auth.getUser()
  return error || !data?.user ? null : data.user.id
}

export async function GET() {
  const sb = createServerClient()
  const userId = await sessionUserId(sb)
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data, error } = await sb
    .from('gri_assessment_drafts')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  // A missing table (072 not applied yet) reads as "no draft", not as an outage.
  if (error) return NextResponse.json({ ok: true, data: { draft: null } })
  return NextResponse.json({ ok: true, data: { draft: data ?? null } })
}

export async function PUT(req: NextRequest) {
  const sb = createServerClient()
  const userId = await sessionUserId(sb)
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (await isRateLimitedKey(userId, 'gri-draft', { max: 60, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }
  const parsed = draftSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid draft' }, { status: 400 })

  const { error } = await sb
    .from('gri_assessment_drafts')
    .upsert({ user_id: userId, state: parsed.data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ ok: false, error: 'Failed to save draft' }, { status: 500 })
  void trackEventOnce({ userId, name: 'GRI_STARTED', entityType: 'gri_draft' })
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const sb = createServerClient()
  const userId = await sessionUserId(sb)
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  await sb.from('gri_assessment_drafts').delete().eq('user_id', userId)
  return NextResponse.json({ ok: true })
}
