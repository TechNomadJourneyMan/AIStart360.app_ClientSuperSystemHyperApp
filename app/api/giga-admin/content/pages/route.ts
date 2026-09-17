export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import { slugify } from '@/lib/cms/blocks'
import { PAGE_COLUMNS } from '@/lib/cms/server'

// GET  /api/giga-admin/content/pages?status=&q= — all pages (any status).
// POST /api/giga-admin/content/pages { title, slug? } — new draft.
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'content.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  let q = createServiceClient().from('cms_pages').select(PAGE_COLUMNS).order('sort_order', { ascending: true }).order('updated_at', { ascending: false }).limit(500)
  const status = sp.get('status')
  if (status === 'draft' || status === 'published' || status === 'archived') q = q.eq('status', status)
  const search = (sp.get('q') ?? '').trim().replace(/[%,()]/g, '').slice(0, 80)
  if (search) q = q.or(`title.ilike.%${search}%,slug.ilike.%${search}%,category.ilike.%${search}%`)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить страницы' }, { status: 500 })
  return NextResponse.json({ ok: true, data: data ?? [] })
}

const createSchema = z.object({ title: z.string().trim().min(1, 'Введите заголовок').max(200), slug: z.string().trim().max(80).optional() })

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'content.edit')
  if (guard.response) return guard.response
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  const sb = createServiceClient()
  const baseSlug = slugify(parsed.data.slug || parsed.data.title)
  let slug = baseSlug
  for (let i = 2; i < 50; i++) {
    const { data } = await sb.from('cms_pages').select('id').eq('slug', slug).maybeSingle()
    if (!data) break
    slug = `${baseSlug}-${i}`.slice(0, 80)
  }
  const { data, error } = await sb
    .from('cms_pages')
    .insert({ title: parsed.data.title, slug, status: 'draft', created_by: guard.actor.id, updated_by: guard.actor.id })
    .select(PAGE_COLUMNS)
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось создать страницу' }, { status: 500 })
  await recordAdminAction(guard.actor, { action: 'content.page_created', entityType: 'cms_page', entityId: data.id, newValue: { title: data.title, slug } }, req)
  return NextResponse.json({ ok: true, data })
}
