export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, zodMessage } from '@/lib/admin/point-a-expert'
import { createServiceClient } from '@/lib/supabase-service'
import { TEMPLATE_KEY_RE, TemplateContent, orderedBlocks } from '@/lib/point-a/template-schema'
import { enqueueTemplateRecalc, loadCompanyTemplates, loadTemplates } from '@/lib/point-a/template-impact'
import type { BlockTemplate } from '@/lib/point-a/v4/config'

/**
 * PUT    /api/giga-admin/point-a/templates/:key { title, industries[], blocks[7] }
 *        → update (version + 1). Every company that uses the template
 *        (explicitly or by industry, before or after the change) is
 *        recalculated.
 * DELETE /api/giga-admin/point-a/templates/:key → delete (not «default»).
 *        Companies that named it fall back to their industry's template
 *        (FK ON DELETE SET NULL) and are recalculated.
 * Right pointa.templates.
 */

export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  const g = await requireGiga(req, 'pointa.templates')
  if (g.response) return g.response
  const actor = g.actor
  if (!TEMPLATE_KEY_RE.test(params.key)) return badRequest('Шаблон не найден', 404)

  const parsed = TemplateContent.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(zodMessage(parsed.error.issues))
  const { title, industries } = parsed.data
  const blocks = orderedBlocks(parsed.data.blocks)

  const sb = createServiceClient()
  const cur = await sb.from('pa_templates').select('key, title, industries, blocks, version').eq('key', params.key).maybeSingle()
  if (cur.error) return badRequest('Не удалось загрузить шаблон', 500)
  const prev = cur.data as { key: string; title: string; industries: string[] | null; blocks: unknown; version: number } | null
  if (!prev) return badRequest('Шаблон не найден', 404)

  let before: BlockTemplate[] = []
  try { before = await loadTemplates(sb) } catch { before = [] }

  const version = (Number(prev.version) || 1) + 1
  const { error } = await sb
    .from('pa_templates')
    .update({ title, industries, blocks, version, updated_by: actor.id, updated_at: new Date().toISOString() })
    .eq('key', params.key)
  if (error) {
    console.error('[giga-admin/point-a/templates] update failed', error.code ?? '')
    return badRequest('Не удалось сохранить шаблон', 500)
  }

  await recordAdminAction(actor, {
    action: 'point_a.template_updated',
    entityType: 'pa_template', entityId: params.key,
    oldValue: { title: prev.title, industries: prev.industries ?? [], blocks: prev.blocks, version: prev.version },
    newValue: { title, industries, blocks, version },
  }, req)

  const next: BlockTemplate = { key: params.key, title, industries, blocks, version }
  const after = before.some((t) => t.key === params.key) ? before.map((t) => (t.key === params.key ? next : t)) : [...before, next]
  let recalc = { affected: 0, queued: 0, capped: false }
  try {
    recalc = await enqueueTemplateRecalc(await loadCompanyTemplates(sb), params.key, before, after)
  } catch (err) {
    console.error('[giga-admin/point-a/templates] recalculation not queued', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ ok: true, data: { key: params.key, version, recalc } })
}

export async function DELETE(req: NextRequest, { params }: { params: { key: string } }) {
  const g = await requireGiga(req, 'pointa.templates')
  if (g.response) return g.response
  const actor = g.actor
  if (params.key === 'default') return badRequest('Универсальный шаблон удалить нельзя — он нужен компаниям без отраслевого')
  if (!TEMPLATE_KEY_RE.test(params.key)) return badRequest('Шаблон не найден', 404)

  const sb = createServiceClient()
  let before: BlockTemplate[] = []
  let companies: Awaited<ReturnType<typeof loadCompanyTemplates>> = []
  try {
    // Read who uses it BEFORE the delete: the FK clears the explicit choice.
    ;[before, companies] = await Promise.all([loadTemplates(sb), loadCompanyTemplates(sb)])
  } catch (err) {
    console.error('[giga-admin/point-a/templates] usage read failed', err instanceof Error ? err.message : err)
  }

  const { data, error } = await sb.from('pa_templates').delete().eq('key', params.key).select('key, title, industries, blocks, version')
  if (error) {
    console.error('[giga-admin/point-a/templates] delete failed', error.code ?? '')
    return badRequest('Не удалось удалить шаблон', 500)
  }
  const old = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!old) return badRequest('Шаблон не найден', 404)

  await recordAdminAction(actor, {
    action: 'point_a.template_deleted',
    entityType: 'pa_template', entityId: params.key,
    oldValue: old,
  }, req)

  const recalc = await enqueueTemplateRecalc(companies, params.key, before, before.filter((t) => t.key !== params.key))
  return NextResponse.json({ ok: true, data: { key: params.key, recalc } })
}
