export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionRole, isStaffRole } from '@/lib/api-identity'

const ALLOWED_STATUS = [
  'pending_ai',
  'pending_confirmation',
  'awaiting_answer',
  'confirmed',
  'rejected',
] as const

const ALLOWED_ANSWER_ROLES = ['ai', 'expert', 'client', 'admin'] as const

const patchBodySchema = z
  .object({
    status: z.enum(ALLOWED_STATUS).optional(),
    answer_text: z.string().min(1).max(4000).nullable().optional(),
    answer_author_name: z.string().max(120).nullable().optional(),
    answer_author_role: z.enum(ALLOWED_ANSWER_ROLES).nullable().optional(),
    category: z.string().min(1).max(64).optional(),
    question_text: z.string().min(4).max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  })

const idParamSchema = z.string().uuid()

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
}

function notFound() {
  return NextResponse.json({ ok: false, error: 'Insight not found' }, { status: 404 })
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/point-a/insights/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } }
) {
  const parsedId = idParamSchema.safeParse(ctx.params.id)
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 })
  }
  const id = parsedId.data

  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) return unauthorized()

  const rawBody = await req.json().catch(() => null)
  const parsed = patchBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request body' },
      { status: 400 }
    )
  }
  const body = parsed.data

  // SECURITY: `answer_author_role` is provenance shown to the client as "кто
  // ответил". It must reflect the CALLER's real role, not whatever the request
  // body claims — previously a client could label their own answer as
  // 'expert'/'admin'. Privileged labels now require a staff profile role; a
  // non-staff caller writing an answer is always attributed as 'client'.
  if (
    body.answer_author_role !== undefined &&
    body.answer_author_role !== null &&
    body.answer_author_role !== 'client'
  ) {
    const callerRole = await getSessionRole(sb, userData.user.id)
    if (!isStaffRole(callerRole)) {
      if (body.answer_text !== undefined) {
        body.answer_author_role = 'client'
      } else {
        return NextResponse.json(
          { ok: false, error: 'forbidden_author_role' },
          { status: 403 }
        )
      }
    }
  }

  // Load existing row so we can decide whether to bump answered_at. RLS will
  // hide rows the caller can't see (returns null instead of error).
  const { data: existing, error: loadErr } = await sb
    .from('point_a_insights')
    .select('id, answer_text')
    .eq('id', id)
    .maybeSingle()

  if (loadErr) {
    return NextResponse.json(
      { ok: false, error: 'Failed to load insight' },
      { status: 500 }
    )
  }
  if (!existing) return notFound()

  const update: Record<string, unknown> = {}
  if (body.status !== undefined) update.status = body.status
  if (body.answer_text !== undefined) update.answer_text = body.answer_text
  if (body.answer_author_name !== undefined)
    update.answer_author_name = body.answer_author_name
  if (body.answer_author_role !== undefined)
    update.answer_author_role = body.answer_author_role
  if (body.category !== undefined) update.category = body.category
  if (body.question_text !== undefined) update.question_text = body.question_text

  // answered_at flips when answer_text *transitions* (previously empty/null →
  // now non-empty). We don't touch it when the answer is cleared or unchanged.
  const previousAnswer =
    typeof existing.answer_text === 'string' ? existing.answer_text.trim() : ''
  const incomingAnswer =
    typeof body.answer_text === 'string' ? body.answer_text.trim() : null

  if (incomingAnswer !== null && incomingAnswer.length > 0 && previousAnswer.length === 0) {
    update.answered_at = new Date().toISOString()
  }

  const { data: updated, error: updateErr } = await sb
    .from('point_a_insights')
    .update(update)
    .eq('id', id)
    .select(
      'id, user_id, company_id, type, category, question_text, author_name, ' +
        'answer_text, answer_author_name, answer_author_role, answered_at, ' +
        'status, source_meta, created_at, updated_at'
    )
    .maybeSingle()

  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: 'Failed to update insight' },
      { status: 500 }
    )
  }
  if (!updated) return notFound()

  return NextResponse.json({ ok: true, data: updated })
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/point-a/insights/[id]
// (Convenience for the UI; RLS restricts to row owner.)
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  ctx: { params: { id: string } }
) {
  const parsedId = idParamSchema.safeParse(ctx.params.id)
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 })
  }
  const id = parsedId.data

  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) return unauthorized()

  const { error: deleteErr } = await sb
    .from('point_a_insights')
    .delete()
    .eq('id', id)

  if (deleteErr) {
    return NextResponse.json(
      { ok: false, error: 'Failed to delete insight' },
      { status: 500 }
    )
  }
  return NextResponse.json({ ok: true, data: { id } })
}
