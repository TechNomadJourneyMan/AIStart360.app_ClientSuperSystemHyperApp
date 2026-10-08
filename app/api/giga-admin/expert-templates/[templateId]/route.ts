export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga, type GigaActor } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { UUID_RE } from '@/lib/expert-review/server'
import { TEMPLATE_COLUMNS, templatePatchSchema } from '@/lib/expert-review/templates'

/**
 * PUT    /api/giga-admin/expert-templates/:templateId { block?, title?, body?, is_shared? }
 * DELETE /api/giga-admin/expert-templates/:templateId
 *
 * Менять и удалять шаблон может его автор; общие шаблоны — ещё Admin и
 * Super Admin (модерация библиотеки).
 */

type Ctx = { params: { templateId: string } }
interface TemplateRow { id: string; block: string; title: string; body: string; created_by: string | null; is_shared: boolean }

function mayEdit(actor: GigaActor, t: TemplateRow): boolean {
  if (t.created_by === actor.id) return true
  return t.is_shared && (actor.role === 'super_admin' || actor.role === 'admin')
}

async function load(req: NextRequest, params: Ctx['params']) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return { response: guard.response }
  if (!UUID_RE.test(params.templateId)) return { response: NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 }) }
  const { data } = await createServiceClient()
    .from('expert_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('id', params.templateId)
    .maybeSingle()
  const t = data as TemplateRow | null
  // Чужой личный шаблон для остальных не существует.
  if (!t || (!t.is_shared && t.created_by !== guard.actor.id)) {
    return { response: NextResponse.json({ ok: false, error: 'Шаблон не найден' }, { status: 404 }) }
  }
  if (!mayEdit(guard.actor, t)) {
    return { response: NextResponse.json({ ok: false, error: 'Менять шаблон может только его автор' }, { status: 403 }) }
  }
  return { actor: guard.actor, t }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const g = await load(req, params)
  if (g.response) return g.response

  const parsed = templatePatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный шаблон' }, { status: 400 })
  }
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))

  const { data, error } = await createServiceClient()
    .from('expert_templates')
    .update(patch)
    .eq('id', g.t.id)
    .select(TEMPLATE_COLUMNS)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось сохранить шаблон' }, { status: 500 })

  await recordAdminAction(g.actor, {
    action: 'expert.template_updated', entityType: 'expert_template', entityId: g.t.id,
    oldValue: { block: g.t.block, title: g.t.title, is_shared: g.t.is_shared }, newValue: patch,
  }, req)
  return NextResponse.json({ ok: true, data: { ...(data as object), mine: g.t.created_by === g.actor.id } })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await load(req, params)
  if (g.response) return g.response

  const { error } = await createServiceClient().from('expert_templates').delete().eq('id', g.t.id)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось удалить шаблон' }, { status: 500 })

  await recordAdminAction(g.actor, {
    action: 'expert.template_deleted', entityType: 'expert_template', entityId: g.t.id,
    oldValue: { block: g.t.block, title: g.t.title, body: g.t.body },
  }, req)
  return NextResponse.json({ ok: true })
}
