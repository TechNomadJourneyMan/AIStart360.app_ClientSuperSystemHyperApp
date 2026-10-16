export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// PDF / DOCX parsing.
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { commError, guardComm } from '@/lib/comm/admin'
import {
  assertCleanArticle, KB_COLUMNS, KB_MAX_FILE_BYTES, KbFileError, kbDTO, normalizeTags, parseKbFile, profanityResponseBody,
  titleFromFileName, type KbArticleRow,
} from '@/lib/comm/kb'
import { ProfanityError } from '@/lib/moderation/profanity'

/**
 * POST /api/giga-admin/comm/kb/upload (inbox.manage), multipart:
 *   file   .txt / .md / .pdf / .docx, ≤ 5 MB
 *   title  optional (default: the file name), tags optional (comma separated)
 * The text (platform document parser for pdf / docx) becomes a DRAFT article
 * (source 'file') — staff read it and publish it. The file itself is not kept.
 * Profanity in the title or text → 400 { error, field }. Audit: comm.kb.uploaded.
 */
export async function POST(req: NextRequest) {
  const g = await guardComm(req, 'inbox.manage')
  if (g.response) return g.response
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return commError('Выберите файл')
  const blob = file as File
  if (blob.size > KB_MAX_FILE_BYTES) return commError('Файл больше 5 МБ')
  const rawTitle = form?.get('title')
  const title = (typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : titleFromFileName(blob.name || 'file')).slice(0, 300)
  const rawTags = form?.get('tags')
  const tags = normalizeTags(typeof rawTags === 'string' ? rawTags.split(',').map((t) => t.slice(0, 40)) : [])

  let body: string
  try {
    body = await parseKbFile(Buffer.from(await blob.arrayBuffer()), blob.name || 'file', blob.type || undefined)
  } catch (err) {
    if (err instanceof KbFileError) return commError(err.message)
    console.error('[giga-admin/comm/kb/upload] parse', err instanceof Error ? err.message : err)
    return commError('Не удалось прочитать файл', 400)
  }
  try {
    assertCleanArticle({ title, body, tags })
  } catch (err) {
    if (err instanceof ProfanityError) return NextResponse.json(profanityResponseBody(err), { status: 400 })
    throw err
  }

  try {
    const { data, error } = await g.sb
      .from('kb_articles')
      .insert({ title, body, tags, status: 'draft', source: 'file', updated_by: g.actor.id })
      .select(KB_COLUMNS)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message ?? 'no row')
    const article = data as KbArticleRow
    await recordAdminAction(g.actor, {
      action: 'comm.kb.uploaded', entityType: 'kb_article', entityId: article.id,
      newValue: { title: article.title, file: (blob.name || '').slice(0, 200), size: blob.size, length: article.body.length },
    }, req)
    return NextResponse.json({ ok: true, data: kbDTO(article, false, true) })
  } catch (err) {
    console.error('[giga-admin/comm/kb/upload]', err instanceof Error ? err.message : err)
    return commError('Не удалось сохранить статью', 500)
  }
}
