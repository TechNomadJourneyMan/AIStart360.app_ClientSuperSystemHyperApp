export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import { hasPermission } from '@/lib/admin/rbac'
import { pageSaveSchema } from '@/lib/cms/blocks'
import { loadPageWithBlocks, PAGE_COLUMNS } from '@/lib/cms/server'

// GET    /api/giga-admin/content/pages/:id — page, blocks, revision history.
// PUT    /api/giga-admin/content/pages/:id { page, blocks, expectedVersion }
//        — save; optimistic locking by version (two editors cannot silently
//        overwrite each other). Editing a PUBLISHED page changes live content,
//        so it needs content.publish.
// DELETE /api/giga-admin/content/pages/:id { confirm } — only drafts / archived.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'content.view')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const loaded = await loadPageWithBlocks({ id: params.id })
  if (!loaded) return NextResponse.json({ ok: false, error: 'Страница не найдена' }, { status: 404 })
  const { data: revisions } = await createServiceClient()
    .from('cms_page_revisions')
    .select('id, version, status, created_by, created_at, snapshot')
    .eq('page_id', params.id)
    .order('created_at', { ascending: false })
    .limit(30)
  return NextResponse.json({ ok: true, data: { ...loaded, revisions: revisions ?? [] } })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'content.edit')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const parsed = pageSaveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return NextResponse.json({ ok: false, error: i ? `${i.message}${i.path.length ? ` (${i.path.join('.')})` : ''}` : 'Неверные данные' }, { status: 400 })
  }
  const { page, blocks, expectedVersion } = parsed.data
  const current = await loadPageWithBlocks({ id: params.id })
  if (!current) return NextResponse.json({ ok: false, error: 'Страница не найдена' }, { status: 404 })
  if (current.page.status === 'published' && !hasPermission(guard.actor.role, 'content.publish')) {
    return NextResponse.json({ ok: false, error: 'Опубликованную страницу может менять только роль с правом публикации' }, { status: 403 })
  }
  if (current.page.version !== expectedVersion) {
    return NextResponse.json({ ok: false, error: 'Страницу уже изменил другой сотрудник. Обновите редактор, чтобы не потерять чужие правки.', conflict: true, version: current.page.version }, { status: 409 })
  }

  const sb = createServiceClient()
  if (page.slug !== current.page.slug) {
    const { data: taken } = await sb.from('cms_pages').select('id').eq('slug', page.slug).neq('id', params.id).maybeSingle()
    if (taken) return NextResponse.json({ ok: false, error: 'Такой адрес уже занят' }, { status: 409 })
  }

  // Snapshot of the previous state → revision history (restorable from the editor).
  await sb.from('cms_page_revisions').insert({
    page_id: params.id,
    version: current.page.version,
    status: current.page.status,
    snapshot: { page: current.page, blocks: current.blocks },
    created_by: guard.actor.id,
  })

  const nextVersion = current.page.version + 1
  const { data: updated, error: upErr } = await sb
    .from('cms_pages')
    .update({
      ...page,
      summary: page.summary || null,
      category: page.category || null,
      icon: page.icon || null,
      cover_url: page.cover_url || null,
      version: nextVersion,
      updated_by: guard.actor.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('version', expectedVersion)
    .select(PAGE_COLUMNS)
  if (upErr) return NextResponse.json({ ok: false, error: 'Не удалось сохранить страницу' }, { status: 500 })
  if (!updated?.length) return NextResponse.json({ ok: false, error: 'Страницу только что изменили — обновите редактор.', conflict: true }, { status: 409 })

  const del = await sb.from('cms_blocks').delete().eq('page_id', params.id)
  if (del.error) return NextResponse.json({ ok: false, error: 'Не удалось обновить блоки' }, { status: 500 })
  if (blocks.length) {
    const ins = await sb.from('cms_blocks').insert(blocks.map((b, i) => ({
      page_id: params.id,
      type: b.type,
      content: b.content,
      sort_order: i,
      hidden: b.hidden,
      visibility: b.visibility ?? null,
    })))
    if (ins.error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить блоки' }, { status: 500 })
  }

  await recordAdminAction(guard.actor, {
    action: 'content.page_updated',
    entityType: 'cms_page',
    entityId: params.id,
    oldValue: { title: current.page.title, slug: current.page.slug, visibility: current.page.visibility, blocks: current.blocks.length, version: current.page.version },
    newValue: { title: page.title, slug: page.slug, visibility: page.visibility, blocks: blocks.length, version: nextVersion },
    metadata: { status: current.page.status },
  }, req)

  return NextResponse.json({ ok: true, data: updated[0] })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'content.publish')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const current = await loadPageWithBlocks({ id: params.id })
  if (!current) return NextResponse.json({ ok: false, error: 'Страница не найдена' }, { status: 404 })
  if (current.page.status === 'published') {
    return NextResponse.json({ ok: false, error: 'Сначала снимите страницу с публикации или отправьте в архив' }, { status: 409 })
  }
  await recordAdminAction(guard.actor, {
    action: 'content.page_deleted', entityType: 'cms_page', entityId: params.id,
    oldValue: current, newValue: null,
  }, req, { required: true })
  const { error } = await createServiceClient().from('cms_pages').delete().eq('id', params.id)
  if (error) {
    // Журнал неизменяемый и уже говорит «удалена» — фиксируем, что удаления не было.
    await recordAdminAction(guard.actor, {
      action: 'content.page_delete_failed', entityType: 'cms_page', entityId: params.id,
      metadata: { error: error.message.slice(0, 300) },
    }, req).catch(() => false)
    return NextResponse.json({ ok: false, error: 'Не удалось удалить страницу' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
