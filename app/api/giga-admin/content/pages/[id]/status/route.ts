export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import { loadPageWithBlocks, PAGE_COLUMNS } from '@/lib/cms/server'

// POST /api/giga-admin/content/pages/:id/status { status } — Draft ⇄ Published ⇄ Archived.
const schema = z.object({ status: z.enum(['draft', 'published', 'archived']) })
const ACTION = { published: 'content.page_published', draft: 'content.page_unpublished', archived: 'content.page_archived' } as const

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'content.publish')
  if (guard.response) return guard.response
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный статус' }, { status: 400 })
  const current = await loadPageWithBlocks({ id: params.id })
  if (!current) return NextResponse.json({ ok: false, error: 'Страница не найдена' }, { status: 404 })
  const next = parsed.data.status
  if (current.page.status === next) return NextResponse.json({ ok: true, data: current.page })
  if (next === 'published' && current.blocks.length === 0) {
    return NextResponse.json({ ok: false, error: 'Нельзя опубликовать пустую страницу' }, { status: 409 })
  }
  const sb = createServiceClient()
  const { data, error } = await sb
    .from('cms_pages')
    .update({
      status: next,
      published_at: next === 'published' ? new Date().toISOString() : current.page.published_at,
      updated_by: guard.actor.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select(PAGE_COLUMNS)
    .single()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось изменить статус' }, { status: 500 })
  await recordAdminAction(guard.actor, {
    action: ACTION[next], entityType: 'cms_page', entityId: params.id,
    oldValue: { status: current.page.status }, newValue: { status: next }, metadata: { title: current.page.title, slug: current.page.slug },
  }, req)
  return NextResponse.json({ ok: true, data })
}
