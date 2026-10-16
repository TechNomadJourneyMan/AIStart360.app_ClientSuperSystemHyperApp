export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, zodMessage } from '@/lib/admin/point-a-expert'
import { createServiceClient } from '@/lib/supabase-service'
import { BLOCK_KEYS, BLOCK_LIBRARY, type BlockTemplate } from '@/lib/point-a/v4/config'
import { getMetricById } from '@/lib/metrics/registry'
import { TemplateCreate, orderedBlocks } from '@/lib/point-a/template-schema'
import { enqueueTemplateRecalc, loadCompanyTemplates, loadTemplates, templateUsage } from '@/lib/point-a/template-impact'
import { profanityResponse } from '@/lib/moderation/http'

/**
 * Industry templates of Point A (pa_templates) — GIGA-CRM «Шаблоны Точки А»,
 * right pointa.templates.
 *
 * GET  → { templates, library, usage }: the templates with how many companies
 *        use each (explicitly / by industry) and the block library (7 blocks:
 *        title, description, metrics).
 * POST { key, title, industries[], blocks[7] } → create. Companies whose
 *        industry now resolves to the new template are recalculated.
 */

export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'pointa.templates')
  if (g.response) return g.response
  const sb = createServiceClient()

  const { data, error } = await sb.from('pa_templates').select('key, title, industries, blocks, version, updated_at, updated_by').order('key', { ascending: true })
  if (error) {
    console.error('[giga-admin/point-a/templates] read failed', error.code ?? '')
    return badRequest('Не удалось загрузить шаблоны', 500)
  }
  const rows = (data ?? []) as Array<{ key: string; title: string; industries: string[] | null; blocks: unknown; version: number; updated_at: string | null; updated_by: string | null }>

  let usage: Record<string, { explicit: number; auto: number }> | null = null
  try {
    const [templates, companies] = await Promise.all([loadTemplates(sb), loadCompanyTemplates(sb)])
    usage = templateUsage(companies, templates)
  } catch (err) {
    console.error('[giga-admin/point-a/templates] usage failed', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({
    ok: true,
    data: {
      templates: rows
        .sort((a, b) => (a.key === 'default' ? -1 : b.key === 'default' ? 1 : a.title.localeCompare(b.title, 'ru')))
        .map((r) => ({
          key: r.key, title: r.title, industries: r.industries ?? [], blocks: Array.isArray(r.blocks) ? r.blocks : [],
          version: r.version, updatedAt: r.updated_at, usage: usage?.[r.key] ?? null,
        })),
      library: BLOCK_KEYS.map((k) => ({
        key: k,
        title: BLOCK_LIBRARY[k].title,
        description: BLOCK_LIBRARY[k].description,
        metrics: BLOCK_LIBRARY[k].metrics.map((id) => ({ id, label: getMetricById(id)?.label ?? id })),
      })),
    },
  })
}

export async function POST(req: NextRequest) {
  const g = await requireGiga(req, 'pointa.templates')
  if (g.response) return g.response
  const actor = g.actor

  const parsed = TemplateCreate.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(zodMessage(parsed.error.issues))
  const profane = profanityResponse({ title: parsed.data.title, industries: parsed.data.industries.join(', ') })
  if (profane) return profane
  const { key, title, industries } = parsed.data
  const blocks = orderedBlocks(parsed.data.blocks)

  const sb = createServiceClient()
  const exists = await sb.from('pa_templates').select('key').eq('key', key).maybeSingle()
  if (exists.error) return badRequest('Не удалось проверить ключ шаблона', 500)
  if (exists.data) return badRequest('Шаблон с таким ключом уже есть', 409)

  let before: BlockTemplate[] = []
  try { before = await loadTemplates(sb) } catch { before = [] }

  const { error } = await sb.from('pa_templates').insert({ key, title, industries, blocks, version: 1, updated_by: actor.id })
  if (error) {
    if (error.code === '23505') return badRequest('Шаблон с таким ключом уже есть', 409)
    console.error('[giga-admin/point-a/templates] insert failed', error.code ?? '')
    return badRequest('Не удалось создать шаблон', 500)
  }

  await recordAdminAction(actor, {
    action: 'point_a.template_created',
    entityType: 'pa_template', entityId: key,
    newValue: { key, title, industries, blocks },
  }, req)

  let recalc = { affected: 0, queued: 0, capped: false }
  try {
    const companies = await loadCompanyTemplates(sb)
    recalc = await enqueueTemplateRecalc(companies, key, before, [...before, { key, title, industries, blocks, version: 1 }])
  } catch (err) {
    console.error('[giga-admin/point-a/templates] recalculation not queued', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ ok: true, data: { key, recalc } })
}
