export const dynamic = 'force-dynamic'
// Publishing computes an embedding (one provider call, 20 s timeout).
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { commError, guardComm, searchPattern } from '@/lib/comm/admin'
import {
  assertCleanArticle, embedArticle, embeddedIds, KB_COLUMNS, KB_LIST_COLUMNS, KbArticleInput, kbDTO, normalizeTags,
  profanityResponseBody, type KbArticleRow,
} from '@/lib/comm/kb'
import { ProfanityError } from '@/lib/moderation/profanity'

/**
 * GIGA «База знаний бота» (inbox.manage) — articles the client bot answers from.
 *
 * GET  /api/giga-admin/comm/kb?status=all|draft|published&q=
 *      newest first (without the text; GET …/kb/:id has it), with `semantic`
 *      — the article has an embedding (found by meaning, not only by words).
 * POST /api/giga-admin/comm/kb { title, body, tags?, status? }
 *      a new article; status 'published' computes the embedding right away
 *      (`embedded: false` — no embedding provider: the bot finds it by words).
 *      Profanity in the title / body / tags → 400 { error, field }.
 * Audit: comm.kb.created.
 */

export async function GET(req: NextRequest) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') || 'all'
  if (!['all', 'draft', 'published'].includes(status)) return commError('Неверный фильтр')
  try {
    let q = g.sb.from('kb_articles').select(KB_LIST_COLUMNS)
    if (status !== 'all') q = q.eq('status', status)
    const pattern = searchPattern(sp.get('q'))
    if (pattern) q = q.or(`title.ilike.${pattern},body.ilike.${pattern}`)
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(200)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Array<Omit<KbArticleRow, 'body'>>
    const semantic = await embeddedIds(g.sb, rows.map((r) => r.id))
    return NextResponse.json({ ok: true, data: rows.map((r) => kbDTO(r, semantic.has(r.id))) })
  } catch (err) {
    console.error('[giga-admin/comm/kb]', err instanceof Error ? err.message : err)
    return commError('Не удалось загрузить базу знаний', 500)
  }
}

export async function POST(req: NextRequest) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  const parsed = KbArticleInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return commError(parsed.error.issues[0]?.message ?? 'Неверный запрос')
  const input = { ...parsed.data, tags: normalizeTags(parsed.data.tags) }
  try {
    assertCleanArticle(input)
  } catch (err) {
    if (err instanceof ProfanityError) return NextResponse.json(profanityResponseBody(err), { status: 400 })
    throw err
  }

  try {
    const { data, error } = await g.sb
      .from('kb_articles')
      .insert({ title: input.title, body: input.body, tags: input.tags, status: input.status, source: 'manual', updated_by: g.actor.id })
      .select(KB_COLUMNS)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message ?? 'no row')
    const article = data as KbArticleRow
    const embedded = article.status === 'published' ? await embedArticle(g.sb, article) : false
    await recordAdminAction(g.actor, {
      action: 'comm.kb.created', entityType: 'kb_article', entityId: article.id,
      newValue: { title: article.title, status: article.status, tags: article.tags, length: article.body.length },
    }, req)
    return NextResponse.json({ ok: true, data: kbDTO(article, embedded, true), embedded })
  } catch (err) {
    console.error('[giga-admin/comm/kb] create', err instanceof Error ? err.message : err)
    return commError('Не удалось сохранить статью', 500)
  }
}
