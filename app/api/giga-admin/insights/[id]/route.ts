export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const patchSchema = z
  .object({
    action: z.enum(['publish', 'reject', 'edit']),
    question_text: z.string().min(4).max(2000).optional(),
    answer_text: z.string().min(1).max(4000).optional(),
    reason: z.string().max(1000).optional(),
  })
  .refine(
    (v) => v.action !== 'edit' || v.question_text !== undefined || v.answer_text !== undefined,
    { message: 'edit requires question_text or answer_text' }
  )

/**
 * PATCH /api/giga-admin/insights/[id] — moderation decisions (R2, ТЗ §5.5).
 *
 *   publish — the expert approves: visible_to_user = true (+published stamp),
 *             the insight appears in the client feed;
 *   reject  — status = 'rejected', stays hidden from the client;
 *   edit    — the expert rewrites the text BEFORE publishing (edit + publish
 *             are separate calls so every text change is audited on its own).
 *
 * Every action writes an audit entry with the real actor and a before/after
 * diff of the touched fields.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 422 })
  }
  const body = parsed.data

  try {
    const svc = createServiceClient()

    const { data: existing, error: loadErr } = await svc
      .from('point_a_insights')
      .select('id, user_id, type, status, question_text, answer_text, visible_to_user')
      .eq('id', params.id)
      .maybeSingle()
    if (loadErr) {
      if (/visible_to_user/.test(loadErr.message)) {
        return NextResponse.json({ ok: false, error: 'migration_060_required' }, { status: 503 })
      }
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const update: Record<string, unknown> = {}
    let auditAction = 'insight.edited'

    if (body.action === 'publish') {
      update.visible_to_user = true
      update.published_at = new Date().toISOString()
      update.published_by = actor.id
      auditAction = 'insight.published'
    } else if (body.action === 'reject') {
      update.status = 'rejected'
      update.visible_to_user = false
      auditAction = 'insight.rejected'
    } else {
      if (body.question_text !== undefined) update.question_text = body.question_text
      if (body.answer_text !== undefined) {
        update.answer_text = body.answer_text
        // The expert took authorship of the answer text.
        update.answer_author_role = 'expert'
        update.answer_author_name = actor.email ?? 'Эксперт AIStart360'
      }
    }

    const { data: updated, error: updErr } = await svc
      .from('point_a_insights')
      .update(update)
      .eq('id', params.id)
      .select(
        'id, user_id, type, category, question_text, answer_text, status, ' +
          'visible_to_user, published_at, published_by, source_meta, created_at'
      )
      .maybeSingle()
    if (updErr || !updated) {
      return NextResponse.json({ error: 'update_failed' }, { status: 500 })
    }

    await logAudit({
      entityType: 'user',
      entityId: existing.user_id as string,
      action: auditAction,
      performedBy: actor.id,
      diff: {
        insightId: params.id,
        before: {
          status: existing.status,
          visible_to_user: existing.visible_to_user,
          ...(body.action === 'edit'
            ? { question_text: existing.question_text, answer_text: existing.answer_text }
            : {}),
        },
        after: update,
        ...(body.reason ? { reason: body.reason } : {}),
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ ok: true, item: updated })
  } catch (e) {
    console.error('[giga-admin/insights/:id] error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
