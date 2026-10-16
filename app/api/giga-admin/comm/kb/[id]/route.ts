export const dynamic = 'force-dynamic'
// Publishing computes an embedding (one provider call, 20 s timeout).
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { commError, guardComm } from '@/lib/comm/admin'
import {
  assertCleanArticle, embedArticle, embeddedIds, KB_COLUMNS, KbArticlePatch, kbDTO, normalizeTags, profanityResponseBody,
  type KbArticleRow,
} from '@/lib/comm/kb'
import { ProfanityError } from '@/lib/moderation/profanity'

/**
 * One article of GIGA «База знаний бота» (inbox.manage).
 *
 * GET    /api/giga-admin/comm/kb/:id — with the text.
 * PATCH  /api/giga-admin/comm/kb/:id { title?, body?, tags?, status? }
 *        a changed text clears the embedding; a published article (published
 *        now or edited while published) gets a fresh one. 'draft' hides it from
 *        the bot at once. Profanity → 400 { error, field }.
 * DELETE /api/giga-admin/comm/kb/:id — the bot stops using it at once.
 * Audit: comm.kb.updated / comm.kb.published / comm.kb.unpublished / comm.kb.deleted.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: { id: string } }

async function loadArticle(sb: NonNullable<Awaited<ReturnType<typeof guardComm>>['sb']>, id: string): Promise<KbArticleRow | null> {
  const { data, error } = await sb.from('kb_articles').select(KB_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as KbArticleRow | null) ?? null
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return commError('Неверный идентификатор')
  try {
    const article = await loadArticle(g.sb, params.id)
    if (!article) return commError('Статья не найдена', 404)
    const semantic = await embeddedIds(g.sb, [article.id])
    return NextResponse.json({ ok: true, data: kbDTO(article, semantic.has(article.id), true) })
  } catch (err) {
    console.error('[giga-admin/comm/kb/:id]', err instanceof Error ? err.message : err)
    return commError('Не удалось загрузить статью', 500)
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return commError('Неверный идентификатор')
  const parsed = KbArticlePatch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return commError(parsed.error.issues[0]?.message ?? 'Неверный запрос')
  const p = { ...parsed.data, ...(parsed.data.tags ? { tags: normalizeTags(parsed.data.tags) } : {}) }
  try {
    assertCleanArticle({ title: p.title, body: p.body, tags: p.tags })
  } catch (err) {
    if (err instanceof ProfanityError) return NextResponse.json(profanityResponseBody(err), { status: 400 })
    throw err
  }

  try {
    const before = await loadArticle(g.sb, params.id)
    if (!before) return commError('Статья не найдена', 404)
    const textChanged = (p.title !== undefined && p.title !== before.title)
      || (p.body !== undefined && p.body !== before.body)
      || (p.tags !== undefined && p.tags.join('\u0000') !== (before.tags ?? []).join('\u0000'))
    const patch: Record<string, unknown> = { ...p, updated_by: g.actor.id }
    if (textChanged) patch.embedding = null
    const { data, error } = await g.sb.from('kb_articles').update(patch).eq('id', before.id).select(KB_COLUMNS).maybeSingle()
    if (error || !data) throw new Error(error?.message ?? 'no row')
    const after = data as KbArticleRow

    let semantic = !textChanged && (await embeddedIds(g.sb, [after.id])).has(after.id)
    if (after.status === 'published' && !semantic) semantic = await embedArticle(g.sb, after)

    const action = before.status !== after.status
      ? (after.status === 'published' ? 'comm.kb.published' : 'comm.kb.unpublished')
      : 'comm.kb.updated'
    await recordAdminAction(g.actor, {
      action, entityType: 'kb_article', entityId: after.id,
      oldValue: { title: before.title, status: before.status, tags: before.tags, length: before.body.length },
      newValue: { title: after.title, status: after.status, tags: after.tags, length: after.body.length },
    }, req)
    return NextResponse.json({ ok: true, data: kbDTO(after, semantic, true), embedded: semantic })
  } catch (err) {
    console.error('[giga-admin/comm/kb/:id] patch', err instanceof Error ? err.message : err)
    return commError('Не удалось сохранить статью', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return commError('Неверный идентификатор')
  try {
    const before = await loadArticle(g.sb, params.id)
    if (!before) return commError('Статья не найдена', 404)
    const { error } = await g.sb.from('kb_articles').delete().eq('id', before.id)
    if (error) throw new Error(error.message)
    await recordAdminAction(g.actor, {
      action: 'comm.kb.deleted', entityType: 'kb_article', entityId: before.id,
      oldValue: { title: before.title, status: before.status, tags: before.tags, length: before.body.length },
    }, req)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[giga-admin/comm/kb/:id] delete', err instanceof Error ? err.message : err)
    return commError('Не удалось удалить статью', 500)
  }
}
