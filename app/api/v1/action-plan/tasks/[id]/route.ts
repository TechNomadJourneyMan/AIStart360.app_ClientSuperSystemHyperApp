export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/api-error'

/**
 * PATCH /api/v1/action-plan/tasks/[id]  { status?, snoozedUntil?, comment? }
 *   → { ok }
 *
 * Interactive 90-day plan (A4): toggle done, snooze, or comment on a task
 * (migration 049 columns). Cookie session; RLS on action_items scopes writes to
 * the owner (and staff). A 'done' stamps completed_at; un-done clears it.
 */
const patchSchema = z.object({
  status: z.enum(['todo', 'open', 'in_progress', 'done', 'snoozed', 'dropped']).optional(),
  snoozedUntil: z.string().date().nullable().optional(),
  comment: z.string().max(1000).nullable().optional(),
}).refine((v) => v.status !== undefined || v.snoozedUntil !== undefined || v.comment !== undefined, {
  message: 'Nothing to update',
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'action-plan-patch', { max: 60, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто. Попробуйте позже.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid update' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.status !== undefined) {
    patch.status = parsed.data.status
    patch.completed_at = parsed.data.status === 'done' ? new Date().toISOString() : null
  }
  if (parsed.data.snoozedUntil !== undefined) patch.snoozed_until = parsed.data.snoozedUntil
  if (parsed.data.comment !== undefined) patch.user_comment = parsed.data.comment

  // Scope to the owner explicitly (belt-and-suspenders on top of RLS).
  const { data, error } = await sb
    .from('action_items')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
