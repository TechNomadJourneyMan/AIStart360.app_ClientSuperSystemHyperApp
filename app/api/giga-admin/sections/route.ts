export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import { loadSections } from '@/lib/platform/sections'
import { visibilitySchema } from '@/lib/platform/visibility'

// GET /api/giga-admin/sections — built-in cabinet sections.
// PUT /api/giga-admin/sections { sections: [{ key, title, description, enabled, visibility, sort_order }] }
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'platform.sections')
  if (guard.response) return guard.response
  return NextResponse.json({ ok: true, data: await loadSections() })
}

const itemSchema = z.object({
  key: z.string().regex(/^[a-z_]{2,40}$/),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).nullish(),
  enabled: z.boolean(),
  visibility: visibilitySchema,
  sort_order: z.number().int().min(0).max(10_000),
})
const schema = z.object({ sections: z.array(itemSchema).min(1).max(50) })

export async function PUT(req: NextRequest) {
  const guard = await requireGiga(req, 'platform.sections')
  if (guard.response) return guard.response
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })

  const current = new Map((await loadSections()).map((s) => [s.key, s]))
  const sb = createServiceClient()
  const changed: string[] = []
  for (const s of parsed.data.sections) {
    const before = current.get(s.key)
    if (!before) return NextResponse.json({ ok: false, error: `Неизвестный раздел: ${s.key}` }, { status: 400 })
    const same = before.title === s.title && (before.description ?? '') === (s.description ?? '') && before.enabled === s.enabled
      && before.sort_order === s.sort_order && JSON.stringify(before.visibility) === JSON.stringify(s.visibility)
    if (same) continue
    await recordAdminAction(guard.actor, {
      action: 'platform.section_updated', entityType: 'platform_section', entityId: s.key,
      oldValue: { title: before.title, enabled: before.enabled, visibility: before.visibility, sort_order: before.sort_order },
      newValue: { title: s.title, enabled: s.enabled, visibility: s.visibility, sort_order: s.sort_order },
    }, req, { required: true })
    const { error } = await sb.from('platform_sections').update({
      title: s.title, description: s.description ?? null, enabled: s.enabled, visibility: s.visibility, sort_order: s.sort_order,
      updated_by: guard.actor.id, updated_at: new Date().toISOString(),
    }).eq('key', s.key)
    if (error) return NextResponse.json({ ok: false, error: `Не удалось сохранить «${s.title}»` }, { status: 500 })
    changed.push(s.key)
  }
  return NextResponse.json({ ok: true, changed, note: 'Изменения видны пользователям в течение минуты' })
}
