export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isReviewBlockKey, reviewBlockLabel } from '@/lib/expert-review/blocks'
import { TEMPLATE_COLUMNS, templateBlockFilter, templateBodySchema } from '@/lib/expert-review/templates'

/**
 * GET  /api/giga-admin/expert-templates?block=<key> — шаблоны эксперта:
 *      общие (is_shared) и свои личные. С `block` — шаблоны этого блока плюс
 *      универсальные («Общее»).
 * POST /api/giga-admin/expert-templates { block, title, body, is_shared? }
 *
 * Доступ — `clients.review` (Super Admin, Admin, SuperExpert).
 */

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response

  const block = req.nextUrl.searchParams.get('block')
  if (block && !isReviewBlockKey(block)) return NextResponse.json({ ok: false, error: 'Неизвестный блок' }, { status: 400 })

  let q = createServiceClient()
    .from('expert_templates')
    .select(TEMPLATE_COLUMNS)
    .or(`is_shared.eq.true,created_by.eq.${guard.actor.id}`)
  if (block) q = q.in('block', templateBlockFilter(block))
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(200)
  if (error) {
    console.warn('[giga-admin/expert-templates]', error.message)
    return NextResponse.json({ ok: true, data: [], unavailable: true })
  }
  const rows = (data as Array<{ block: string; created_by: string | null }> | null) ?? []
  return NextResponse.json({
    ok: true,
    data: rows.map((t) => ({ ...t, block_label: reviewBlockLabel(t.block === 'general' ? null : t.block), mine: t.created_by === guard.actor.id })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response

  const parsed = templateBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный шаблон' }, { status: 400 })
  }
  const block = parsed.data.block

  const { data, error } = await createServiceClient()
    .from('expert_templates')
    .insert({
      block,
      title: parsed.data.title,
      body: parsed.data.body,
      is_shared: parsed.data.is_shared ?? true,
      created_by: guard.actor.id,
    })
    .select(TEMPLATE_COLUMNS)
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось сохранить шаблон' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'expert.template_created', entityType: 'expert_template', entityId: (data as { id: string }).id,
    metadata: { block, title: parsed.data.title, shared: parsed.data.is_shared ?? true },
  }, req)

  return NextResponse.json({ ok: true, data: { ...(data as object), mine: true } })
}
